import { config } from './config.js'
import type { Flight, FlightsSnapshot } from './types.js'

const STATES_URL = 'https://opensky-network.org/api/states/all'
const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'
const TIMEOUT_MS = 30_000

// A global /states/all call costs 4 credits. Daily budgets: 400 anonymous, 4000 with a free account.
// These floors keep a server that is busy all day inside its budget.
const MIN_REFRESH_SECONDS = { anonymous: 900, authenticated: 90 }

export const flightsAuthenticated = Boolean(config.opensky.clientId && config.opensky.clientSecret)
export const flightsRefreshSeconds = Math.max(
  MIN_REFRESH_SECONDS[flightsAuthenticated ? 'authenticated' : 'anonymous'],
  config.opensky.refreshSeconds ?? (flightsAuthenticated ? 120 : 900),
)

class RateLimited extends Error {
  constructor() {
    super('OpenSky credit limit reached')
  }
}

let token: { value: string; expiresAt: number } | null = null

async function getToken(): Promise<string> {
  if (token && Date.now() < token.expiresAt) return token.value
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.opensky.clientId,
      client_secret: config.opensky.clientSecret,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`OpenSky auth ${res.status}: check OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET`)
  const body = (await res.json()) as { access_token: string; expires_in: number }
  // refresh a minute early so a token never expires mid-request
  token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 }
  return token.value
}

// OpenSky state vector: positional array, see https://openskynetwork.github.io/opensky-api/rest.html
type StateVector = [
  icao24: string,
  callsign: string | null,
  originCountry: string,
  timePosition: number | null,
  lastContact: number,
  longitude: number | null,
  latitude: number | null,
  baroAltitude: number | null,
  onGround: boolean,
  velocity: number | null,
  trueTrack: number | null,
  verticalRate: number | null,
  ...rest: unknown[],
]

async function fetchStates(retryAuth = true): Promise<{ time: number; states: StateVector[] | null }> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (flightsAuthenticated) headers.Authorization = `Bearer ${await getToken()}`
  const res = await fetch(STATES_URL, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (res.status === 401 && flightsAuthenticated && retryAuth) {
    token = null
    return fetchStates(false)
  }
  if (res.status === 429) throw new RateLimited()
  if (!res.ok) throw new Error(`OpenSky ${res.status}`)
  return res.json() as Promise<{ time: number; states: StateVector[] | null }>
}

const round = (n: number | null, digits: number) => (n == null ? null : Number(n.toFixed(digits)))

/** Airborne aircraft with a known position, trimmed to the fields the globe uses. */
function toFlights(states: StateVector[]): Flight[] {
  const flights: Flight[] = []
  for (const s of states) {
    const [icao24, callsign, country, , , lon, lat, alt, onGround, velocity, track, verticalRate] = s
    if (onGround || lon == null || lat == null) continue
    flights.push([
      icao24,
      callsign?.trim() ?? '',
      country,
      round(lon, 4)!,
      round(lat, 4)!,
      Math.round(alt ?? 0),
      round(velocity, 1),
      round(track, 0),
      round(verticalRate, 1),
    ])
  }
  return flights
}

const FAILURE_RETRY_SECONDS = 60

let latest: FlightsSnapshot | null = null
let nextAttemptAt = 0
let inflight: Promise<void> | null = null

async function refresh(): Promise<void> {
  const started = Date.now()
  try {
    const data = await fetchStates()
    latest = {
      time: new Date(data.time * 1000).toISOString(),
      refreshSeconds: flightsRefreshSeconds,
      flights: toFlights(data.states ?? []),
    }
    nextAttemptAt = started + flightsRefreshSeconds * 1000
    console.log(`[flights] ${latest.flights.length} airborne, ${Date.now() - started}ms`)
  } catch (err) {
    // errors don't spend credits, so retry soon, but a rate limit has to wait out the full interval
    const wait = err instanceof RateLimited ? flightsRefreshSeconds : FAILURE_RETRY_SECONDS
    nextAttemptAt = Date.now() + wait * 1000
    console.error('[flights] failed:', (err as Error).message)
  }
}

/**
 * Latest snapshot, refreshed on demand: OpenSky is only called while someone is looking at flights,
 * and never more often than the credit budget allows.
 */
export async function getFlights(): Promise<FlightsSnapshot | null> {
  if (Date.now() >= nextAttemptAt) {
    inflight ??= refresh().finally(() => {
      inflight = null
    })
  }
  // wait for a due refresh so clients timed to the refresh interval get the new snapshot, not the old one
  if (inflight) await inflight
  return latest
}
