import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeGrib2 } from '../src/weather/grib2.js'

/**
 * Fixtures from make-grib-fixtures.py: NOAA's GFS 10 m wind as downloaded (5.3, second-order spatial
 * differencing) and the same U field repacked by ecCodes as 5.0, 5.2 and 5.3 with first-order differencing.
 * The expected values are ecCodes' own decoding.
 */
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url))
const expected = JSON.parse(fixture('gfs-wind-10m.expected.json').toString()) as Record<
  string,
  { shortName: string; template: number; values: Record<string, number>; min: number; max: number; mean: number }[]
>

function stats(values: Float32Array) {
  let min = Infinity
  let max = -Infinity
  let sum = 0
  for (const v of values) {
    min = Math.min(min, v)
    max = Math.max(max, v)
    sum += v
  }
  return { min, max, mean: sum / values.length }
}

describe('decodeGrib2', () => {
  for (const file of ['gfs-wind-10m.grb2', 'gfs-wind-10m-repacked.grb2']) {
    it(`matches ecCodes for every field in ${file}`, () => {
      const fields = decodeGrib2(fixture(file))
      const want = expected[file]
      expect(fields).toHaveLength(want.length)
      fields.forEach((field, i) => {
        const w = want[i]
        for (const [index, value] of Object.entries(w.values)) {
          expect(field.values[Number(index)], `${w.shortName} 5.${w.template} at ${index}`).toBeCloseTo(value, 3)
        }
        const s = stats(field.values)
        expect(s.min).toBeCloseTo(w.min, 3)
        expect(s.max).toBeCloseTo(w.max, 3)
        expect(s.mean).toBeCloseTo(w.mean, 4)
      })
    })
  }

  it('reads what each field is, when for, and on what grid', () => {
    const [u, v] = decodeGrib2(fixture('gfs-wind-10m.grb2'))
    expect(u).toMatchObject({ discipline: 0, category: 2, parameter: 2, levelType: 103, levelValue: 10, forecastHours: 0 })
    expect(v).toMatchObject({ category: 2, parameter: 3 })
    expect(u.referenceTime.toISOString()).toBe('2026-11-02T18:00:00.000Z')
    expect(u.grid).toEqual({ ni: 360, nj: 181, la1: 90, lo1: 0, la2: -90, lo2: 359, di: 1, dj: 1, scanMode: 0 })
    expect(u.values).toHaveLength(360 * 181)
  })

  it('throws on malformed lengths or a short data section, rather than looping or decoding zeros', () => {
    const file = fixture('gfs-wind-10m.grb2')
    const broken = (change: (bytes: Uint8Array, view: DataView) => void) => {
      const bytes = new Uint8Array(file)
      change(bytes, new DataView(bytes.buffer))
      return bytes
    }
    // Section 1 starts at byte 16, straight after the 16-byte indicator
    expect(() => decodeGrib2(broken((_, v) => v.setBigUint64(8, 0n)))).toThrow('message length does not fit')
    expect(() => decodeGrib2(broken((_, v) => v.setBigUint64(8, BigInt(file.length * 2))))).toThrow('message length')
    expect(() => decodeGrib2(broken((_, v) => v.setUint32(16, 0)))).toThrow('section length does not fit')
    expect(() => decodeGrib2(broken((b) => b.set([0x37, 0x37, 0x37, 0x30], 79052 - 4)))).toThrow('does not end with 7777')

    // The simple-packed message, with its data section cut short and everything else made to agree
    const repacked = new Uint8Array(fixture('gfs-wind-10m-repacked.grb2'))
    const view = new DataView(repacked.buffer)
    const length = Number(view.getBigUint64(8))
    let p = 16
    while (view.getUint8(p + 4) !== 7) p += view.getUint32(p)
    const cut = 1_000
    const short = new Uint8Array(length - cut)
    short.set(repacked.subarray(0, length - 4 - cut))
    short.set([0x37, 0x37, 0x37, 0x37], length - cut - 4)
    const shortView = new DataView(short.buffer)
    shortView.setBigUint64(8, BigInt(length - cut))
    shortView.setUint32(p, view.getUint32(p) - cut)
    expect(() => decodeGrib2(short)).toThrow('data section ends early')
  })

  it('refuses what it cannot read rather than misreading it', () => {
    expect(() => decodeGrib2(new TextEncoder().encode('<html>No such file</html>'))).toThrow('not a GRIB message')

    const otherGrid = new Uint8Array(fixture('gfs-wind-10m.grb2'))
    // Section 3 starts straight after sections 0 (16 bytes) and 1; its template number is at octets 13-14
    const section3 = 16 + new DataView(otherGrid.buffer).getUint32(16)
    otherGrid[section3 + 13] = 40 // 3.40: a Gaussian grid
    expect(() => decodeGrib2(otherGrid)).toThrow('grid template 3.40 is not supported')
  })
})
