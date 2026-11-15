import { USER_AGENT } from './gdacs.js'
import { createCachedSource } from './source.js'
import type { OrbitalElements, SatellitesSnapshot } from './types.js'

const GP_URL = 'https://celestrak.org/NORAD/elements/gp.php'
const TIMEOUT_MS = 60_000

/** The CelesTrak groups offered. `active` is every working satellite (~17,000), `starlink` most of those. */
export const SATELLITE_GROUPS = ['stations', 'visual', 'gnss', 'weather', 'starlink', 'active'] as const
export type SatelliteGroup = (typeof SATELLITE_GROUPS)[number]
export const isSatelliteGroup = (s: string): s is SatelliteGroup => (SATELLITE_GROUPS as readonly string[]).includes(s)

// CelesTrak updates its elements about every 2 hours and blocks clients that download unchanged data more often
const TTL_MS = 2 * 60 * 60_000
// A failure isn't retried for a while, so a CelesTrak outage doesn't turn into one request per visitor
const FAILURE_RETRY_MS = 10 * 60_000

const NUMBERS = [
  'MEAN_MOTION',
  'ECCENTRICITY',
  'INCLINATION',
  'RA_OF_ASC_NODE',
  'ARG_OF_PERICENTER',
  'MEAN_ANOMALY',
  'BSTAR',
  'MEAN_MOTION_DOT',
  'MEAN_MOTION_DDOT',
  'ELEMENT_SET_NO',
] as const

/** CelesTrak's OMM JSON, checked and trimmed: anything malformed is left out rather than passed on. */
export function parseElements(body: unknown): OrbitalElements[] {
  if (!Array.isArray(body)) throw new Error('CelesTrak sent something other than a list')
  const out: OrbitalElements[] = []
  for (const raw of body as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object') continue
    const { OBJECT_NAME, OBJECT_ID, NORAD_CAT_ID, EPOCH } = raw
    if (typeof OBJECT_NAME !== 'string' || typeof OBJECT_ID !== 'string' || typeof EPOCH !== 'string') continue
    if (!Number.isInteger(NORAD_CAT_ID) || Number.isNaN(Date.parse(`${EPOCH}Z`))) continue
    if (raw.EPHEMERIS_TYPE !== undefined && raw.EPHEMERIS_TYPE !== 0) continue // only SGP4 elements
    if (!NUMBERS.every((k) => typeof raw[k] === 'number' && Number.isFinite(raw[k]))) continue
    if ((raw.MEAN_MOTION as number) <= 0) continue
    const el = { OBJECT_NAME: OBJECT_NAME.trim(), OBJECT_ID, NORAD_CAT_ID, EPOCH } as OrbitalElements
    for (const k of NUMBERS) el[k] = raw[k] as number
    out.push(el)
  }
  return out
}

export async function fetchGroup(group: SatelliteGroup): Promise<OrbitalElements[]> {
  const res = await fetch(`${GP_URL}?GROUP=${group}&FORMAT=json`, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`CelesTrak ${res.status}`)
  const text = await res.text()
  // An unknown or empty group comes back as 200 with a line of text, not JSON
  if (!text.startsWith('[')) throw new Error(`CelesTrak: ${text.slice(0, 80)}`)
  return parseElements(JSON.parse(text))
}

/**
 * Orbits by group, fetched from CelesTrak at most once per 2 hours whoever is looking. A due refresh
 * is shared by concurrent requests; while it runs, and if it fails, the last good copy is served.
 * Orbits a couple of hours old are still good to a few km, so only the very first request waits.
 */
export function createSatellites(fetch: typeof fetchGroup = fetchGroup, now = Date.now) {
  const source = createCachedSource<SatelliteGroup, SatellitesSnapshot>({
    ttlMs: TTL_MS,
    failureRetryMs: FAILURE_RETRY_MS,
    name: 'satellites',
    now,
    fetch: async (group) => {
      const satellites = await fetch(group)
      console.log(`[satellites] ${group}: ${satellites.length}`)
      return { group, fetchedAt: new Date(now()).toISOString(), satellites }
    },
  })
  return (group: SatelliteGroup): Promise<SatellitesSnapshot | null> => source.get(group)
}
