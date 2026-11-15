import { config } from './config.js'
import { HAZARD_TYPES, HAZARDS } from './hazards.js'
import type { AlertLevel, GdacsCollection, GdacsEvent, HazardType } from './types.js'

const BASE = 'https://www.gdacs.org/gdacsapi/api'
const LEVELS: AlertLevel[] = ['Green', 'Orange', 'Red']
const PAGE_SIZE = 100
export const USER_AGENT = 'hazard-globe (open-source; https://github.com/alijafri786/hazard-globe)'
// GDACS can take 30s+ to answer when busy, and a request with no timeout could block polling forever
const TIMEOUT_MS = 60_000

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  // GDACS returns 204/404 for "no results" rather than an empty collection
  if (res.status === 204 || res.status === 404) return null
  if (!res.ok) throw new Error(`GDACS ${res.status} for ${url}`)
  const text = await res.text()
  return text ? (JSON.parse(text) as T) : null
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Groups hazard types by how many days back to ask for them, so each group is one GDACS query:
 * `days` for most, longer for those whose latest episode can be weeks old (droughts).
 */
export function lookbackGroups(hazards: readonly HazardType[], days: number): { days: number; hazards: HazardType[] }[] {
  const groups = new Map<number, HazardType[]>()
  for (const h of hazards) {
    const d = Math.max(days, HAZARDS[h].minLookbackDays ?? 0)
    groups.set(d, [...(groups.get(d) ?? []), h])
  }
  return [...groups].map(([d, hs]) => ({ days: d, hazards: hs }))
}

/**
 * Fetch events of every hazard type from the last `days` days (longer for types that need it).
 * Alert levels are requested one at a time and de-duplicated on eventid:
 * the combined `alertlevel=a;b` filter has been reported as unreliable, and an
 * event's level can change during its lifetime. Each level of each look-back group pages
 * up to `maxPages`. `skipManyGreen` leaves out the Green events of types GDACS lists hundreds of.
 */
export async function fetchEvents({
  days = config.lookbackDays,
  hazards = HAZARD_TYPES,
  maxPages = 10,
  skipManyGreen = false,
}: {
  days?: number
  hazards?: readonly HazardType[]
  maxPages?: number
  skipManyGreen?: boolean
} = {}): Promise<GdacsCollection> {
  const byId = new Map<string, GdacsEvent>()
  for (const group of lookbackGroups(hazards, days)) {
    for (const level of LEVELS) {
      const types = level === 'Green' && skipManyGreen ? group.hazards.filter((h) => !HAZARDS[h].manyGreen) : group.hazards
      if (types.length) await fetchLevel(types, level, group.days, maxPages, byId)
    }
  }
  return { type: 'FeatureCollection', features: [...byId.values()] }
}

async function fetchLevel(
  hazards: HazardType[],
  level: AlertLevel,
  days: number,
  maxPages: number,
  byId: Map<string, GdacsEvent>,
) {
  const to = new Date()
  const from = new Date(to.getTime() - days * 86_400_000)
  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      eventlist: hazards.join(';'),
      alertlevel: level,
      fromdate: ymd(from),
      todate: ymd(to),
      pageSize: String(PAGE_SIZE),
      pageNumber: String(page),
    })
    const url = `${BASE}/events/geteventlist/SEARCH?${params}`
    // GDACS returns occasional transient 503s: retry once before giving up on the whole poll
    const data = await getJson<GdacsCollection>(url).catch(async () => {
      await new Promise((r) => setTimeout(r, 3000))
      return getJson<GdacsCollection>(url)
    })
    const features = data?.features ?? []
    for (const f of features) {
      const p = f.properties
      if (!p || !hazards.includes(p.eventtype)) continue
      const key = `${p.eventtype}-${p.eventid}`
      const existing = byId.get(key)
      // keep the latest episode of each event
      if (!existing || p.episodeid > existing.properties.episodeid) byId.set(key, f)
    }
    if (features.length < PAGE_SIZE) break
  }
}

const geometryCache = new Map<string, GdacsCollection>()
const GEOMETRY_CACHE_SIZE = 200 // cyclone collections can be a few hundred KB each

/**
 * Affected-area features (cyclone wind buffers/tracks, flood extents) for one episode, shared by the
 * poller and the public API. Empty answers aren't cached: GDACS often adds the footprint later.
 */
export async function fetchGeometryCollection(
  eventtype: HazardType,
  eventid: number,
  episodeid: number,
): Promise<GdacsCollection | null> {
  const key = `${eventtype}-${eventid}-${episodeid}`
  const hit = geometryCache.get(key)
  if (hit) return hit

  const params = new URLSearchParams({ eventtype, eventid: String(eventid), episodeid: String(episodeid) })
  const raw = await getJson<GdacsCollection>(`${BASE}/polygons/getgeometry?${params}`)
  const trim = HAZARDS[eventtype]?.trim
  // e.g. an earthquake's weak contours: most of its size, never drawn or matched
  const data = raw?.features && trim ? ({ ...raw, features: trim(raw.features) } as GdacsCollection) : raw
  if (data?.features?.length) {
    geometryCache.set(key, data)
    if (geometryCache.size > GEOMETRY_CACHE_SIZE) geometryCache.delete(geometryCache.keys().next().value as string)
  }
  return data
}
