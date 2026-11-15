import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { CLASSES, POINT_BYTES, UNKNOWN_WIND, type ClimatologyMeta, type StormClass } from './model.js'

const DIR = new URL('../../assets/climatology/', import.meta.url)

export interface Climatology {
  /** What the web needs to know about the data, without the per-storm index */
  meta: Omit<ClimatologyMeta, 'stormIndex' | 'layout'> & { grids: { res: number; cols: number; rows: number }[] }
  /** One slice: storms per cell over the whole period, as little-endian Uint16, row-major from the north-west */
  grid: (cls: StormClass, slice: number) => Buffer | null
  near: (lon: number, lat: number, radiusKm: number) => PlaceClimatology
}

export interface PlaceClimatology {
  from: string
  to: string
  years: number
  radiusKm: number
  /** storms that passed within radiusKm at tropical-storm strength or more, by the strongest they were there */
  storms: number
  hurricane: number
  major: number
  /** months (1–12) with the most of those passes, most first; at most three */
  peakMonths: number[]
  strongest: { name: string; year: number; kt: number } | null
}

const KM_PER_DEG = 111.2

/**
 * Loads the built climatology (see build-cli.ts). Null when it hasn't been built, so the routes can say so
 * rather than the server refusing to start.
 */
export async function loadClimatology(dir: URL = DIR): Promise<Climatology | null> {
  let meta: ClimatologyMeta
  let grids: Buffer
  let tracks: Buffer
  try {
    meta = JSON.parse(await readFile(new URL('meta.json', dir), 'utf8')) as ClimatologyMeta
    grids = gunzipSync(await readFile(new URL('grids.bin.gz', dir)))
    tracks = gunzipSync(await readFile(new URL('tracks.bin.gz', dir)))
  } catch {
    return null
  }
  const { stormIndex, layout, ...rest } = meta

  // Each storm's bounding box, so a place far from it costs one comparison
  const boxes = stormIndex.map(([, , , first, count]) => {
    let s = 90
    let n = -90
    for (let i = first; i < first + count; i++) {
      const lat = tracks.readInt16LE(i * POINT_BYTES) / 100
      s = Math.min(s, lat)
      n = Math.max(n, lat)
    }
    return { s, n }
  })

  function near(lon: number, lat: number, radiusKm: number): PlaceClimatology {
    const cos = Math.cos((lat * Math.PI) / 180)
    // Flat x/y in km round the place: good to a few % within the 1,000 km an area can be
    const xy = (i: number) => {
      const pLat = tracks.readInt16LE(i * POINT_BYTES) / 100
      let dLon = tracks.readInt16LE(i * POINT_BYTES + 2) / 100 - lon
      if (dLon > 180) dLon -= 360
      else if (dLon < -180) dLon += 360
      return [dLon * KM_PER_DEG * cos, (pLat - lat) * KM_PER_DEG] as const
    }
    const wind = (i: number) => {
      const w = tracks.readUInt8(i * POINT_BYTES + 4)
      return w === UNKNOWN_WIND ? null : w
    }

    let storms = 0
    let hurricane = 0
    let major = 0
    const months = new Array<number>(13).fill(0)
    let strongest: PlaceClimatology['strongest'] = null
    const reachDeg = radiusKm / KM_PER_DEG

    stormIndex.forEach(([, name, year, first, count], s) => {
      if (boxes[s].s > lat + reachDeg || boxes[s].n < lat - reachDeg) return
      let best = -1 // the strongest wind this storm had where it passed within the radius
      let bestMonth = 0
      for (let i = first; i < first + count; i++) {
        const [ax, ay] = xy(i)
        const last = i === first + count - 1
        // the point itself, or the closest point of the segment to the next one
        let t = 0
        if (!last) {
          const [bx, by] = xy(i + 1)
          const dx = bx - ax
          const dy = by - ay
          const len = dx * dx + dy * dy
          t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0
          if (Math.hypot(ax + dx * t, ay + dy * t) > radiusKm) continue
        } else if (Math.hypot(ax, ay) > radiusKm) continue
        const wa = wind(i)
        const wb = last ? wa : wind(i + 1)
        const w = wa !== null && wb !== null ? wa + (wb - wa) * t : (wa ?? wb)
        if (w !== null && w > best) {
          best = w
          bestMonth = tracks.readUInt8((t < 0.5 || last ? i : i + 1) * POINT_BYTES + 5)
        }
      }
      if (best < CLASSES.all) return
      storms++
      if (best >= CLASSES.hurricane) hurricane++
      if (best >= CLASSES.major) major++
      months[bestMonth]++
      if (!strongest || best > strongest.kt) strongest = { name, year, kt: Math.round(best) }
    })

    const peakMonths = months
      .map((n, m) => [m, n] as const)
      .filter(([m, n]) => m > 0 && n > 0)
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 3)
      .map(([m]) => m)
    return { from: rest.from, to: rest.to, years: rest.years, radiusKm, storms, hurricane, major, peakMonths, strongest }
  }

  return {
    meta: { ...rest, grids: [0, 1].map((slice) => layout.find((l) => l.slice === slice)!).map(({ res, cols, rows }) => ({ res, cols, rows })) },
    grid: (cls, slice) => {
      const l = layout.find((x) => x.class === cls && x.slice === slice)
      return l ? grids.subarray(l.offset, l.offset + l.cols * l.rows * 2) : null
    },
    near,
  }
}
