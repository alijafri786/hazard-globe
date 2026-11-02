/**
 * Who flies an aircraft and where it's going, from adsbdb.com: free, no key, callable from the browser.
 * It's community data, so routes in particular can be out of date (airlines reuse callsigns).
 */
const ADSBDB = 'https://api.adsbdb.com/v0'
export const ADSBDB_URL = 'https://www.adsbdb.com'

export interface AircraftInfo {
  /** e.g. A321-271NX */
  type: string
  manufacturer: string
  registration: string
  owner: string
}

export interface Airport {
  name: string
  iata: string
  icao: string
  city: string
  lon: number
  lat: number
}

export interface FlightRoute {
  airline: string | null
  origin: Airport
  destination: Airport
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

async function get(path: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${ADSBDB}/${path}`, { signal: AbortSignal.timeout(10_000) })
  if (res.status === 404) return null // unknown aircraft or callsign
  if (!res.ok) throw new Error(`adsbdb answered ${res.status}`)
  const body = (await res.json()) as { response?: unknown }
  return body.response && typeof body.response === 'object' ? (body.response as Record<string, unknown>) : null
}

function airport(raw: unknown): Airport | null {
  const a = (raw ?? {}) as Record<string, unknown>
  const lon = num(a.longitude)
  const lat = num(a.latitude)
  if (lon === null || lat === null) return null
  return { name: str(a.name), iata: str(a.iata_code), icao: str(a.icao_code), city: str(a.municipality), lon, lat }
}

const cache = new Map<string, Promise<unknown>>()

/** Lookups are kept for the session, and failures forgotten so they can be tried again. */
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  let hit = cache.get(key) as Promise<T> | undefined
  if (!hit) {
    hit = load()
    hit.catch(() => cache.delete(key))
    cache.set(key, hit)
  }
  return hit
}

export const aircraftInfo = (icao24: string) =>
  cached(`aircraft:${icao24}`, async (): Promise<AircraftInfo | null> => {
    const a = (await get(`aircraft/${encodeURIComponent(icao24)}`))?.aircraft as Record<string, unknown> | undefined
    if (!a) return null
    return { type: str(a.type), manufacturer: str(a.manufacturer), registration: str(a.registration), owner: str(a.registered_owner) }
  })

export const flightRoute = (callsign: string) =>
  cached(`route:${callsign}`, async (): Promise<FlightRoute | null> => {
    const r = (await get(`callsign/${encodeURIComponent(callsign)}`))?.flightroute as Record<string, unknown> | undefined
    const origin = airport(r?.origin)
    const destination = airport(r?.destination)
    if (!origin || !destination) return null
    return { airline: str((r!.airline as Record<string, unknown> | null)?.name) || null, origin, destination }
  })
