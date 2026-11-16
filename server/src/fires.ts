import { createCachedSource } from './source.js'
import type { AlertItem } from './sourceAlerts.js'
import type { AlertLevel } from './types.js'

/**
 * Active fires from NASA FIRMS: every hot spot the VIIRS instruments on NOAA-20 and NOAA-21 saw in the last
 * day, within about 3 hours of the satellite passing over. Needs a free FIRMS map key
 * (https://firms.modaps.eosdis.nasa.gov/api/map_key/); without one this is off.
 */
const API = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv'
const SOURCES = ['VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'] as const
const TIMEOUT_MS = 120_000 // the world for a day is tens of MB
const TTL_MS = 30 * 60_000 // new passes arrive every hour or two; FIRMS counts each request against the key
const FAILURE_RETRY_MS = 10 * 60_000

/** The heat map's grid: 0.25°, row-major from the north-west like every grid here */
export const GRID_RES = 0.25
const COLS = 360 / GRID_RES
const ROWS = 180 / GRID_RES

export interface Detection {
  lat: number
  lon: number
  /** epoch ms of the satellite's pass */
  time: number
  /** fire radiative power, MW */
  frp: number
  confidence: 'nominal' | 'high'
  satellite: string
  day: boolean
}

export interface FireGrid {
  fetchedAt: string
  count: number
  cols: number
  rows: number
  /** base64 of Uint16 counts, little-endian */
  data: string
}

/** One FIRMS VIIRS CSV (latitude, longitude, acq_date, acq_time, satellite, confidence, frp, daynight…) */
export function parseCsv(text: string): Detection[] {
  const lines = text.split('\n').filter((l) => l.trim())
  if (!lines.length) return []
  const header = lines[0].split(',').map((h) => h.trim())
  if (!header.includes('latitude') || !header.includes('frp')) throw new Error(`FIRMS: ${lines[0].slice(0, 80)}`)
  const at = (name: string) => header.indexOf(name)
  const [iLat, iLon, iDate, iTime, iSat, iConf, iFrp, iDn] = [
    'latitude',
    'longitude',
    'acq_date',
    'acq_time',
    'satellite',
    'confidence',
    'frp',
    'daynight',
  ].map(at)
  const out: Detection[] = []
  for (const line of lines.slice(1)) {
    const c = line.split(',')
    const conf = c[iConf]?.trim().toLowerCase()
    if (conf !== 'n' && conf !== 'h' && conf !== 'nominal' && conf !== 'high') continue // low confidence: often not a fire
    const lat = Number(c[iLat])
    const lon = Number(c[iLon])
    const frp = Number(c[iFrp])
    const hhmm = c[iTime]?.trim().padStart(4, '0') ?? ''
    const time = Date.parse(`${c[iDate]?.trim()}T${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}:00Z`)
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue
    if (!Number.isFinite(frp) || Number.isNaN(time)) continue
    out.push({
      lat,
      lon,
      time,
      frp,
      confidence: conf.startsWith('h') ? 'high' : 'nominal',
      satellite: c[iSat]?.trim() ?? '',
      day: c[iDn]?.trim() !== 'N',
    })
  }
  return out
}

const gridCell = (lat: number, lon: number) =>
  Math.min(ROWS - 1, Math.floor((90 - lat) / GRID_RES)) * COLS + Math.min(COLS - 1, Math.floor((lon + 180) / GRID_RES))
/** 1° cells, for finding the detections in a box */
const indexKey = (lat: number, lon: number) => `${Math.floor(lat)}:${Math.floor(lon)}`

export interface Snapshot {
  fetchedAt: number
  detections: Detection[]
  grid: Uint16Array
  index: Map<string, Detection[]>
}

export function snapshot(detections: Detection[], fetchedAt: number): Snapshot {
  const grid = new Uint16Array(COLS * ROWS)
  const index = new Map<string, Detection[]>()
  for (const d of detections) {
    const g = gridCell(d.lat, d.lon)
    if (grid[g] < 0xffff) grid[g]++
    const k = indexKey(d.lat, d.lon)
    let list = index.get(k)
    if (!list) index.set(k, (list = []))
    list.push(d)
  }
  return { fetchedAt, detections, grid, index }
}

/** The detections inside a box no bigger than 10° by 10°, at most `cap` of them, the strongest first */
export function inBox(s: Snapshot, [w, south, e, north]: [number, number, number, number], cap = 5000): Detection[] | null {
  const width = e >= w ? e - w : e + 360 - w // across the date line, east of west wraps
  if (north - south > 10 || width > 10 || north < south) return null
  const out: Detection[] = []
  for (let lat = Math.floor(south); lat <= Math.floor(north); lat++) {
    for (let i = 0; i <= Math.ceil(width); i++) {
      const lon = ((Math.floor(w) + i + 540) % 360) - 180
      for (const d of s.index.get(`${lat}:${lon}`) ?? []) {
        const inLon = e >= w ? d.lon >= w && d.lon <= e : d.lon >= w || d.lon <= e
        if (d.lat >= south && d.lat <= north && inLon) out.push(d)
      }
    }
  }
  return out.sort((a, b) => b.frp - a.frp).slice(0, cap)
}

// ── Alerts ──
/** Detections from the last 12 hours, gathered into 0.1° cells (~11 km), make one alert item per busy cell */
const CLUSTER_RES = 0.1
const RECENT_MS = 12 * 3_600_000
const BIG_FIRE_MW = 100
/** A cell hot on this many of the last 30 days is a gas flare, a volcano or a factory, not news */
const STATIC_DAYS = 20

/**
 * What to alert about: cells with 3 or more confident detections in the last 12 hours, or one high-confidence
 * detection of 100 MW or more. Orange; Red from 10 detections or 500 MW. Keyed by cell and day, so an area
 * hears about a fire once a day at most. Cells hot on most of the last 30 days are left out.
 */
export function fireItems(s: Snapshot, staticCells: Set<string>, now: number): AlertItem[] {
  const cells = new Map<string, Detection[]>()
  for (const d of s.detections) {
    if (now - d.time > RECENT_MS) continue
    const k = `${Math.floor(d.lat / CLUSTER_RES)}:${Math.floor(d.lon / CLUSTER_RES)}`
    if (staticCells.has(k)) continue
    let list = cells.get(k)
    if (!list) cells.set(k, (list = []))
    list.push(d)
  }
  const day = new Date(now).toISOString().slice(0, 10)
  const items: AlertItem[] = []
  for (const [k, ds] of cells) {
    const power = ds.reduce((sum, d) => sum + d.frp, 0)
    const big = ds.some((d) => d.confidence === 'high' && d.frp >= BIG_FIRE_MW)
    if (ds.length < 3 && !big) continue
    const level: AlertLevel = ds.length >= 10 || power >= 500 ? 'Red' : 'Orange'
    const lat = ds.reduce((sum, d) => sum + d.lat, 0) / ds.length
    const lon = ds.reduce((sum, d) => sum + d.lon, 0) / ds.length
    const latest = Math.max(...ds.map((d) => d.time))
    items.push({
      key: `HS-${k}-${day}`,
      hazard: 'HS',
      level,
      lat,
      lon,
      reachKm: 10, // the cluster's own spread; the area's radius is added
      payload: (areas) => ({
        title: `${level === 'Red' ? 'Large fire' : 'Fire'} seen near ${areas.length === 1 ? areas[0].label : 'your areas'}`,
        body:
          `${ds.length} hot ${ds.length === 1 ? 'spot' : 'spots'} seen by satellite in the last 12 hours, ` +
          `${Math.round(power)} MW in all; the latest ${new Date(latest).toISOString().slice(11, 16)} UTC\n` +
          `Near: ${areas.map((a) => a.label).join(', ')}\n` +
          'From NASA FIRMS. Not every hot spot is a wildfire. Follow your local fire service.',
        url: `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${lon.toFixed(2)},${lat.toFixed(2)},10.0z`,
      }),
    })
  }
  return items
}

async function fetchCsv(url: string): Promise<string> {
  const res = await fetch(url, { headers: { Accept: 'text/csv' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`FIRMS ${res.status}`)
  return res.text()
}

/**
 * The last day's fires, fetched at most every 30 minutes and only when asked for (someone has the layer
 * on, or an area wants fire alerts). Remembers which cells were hot on which days, for 30 days, to tell
 * gas flares from fires: in memory, so a restart starts that afresh.
 */
export function createFires({
  mapKey,
  fetchText = fetchCsv,
  now = Date.now,
}: {
  mapKey: string
  fetchText?: (url: string) => Promise<string>
  now?: () => number
}) {
  const hotDays = new Map<string, Set<string>>() // cluster cell -> days it was hot

  const source = createCachedSource<'world', Snapshot>({
    ttlMs: TTL_MS,
    failureRetryMs: FAILURE_RETRY_MS,
    name: 'fires',
    now,
    fetch: async () => {
      const texts = await Promise.all(
        SOURCES.map((s) => fetchText(`${API}/${encodeURIComponent(mapKey)}/${s}/world/1`)),
      )
      const detections = texts.flatMap(parseCsv)
      for (const d of detections) {
        const k = `${Math.floor(d.lat / CLUSTER_RES)}:${Math.floor(d.lon / CLUSTER_RES)}`
        let days = hotDays.get(k)
        if (!days) hotDays.set(k, (days = new Set()))
        days.add(new Date(d.time).toISOString().slice(0, 10))
      }
      const cutoff = new Date(now() - 30 * 86_400_000).toISOString().slice(0, 10)
      for (const [k, days] of hotDays) {
        for (const d of days) if (d < cutoff) days.delete(d)
        if (!days.size) hotDays.delete(k)
      }
      console.log(`[fires] ${detections.length} detections`)
      return snapshot(detections, now())
    },
  })

  const staticCells = () => new Set([...hotDays].filter(([, days]) => days.size >= STATIC_DAYS).map(([k]) => k))

  return {
    grid: async (): Promise<FireGrid | null> => {
      const s = await source.get('world')
      if (!s) return null
      return {
        fetchedAt: new Date(s.fetchedAt).toISOString(),
        count: s.detections.length,
        cols: COLS,
        rows: ROWS,
        data: Buffer.from(s.grid.buffer, s.grid.byteOffset, s.grid.byteLength).toString('base64'),
      }
    },
    /** Fires in a box, or null when the box is too big; throws when FIRMS has never answered */
    inBox: async (box: [number, number, number, number]) => {
      const s = await source.get('world')
      if (!s) throw new Error('FIRMS unavailable')
      return inBox(s, box)
    },
    /** For the alert poller: nothing, without fetching, when no area wants fire alerts */
    items: async (wanted: boolean): Promise<AlertItem[]> => {
      if (!wanted) return []
      // the poller runs as often as the copy expires: wait for the new one, or each round checks the last
      const s = await source.getFresh('world')
      return s ? fireItems(s, staticCells(), now()) : []
    },
  }
}

export type Fires = ReturnType<typeof createFires>
