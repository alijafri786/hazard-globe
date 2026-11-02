import { flightsAuthenticated, getToken, tracksPerDay } from './flights.js'
import type { FlightTrack, TrackPoint } from './types.js'

const TRACKS_URL = 'https://opensky-network.org/api/tracks/all'
const TIMEOUT_MS = 30_000
const CACHE_MS = 5 * 60_000
const CACHE_SIZE = 500

export const isIcao24 = (s: string) => /^[0-9a-f]{6}$/.test(s)

// OpenSky waypoint: [time, latitude, longitude, baro_altitude, true_track, on_ground]
type Waypoint = [number, number | null, number | null, number | null, number | null, boolean]

/** OpenSky's track, checked and trimmed to what the globe draws. Null when it has none. */
export function parseTrack(icao24: string, body: unknown): FlightTrack | null {
  const path = (body as { path?: unknown } | null)?.path
  if (!Array.isArray(path)) return null
  const points: TrackPoint[] = []
  for (const w of path as Waypoint[]) {
    if (!Array.isArray(w)) continue
    const [time, lat, lon, alt] = w
    if (![time, lat, lon].every((n) => typeof n === 'number' && Number.isFinite(n))) continue
    points.push([time, Number(lon!.toFixed(4)), Number(lat!.toFixed(4)), Math.max(0, Math.round(alt ?? 0))])
  }
  return points.length >= 2 ? { icao24, points } : null
}

/** The path an aircraft has flown on its current flight, from OpenSky. */
export async function fetchTrack(icao24: string): Promise<FlightTrack | null> {
  const res = await fetch(`${TRACKS_URL}?icao24=${icao24}&time=0`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${await getToken()}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (res.status === 404) return null // no flight in progress
  if (!res.ok) throw new Error(`OpenSky ${res.status}`)
  return parseTrack(icao24, await res.json())
}

interface Options {
  fetch: typeof fetchTrack
  /** Tracks allowed per UTC day; 0 turns them off */
  perDay: number
  now: () => number
}

/**
 * Tracks on demand, kept inside OpenSky's daily credits: each aircraft's track is fetched at most once
 * every 5 minutes, and no more than `perDay` a day in all, after which there are none until midnight UTC.
 * Answers null when there's no track, none is allowed, or OpenSky fails.
 */
export function createTracks({
  fetch = fetchTrack,
  perDay = flightsAuthenticated ? tracksPerDay : 0,
  now = Date.now,
}: Partial<Options> = {}) {
  const cache = new Map<string, { at: number; track: Promise<FlightTrack | null> }>()
  let day = ''
  let used = 0

  return function track(icao24: string): Promise<FlightTrack | null> {
    const hit = cache.get(icao24)
    if (hit && now() - hit.at < CACHE_MS) return hit.track

    const today = new Date(now()).toISOString().slice(0, 10)
    if (today !== day) [day, used] = [today, 0]
    if (used >= perDay) return Promise.resolve(null)
    used++

    const track = fetch(icao24).catch((err: Error) => {
      console.error(`[tracks] ${icao24} failed:`, err.message)
      return null
    })
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!)
    cache.set(icao24, { at: now(), track })
    return track
  }
}
