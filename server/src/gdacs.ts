import type { Geometry } from 'geojson'
import { config } from './config.js'
import type { AlertLevel, GdacsCollection, GdacsEvent, HazardType } from './types.js'

const BASE = 'https://www.gdacs.org/gdacsapi/api'
const LEVELS: AlertLevel[] = ['Green', 'Orange', 'Red']
const PAGE_SIZE = 100
const USER_AGENT = 'hazard-globe (open-source; https://github.com/your-org/hazard-globe)'
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
 * Fetch recent storm and flood events.
 * Alert levels are requested one at a time and de-duplicated on eventid:
 * the combined `alertlevel=a;b` filter has been reported as unreliable, and an
 * event's level can change during its lifetime.
 */
export async function fetchEvents(hazards: HazardType[] = ['TC', 'FL']): Promise<GdacsCollection> {
  const to = new Date()
  const from = new Date(to.getTime() - config.lookbackDays * 86_400_000)
  const byId = new Map<string, GdacsEvent>()

  for (const level of LEVELS) {
    for (let page = 1; page <= 10; page++) {
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

  return { type: 'FeatureCollection', features: [...byId.values()] }
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
  const data = await getJson<GdacsCollection>(`${BASE}/polygons/getgeometry?${params}`)
  if (data?.features?.length) {
    geometryCache.set(key, data)
    if (geometryCache.size > GEOMETRY_CACHE_SIZE) geometryCache.delete(geometryCache.keys().next().value as string)
  }
  return data
}

export async function fetchEventGeometry(
  eventtype: HazardType,
  eventid: number,
  episodeid: number,
): Promise<Geometry[]> {
  const data = await fetchGeometryCollection(eventtype, eventid, episodeid)
  return (data?.features ?? []).map((f) => f.geometry).filter((g): g is Geometry => Boolean(g))
}
