/**
 * A small GRIB2 decoder: just what NOAA's GFS files from the NOMADS filter need. Regular latitude/longitude
 * grids (template 3.0) with no bitmap, packed simply (5.0) or with complex packing, with or without spatial
 * differencing (5.2, 5.3). Anything else is refused rather than misread. Follows the WMO Manual on Codes,
 * FM 92 GRIB edition 2, and NCEP's g2clib for the details of complex unpacking.
 */

export interface GribField {
  /** Product discipline, parameter category and number: wind U is 0/2/2, V is 0/2/3 */
  discipline: number
  category: number
  parameter: number
  /** Type of first fixed surface (103 = height above ground) and its value */
  levelType: number
  levelValue: number
  /** When the model run started */
  referenceTime: Date
  forecastHours: number
  grid: { ni: number; nj: number; la1: number; lo1: number; la2: number; lo2: number; di: number; dj: number; scanMode: number }
  values: Float32Array
}

class Bits {
  private bit = 0
  constructor(
    private readonly bytes: Uint8Array,
    private pos: number,
  ) {}

  read(n: number): number {
    // Reading past the end would give zeros, which decode to plausible but wrong values
    if (this.pos + ((this.bit + n + 7) >> 3) > this.bytes.length) throw new Error('GRIB2: data section ends early')
    let v = 0
    for (let i = 0; i < n; i++) {
      const byte = this.bytes[this.pos + (this.bit >> 3)]
      v = v * 2 + ((byte >> (7 - (this.bit & 7))) & 1)
      this.bit++
    }
    return v
  }

  /** Each part of a complex-packed section starts on a byte */
  align() {
    this.bit = (this.bit + 7) & ~7
  }
}

/** GRIB2 stores signed integers as sign and magnitude, not two's complement */
function signed(view: DataView, at: number, bytes: number): number {
  let v = 0
  for (let i = 0; i < bytes; i++) v = v * 256 + view.getUint8(at + i)
  const top = 2 ** (8 * bytes - 1)
  return v >= top ? -(v - top) : v
}

interface Packing {
  template: number
  count: number
  R: number
  E: number
  D: number
  bits: number
  section: DataView
}

function unpackSimple({ count, R, E, D, bits }: Packing, data: Uint8Array): Float32Array {
  const out = new Float32Array(count)
  const scale = 2 ** E
  const dec = 10 ** -D
  if (bits === 0) return out.fill(R * dec) // a constant field
  const reader = new Bits(data, 0)
  for (let i = 0; i < count; i++) out[i] = (R + reader.read(bits) * scale) * dec
  return out
}

function unpackComplex({ template, count, R, E, D, bits, section: s }: Packing, data: Uint8Array): Float32Array {
  // Section 5, octets numbered from 1 as in the manual
  const missingManagement = s.getUint8(22)
  if (missingManagement !== 0) throw new Error('GRIB2: complex packing with missing values is not supported')
  const groups = s.getUint32(31)
  const widthRef = s.getUint8(35)
  const widthBits = s.getUint8(36)
  const lengthRef = s.getUint32(37)
  const lengthIncrement = s.getUint8(41)
  const lastLength = s.getUint32(42)
  const lengthBits = s.getUint8(46)
  const order = template === 3 ? s.getUint8(47) : 0
  const extraBytes = template === 3 ? s.getUint8(48) : 0
  if (order > 2) throw new Error(`GRIB2: spatial differencing of order ${order} is not supported`)

  // Section 7 starts with the spatial differencing's first values and overall minimum
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const firstValues: number[] = []
  for (let i = 0; i < order; i++) firstValues.push(signed(view, i * extraBytes, extraBytes))
  const minimum = order ? signed(view, order * extraBytes, extraBytes) : 0

  const reader = new Bits(data, order ? (order + 1) * extraBytes : 0)
  const refs = new Array<number>(groups)
  for (let g = 0; g < groups; g++) refs[g] = reader.read(bits)
  reader.align()
  const widths = new Array<number>(groups)
  for (let g = 0; g < groups; g++) widths[g] = widthRef + reader.read(widthBits)
  reader.align()
  const lengths = new Array<number>(groups)
  for (let g = 0; g < groups; g++) lengths[g] = lengthRef + lengthIncrement * reader.read(lengthBits)
  lengths[groups - 1] = lastLength
  reader.align()

  const ints = new Float64Array(count)
  let n = 0
  for (let g = 0; g < groups; g++) {
    for (let i = 0; i < lengths[g] && n < count; i++) ints[n++] = refs[g] + (widths[g] ? reader.read(widths[g]) : 0)
  }
  if (n !== count) throw new Error(`GRIB2: groups held ${n} values, expected ${count}`)

  // Undo the spatial differencing
  if (order === 1) {
    ints[0] = firstValues[0]
    for (let i = 1; i < count; i++) ints[i] += minimum + ints[i - 1]
  } else if (order === 2) {
    ints[0] = firstValues[0]
    ints[1] = firstValues[1]
    for (let i = 2; i < count; i++) ints[i] += minimum + 2 * ints[i - 1] - ints[i - 2]
  }

  const out = new Float32Array(count)
  const scale = 2 ** E
  const dec = 10 ** -D
  for (let i = 0; i < count; i++) out[i] = (R + ints[i] * scale) * dec
  return out
}

/** Every field in a GRIB2 file (several messages back to back). */
export function decodeGrib2(buffer: Uint8Array): GribField[] {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const fields: GribField[] = []
  let pos = 0
  while (pos + 16 <= buffer.length) {
    if (view.getUint32(pos) !== 0x47524942) throw new Error('GRIB2: not a GRIB message') // "GRIB"
    if (view.getUint8(pos + 7) !== 2) throw new Error('GRIB2: only edition 2 is supported')
    const discipline = view.getUint8(pos + 6)
    const length = Number(view.getBigUint64(pos + 8))
    const end = pos + length
    // A wrong length would read into the next message, or never move on
    if (length < 16 + 4 || end > buffer.length) throw new Error('GRIB2: message length does not fit the file')
    if (view.getUint32(end - 4) !== 0x37373737) throw new Error('GRIB2: message does not end with 7777')

    let referenceTime = new Date(Number.NaN)
    let grid: GribField['grid'] | null = null
    let product: Pick<GribField, 'category' | 'parameter' | 'levelType' | 'levelValue' | 'forecastHours'> | null = null
    let packing: Packing | null = null

    let p = pos + 16
    while (p < end - 4) {
      const len = view.getUint32(p)
      if (len < 5 || p + len > end - 4) throw new Error('GRIB2: section length does not fit the message')
      const section = view.getUint8(p + 4)
      const s = new DataView(buffer.buffer, buffer.byteOffset + p, len)
      if (section === 1) {
        referenceTime = new Date(
          Date.UTC(s.getUint16(12), s.getUint8(14) - 1, s.getUint8(15), s.getUint8(16), s.getUint8(17), s.getUint8(18)),
        )
      } else if (section === 3) {
        const template = s.getUint16(12)
        if (template !== 0) throw new Error(`GRIB2: grid template 3.${template} is not supported`)
        const microdegrees = (at: number) => signed(s, at, 4) / 1e6
        grid = {
          ni: s.getUint32(30),
          nj: s.getUint32(34),
          la1: microdegrees(46),
          lo1: microdegrees(50),
          la2: microdegrees(55),
          lo2: microdegrees(59),
          di: s.getUint32(63) / 1e6,
          dj: s.getUint32(67) / 1e6,
          scanMode: s.getUint8(71),
        }
      } else if (section === 4) {
        const template = s.getUint16(7)
        if (template !== 0) throw new Error(`GRIB2: product template 4.${template} is not supported`)
        const unit = s.getUint8(17)
        const hoursPerUnit: Record<number, number> = { 0: 1 / 60, 1: 1, 2: 24, 10: 3, 11: 6, 12: 12 }
        product = {
          category: s.getUint8(9),
          parameter: s.getUint8(10),
          forecastHours: s.getUint32(18) * (hoursPerUnit[unit] ?? Number.NaN),
          levelType: s.getUint8(22),
          levelValue: s.getUint32(24) / 10 ** signed(s, 23, 1),
        }
      } else if (section === 5) {
        const template = s.getUint16(9)
        if (![0, 2, 3].includes(template)) throw new Error(`GRIB2: data template 5.${template} is not supported`)
        packing = {
          template,
          count: s.getUint32(5),
          R: s.getFloat32(11),
          E: signed(s, 15, 2),
          D: signed(s, 17, 2),
          bits: s.getUint8(19),
          section: s,
        }
      } else if (section === 6) {
        if (s.getUint8(5) !== 255) throw new Error('GRIB2: bitmaps are not supported')
      } else if (section === 7) {
        if (!grid || !product || !packing) throw new Error('GRIB2: data before its grid, product or packing')
        if (packing.count !== grid.ni * grid.nj) throw new Error('GRIB2: value count does not match the grid')
        const data = buffer.subarray(p + 5, p + len)
        const values = packing.template === 0 ? unpackSimple(packing, data) : unpackComplex(packing, data)
        fields.push({ discipline, referenceTime, grid, ...product, values })
      }
      p += len
    }
    pos = end
  }
  return fields
}
