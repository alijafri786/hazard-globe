import {
  CLASSES,
  gridSize,
  km,
  POINT_BYTES,
  REACH_KM,
  SLICES,
  sliceRes,
  STORM_CLASSES,
  UNKNOWN_WIND,
  wrapLon,
  type ClimatologyMeta,
  type StormClass,
} from './model.js'

export interface TrackPoint {
  /** epoch ms */
  time: number
  lat: number
  lon: number
  /** knots, null when no agency gave one */
  wind: number | null
}

export interface Storm {
  sid: string
  name: string
  points: TrackPoint[]
}

// Tropical, subtropical, or agencies disagreeing (MX). Not extratropical (ET), disturbances (DS) or unrated (NR):
// those are what a storm becomes before and after, not the storm itself.
const NATURES = new Set(['TS', 'SS', 'MX'])
// The best track and storms still being finalised; not the spurs IBTrACS keeps for agencies' alternatives
const TRACK_TYPES = new Set(['main', 'PROVISIONAL', 'US-PROVISIONAL'])
// Gaps longer than this aren't joined up: the storm was lost, or it's a different phase
const MAX_GAP_MS = 12 * 3_600_000
// Track points are 3-hourly; a fast storm covers ~100 km between them, so sample in between
const SAMPLE_KM = 25

const num = (s: string | undefined) => {
  const t = s?.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * Reads IBTrACS CSV lines (the header, then a units row, then one row per track point) into storms, keeping
 * only the points that make up the tropical storm itself. Wind is the US agencies' 1-minute wind, or WMO's
 * where they have none.
 */
export async function readStorms(lines: AsyncIterable<string> | Iterable<string>): Promise<Storm[]> {
  let header: string[] | null = null
  let units = true
  const storms = new Map<string, Storm>()
  for await (const line of lines) {
    if (!line.trim()) continue
    const cols = line.split(',')
    if (!header) {
      header = cols.map((c) => c.trim())
      continue
    }
    if (units) {
      units = false // the second line names units, not a point
      continue
    }
    const get = (name: string) => cols[header!.indexOf(name)]
    if (!NATURES.has(get('NATURE')?.trim()) || !TRACK_TYPES.has(get('TRACK_TYPE')?.trim())) continue
    const lat = num(get('LAT'))
    const lon = num(get('LON'))
    const time = Date.parse(`${get('ISO_TIME')?.trim().replace(' ', 'T')}Z`)
    if (lat === null || lon === null || Math.abs(lat) > 90 || Number.isNaN(time)) continue
    const sid = get('SID').trim()
    let storm = storms.get(sid)
    if (!storm) storms.set(sid, (storm = { sid, name: get('NAME')?.trim() || 'NOT_NAMED', points: [] }))
    storm.points.push({ time, lat, lon: wrapLon(lon), wind: num(get('USA_WIND')) ?? num(get('WMO_WIND')) })
  }
  for (const s of storms.values()) s.points.sort((a, b) => a.time - b.time)
  return [...storms.values()].filter((s) => s.points.length)
}

/** Points along the track every ~25 km, with wind and time in between interpolated; never across a gap */
export function* samples(points: TrackPoint[]): Generator<TrackPoint> {
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    yield a
    const b = points[i + 1]
    if (!b || b.time - a.time > MAX_GAP_MS) continue
    // across the date line, go the short way round
    let lonB = b.lon
    if (lonB - a.lon > 180) lonB -= 360
    else if (a.lon - lonB > 180) lonB += 360
    const n = Math.ceil(km(a.lat, a.lon, b.lat, b.lon) / SAMPLE_KM)
    for (let k = 1; k < n; k++) {
      const t = k / n
      yield {
        time: a.time + (b.time - a.time) * t,
        lat: a.lat + (b.lat - a.lat) * t,
        lon: wrapLon(a.lon + (lonB - a.lon) * t),
        wind: a.wind !== null && b.wind !== null ? a.wind + (b.wind - a.wind) * t : (a.wind ?? b.wind),
      }
    }
  }
}

/** Indexes of the cells, on a grid of `res` degrees, whose centre is within `reachKm` of a point */
export function cellsNear(lat: number, lon: number, res: number, reachKm: number, out: Set<number>) {
  const { cols, rows } = gridSize(res)
  const dLat = reachKm / 111.2 + res
  const r0 = Math.max(0, Math.floor((90 - (lat + dLat)) / res))
  const r1 = Math.min(rows - 1, Math.floor((90 - (lat - dLat)) / res))
  for (let r = r0; r <= r1; r++) {
    const cLat = 90 - (r + 0.5) * res
    const cos = Math.cos(cLat * (Math.PI / 180))
    // near the poles every column is close: look at them all
    const dLon = cos < 0.01 ? 180 : Math.min(180, reachKm / (111.2 * cos) + res)
    const c0 = Math.floor((lon - dLon + 180) / res)
    const c1 = Math.floor((lon + dLon + 180) / res)
    for (let c = c0; c <= c1; c++) {
      const col = ((c % cols) + cols) % cols // wrapped across the date line
      const cLon = -180 + (col + 0.5) * res
      if (km(lat, lon, cLat, cLon) <= reachKm) out.add(r * cols + col)
    }
  }
}

export interface BuiltClimatology {
  meta: Omit<ClimatologyMeta, 'built'>
  grids: Buffer
  tracks: Buffer
}

/**
 * Counts, for each class and slice (the whole year, then each month), how many distinct storms passed within
 * REACH_KM of each cell while at least that strong. A storm that loops over a place counts once.
 */
export function buildClimatology(storms: Storm[], { reachKm = REACH_KM } = {}): BuiltClimatology {
  const layout: ClimatologyMeta['layout'] = []
  let offset = 0
  const counts = new Map<string, Uint16Array>()
  for (const cls of STORM_CLASSES) {
    for (let slice = 0; slice < SLICES; slice++) {
      const res = sliceRes(slice)
      const { cols, rows } = gridSize(res)
      layout.push({ class: cls, slice, res, cols, rows, offset })
      offset += cols * rows * 2
      counts.set(`${cls}:${slice}`, new Uint16Array(cols * rows))
    }
  }

  let from = Infinity
  let to = -Infinity
  let counted = 0
  for (const storm of storms) {
    const touched = new Map<string, Set<number>>()
    for (const p of samples(storm.points)) {
      if (p.wind === null || p.wind < CLASSES.all) continue
      from = Math.min(from, p.time)
      to = Math.max(to, p.time)
      const month = new Date(p.time).getUTCMonth() + 1
      for (const cls of STORM_CLASSES) {
        if (p.wind < CLASSES[cls]) continue
        for (const slice of [0, month]) {
          const key = `${cls}:${slice}`
          let cells = touched.get(key)
          if (!cells) touched.set(key, (cells = new Set()))
          cellsNear(p.lat, p.lon, sliceRes(slice), reachKm, cells)
        }
      }
    }
    if (touched.size) counted++
    for (const [key, cells] of touched) {
      const grid = counts.get(key)!
      for (const cell of cells) if (grid[cell] < 0xffff) grid[cell]++
    }
  }

  const grids = Buffer.alloc(offset)
  for (const l of layout) {
    const grid = counts.get(`${l.class}:${l.slice}`)!
    for (let i = 0; i < grid.length; i++) grids.writeUInt16LE(grid[i], l.offset + i * 2)
  }

  // The tracks themselves, for "how many storms passed near here": every kept point, compactly
  const stormIndex: ClimatologyMeta['stormIndex'] = []
  const total = storms.reduce((n, s) => n + s.points.length, 0)
  const tracks = Buffer.alloc(total * POINT_BYTES)
  let at = 0
  for (const s of storms) {
    stormIndex.push([s.sid, s.name, new Date(s.points[0].time).getUTCFullYear(), at, s.points.length])
    for (const p of s.points) {
      const o = at * POINT_BYTES
      tracks.writeInt16LE(Math.round(p.lat * 100), o)
      tracks.writeInt16LE(Math.round(p.lon * 100), o + 2)
      tracks.writeUInt8(p.wind === null ? UNKNOWN_WIND : Math.min(254, Math.round(p.wind)), o + 4)
      tracks.writeUInt8(new Date(p.time).getUTCMonth() + 1, o + 5)
      at++
    }
  }

  const span = Number.isFinite(from) ? to - from : 0
  return {
    meta: {
      source: 'NOAA NCEI IBTrACS v04r01, since-1980 file',
      citation:
        'Knapp, K. R., et al. (2010). The International Best Track Archive for Climate Stewardship (IBTrACS). ' +
        'Bulletin of the American Meteorological Society, 91, 363–376.',
      from: Number.isFinite(from) ? new Date(from).toISOString().slice(0, 10) : '',
      to: Number.isFinite(to) ? new Date(to).toISOString().slice(0, 10) : '',
      years: Math.round((span / (365.25 * 86_400_000)) * 100) / 100,
      storms: counted,
      reachKm,
      classes: CLASSES,
      layout,
      stormIndex,
    },
    grids,
    tracks,
  }
}

export type { StormClass }
