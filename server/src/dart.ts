import { USER_AGENT } from './gdacs.js'
import { createCachedSource } from './source.js'

/**
 * NOAA's DART buoys, which sit on the deep-ocean floor and measure the height of the water above them: a
 * tsunami passing shows as a change of centimetres. From NOAA's National Data Buoy Center (public domain).
 */
const STATIONS_URL = 'https://www.ndbc.noaa.gov/activestations.xml'
const DATA_URL = 'https://www.ndbc.noaa.gov/data/realtime2'
const TIMEOUT_MS = 20_000
const DAY_MS = 86_400_000
// A buoy reporting every minute or 15 seconds (instead of every 15 minutes) has seen something
const EVENT_MODE_WINDOW_MS = 6 * 3_600_000

export interface DartStation {
  id: string
  name: string
  lat: number
  lon: number
}

export interface DartReadings {
  id: string
  /** water column height in metres, oldest first, the last day */
  readings: { time: string; heightM: number }[]
  /** reporting faster than every 15 minutes in the last 6 hours: it has triggered on something */
  eventMode: boolean
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? ''

/** The DART stations in NDBC's active station list that have data (dart="y") */
export function parseStations(xml: string): DartStation[] {
  const out: DartStation[] = []
  for (const tag of xml.match(/<station\b[^>]*>/g) ?? []) {
    if (attr(tag, 'type').toLowerCase() !== 'dart' || attr(tag, 'dart').toLowerCase() !== 'y') continue
    const id = attr(tag, 'id')
    const lat = Number(attr(tag, 'lat'))
    const lon = Number(attr(tag, 'lon'))
    if (!/^[A-Za-z0-9]{3,8}$/.test(id) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
    out.push({ id, name: attr(tag, 'name').trim().slice(0, 120), lat, lon })
  }
  return out
}

/**
 * A buoy's .dart file (newest first: year month day hour minute second, measurement type, height in m)
 * into the last day's readings, oldest first, and whether it's in event mode.
 */
export function parseReadings(id: string, text: string, now: number): DartReadings {
  const readings: DartReadings['readings'] = []
  let eventMode = false
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue
    const [y, mo, d, h, mi, s, type, height] = line.trim().split(/\s+/)
    const t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)
    const heightM = Number(height)
    if (Number.isNaN(t) || !Number.isFinite(heightM) || heightM <= 0 || heightM > 12_000) continue
    if (now - t > DAY_MS) continue
    if (type !== '1' && now - t <= EVENT_MODE_WINDOW_MS) eventMode = true
    readings.push({ time: new Date(t).toISOString(), heightM })
  }
  readings.sort((a, b) => a.time.localeCompare(b.time))
  return { id, readings, eventMode }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`NDBC ${res.status}`)
  return res.text()
}

/** The station list kept a day, and each buoy's readings kept 15 minutes, both fetched only when asked for */
export function createDart(fetch: (url: string) => Promise<string> = fetchText, now = Date.now) {
  const stations = createCachedSource<'all', DartStation[]>({
    ttlMs: DAY_MS,
    failureRetryMs: 10 * 60_000,
    name: 'dart stations',
    now,
    fetch: async () => parseStations(await fetch(STATIONS_URL)),
  })
  const readings = createCachedSource<string, DartReadings>({
    ttlMs: 15 * 60_000,
    failureRetryMs: 5 * 60_000,
    maxEntries: 100,
    name: 'dart readings',
    now,
    fetch: async (id) => parseReadings(id, await fetch(`${DATA_URL}/${id}.dart`), now()),
  })
  return {
    stations: () => stations.get('all'),
    /** null for a buoy not in the list, so no id outside it reaches NDBC */
    readings: async (id: string) => {
      const list = await stations.get('all')
      return list?.some((s) => s.id === id) ? readings.get(id) : null
    },
  }
}

export type Dart = ReturnType<typeof createDart>
