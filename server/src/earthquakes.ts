import { USER_AGENT } from './gdacs.js'
import { createCachedSource } from './source.js'

/**
 * Earthquakes from the USGS real-time feeds: public domain, no key, updated every minute.
 * https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
 */
const FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary'
const TIMEOUT_MS = 30_000

/** The feeds offered: small enough for a globe, big enough to be useful */
export const QUAKE_FEEDS = {
  day: '2.5_day', // magnitude 2.5+, past day
  week: '4.5_week', // magnitude 4.5+, past week
} as const
export type QuakeFeed = keyof typeof QUAKE_FEEDS
export const isQuakeFeed = (s: string): s is QuakeFeed => Object.hasOwn(QUAKE_FEEDS, s)

// USGS regenerates the feeds every minute; a couple of minutes old is fine, and spares them a request
// per visitor
const TTL_MS = 2 * 60_000
const FAILURE_RETRY_MS = 2 * 60_000

/** USGS PAGER alert level: estimated impact on people and the economy */
export type PagerAlert = 'green' | 'yellow' | 'orange' | 'red'
const PAGER: readonly string[] = ['green', 'yellow', 'orange', 'red']

export interface Quake {
  id: string
  lon: number
  lat: number
  depthKm: number
  mag: number
  /** epoch ms */
  time: number
  place: string
  /** the USGS event page */
  url: string
  /** USGS's flag for a large event in an ocean region; not a sign a tsunami happened */
  tsunami: boolean
  alert: PagerAlert | null
}

export interface QuakesSnapshot {
  feed: QuakeFeed
  fetchedAt: string
  /** when USGS generated the feed */
  generatedAt: string | null
  quakes: Quake[]
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A USGS GeoJSON feed, checked and trimmed: anything malformed, and anything not an earthquake, is left out. */
export function parseQuakes(body: unknown): { generatedAt: string | null; quakes: Quake[] } {
  const b = body as { metadata?: { generated?: unknown }; features?: unknown } | null
  if (!b || !Array.isArray(b.features)) throw new Error('USGS sent something other than a feature collection')
  const quakes: Quake[] = []
  for (const f of b.features as { id?: unknown; properties?: Record<string, unknown>; geometry?: { coordinates?: unknown } }[]) {
    const p = f?.properties
    const c = f?.geometry?.coordinates
    if (!p || !Array.isArray(c) || typeof f.id !== 'string') continue
    if (p.type !== 'earthquake') continue // quarry blasts, explosions, ice quakes
    const [lon, lat, depthKm] = c
    if (!num(lon) || !num(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) continue
    if (!num(p.mag) || !num(p.time)) continue
    quakes.push({
      id: f.id,
      lon,
      lat,
      depthKm: num(depthKm) ? depthKm : 0,
      mag: p.mag,
      time: p.time,
      place: typeof p.place === 'string' ? p.place.slice(0, 200) : '',
      url: typeof p.url === 'string' && p.url.startsWith('https://earthquake.usgs.gov/') ? p.url : '',
      tsunami: p.tsunami === 1,
      alert: typeof p.alert === 'string' && PAGER.includes(p.alert) ? (p.alert as PagerAlert) : null,
    })
  }
  const generated = b.metadata?.generated
  return { generatedAt: num(generated) ? new Date(generated).toISOString() : null, quakes }
}

export async function fetchFeed(feed: QuakeFeed): Promise<{ generatedAt: string | null; quakes: Quake[] }> {
  const res = await fetch(`${FEED_URL}/${QUAKE_FEEDS[feed]}.geojson`, {
    headers: { Accept: 'application/geo+json, application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`USGS ${res.status}`)
  return parseQuakes(await res.json())
}

/**
 * Each feed fetched from USGS at most once every 2 minutes whoever is looking, and only while someone is.
 * A refresh is shared, and the last good copy is served while it runs and if it fails.
 */
export function createEarthquakes(fetch: typeof fetchFeed = fetchFeed, now = Date.now) {
  const source = createCachedSource<QuakeFeed, QuakesSnapshot>({
    ttlMs: TTL_MS,
    failureRetryMs: FAILURE_RETRY_MS,
    name: 'earthquakes',
    now,
    fetch: async (feed) => ({ feed, fetchedAt: new Date(now()).toISOString(), ...(await fetch(feed)) }),
  })
  return (feed: QuakeFeed): Promise<QuakesSnapshot | null> => source.get(feed)
}
