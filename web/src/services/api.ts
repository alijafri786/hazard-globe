import type {
  AuroraGrid,
  DartReadings,
  DartStation,
  TsunamiMessage,
  EventReports,
  ChannelView,
  SpaceWeatherSummary,
  ClimatologyInfo,
  PlaceClimatology,
  StormClass,
  EventsResponse,
  FlightsResponse,
  FlightTrack,
  HazardType,
  QuakeFeed,
  QuakesResponse,
  SatellitesResponse,
  ShipDetails,
  ShipsResponse,
  WindGrid,
  ServerChannels,
  SubscriptionView,
  WatchArea,
} from '../types'

const BASE = import.meta.env.VITE_API_BASE ?? ''

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) {
    const msg = await res.json().then((b) => b.error).catch(() => res.statusText)
    throw new ApiError(msg || `Request failed (${res.status})`, res.status)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

export const api = {
  events: () => request<EventsResponse>('/api/events'),

  history: (days: number) => request<EventsResponse>(`/api/events/history?days=${days}`),

  geometry: (type: HazardType, eventid: number, episodeid: number) =>
    request<{ type: 'FeatureCollection'; features: unknown[] }>(`/api/events/${type}/${eventid}/${episodeid}/geometry`),

  flights: () => request<FlightsResponse>('/api/flights'),

  /** Null when the server has no track for it */
  flightTrack: (icao24: string) =>
    request<FlightTrack>(`/api/flights/${icao24}/track`).catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }),

  ships: () => request<ShipsResponse>('/api/ships'),

  wind: () => request<WindGrid>('/api/weather/wind'),

  ship: (mmsi: number) => request<ShipDetails>(`/api/ships/${mmsi}`),

  climatology: () => request<ClimatologyInfo>('/api/climatology'),

  /** Storms per cell over the whole period: Uint16, row-major from the north-west */
  climatologyGrid: async (cls: StormClass, month: number) => {
    const res = await fetch(`${BASE}/api/climatology/grid?class=${cls}&month=${month}`)
    if (!res.ok) throw new ApiError(`Storm climatology unavailable (${res.status})`, res.status)
    return new Uint16Array(await res.arrayBuffer())
  },

  climatologyNear: (lon: number, lat: number, radiusKm: number) =>
    request<PlaceClimatology>(`/api/climatology/near?lon=${lon}&lat=${lat}&radiusKm=${radiusKm}`),

  /** Null when the server has no ReliefWeb app name set up */
  reports: (q: { type: HazardType; glide?: string; iso3?: string; date?: string }) => {
    const params = new URLSearchParams({ type: q.type })
    for (const k of ['glide', 'iso3', 'date'] as const) if (q[k]) params.set(k, q[k]!)
    return request<EventReports>(`/api/reports?${params}`).catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 501) return null
      throw err
    })
  },

  tsunami: () => request<{ fetchedAt: string; messages: TsunamiMessage[] }>('/api/tsunami'),

  dartStations: () => request<{ stations: DartStation[] }>('/api/dart'),

  dartReadings: (id: string) => request<DartReadings>(`/api/dart/${encodeURIComponent(id)}`),

  aurora: () => request<AuroraGrid>('/api/space/aurora'),

  spaceWeather: () => request<SpaceWeatherSummary>('/api/space/summary'),

  earthquakes: (feed: QuakeFeed) => request<QuakesResponse>(`/api/earthquakes?feed=${feed}`),

  satellites: (group: string) => request<SatellitesResponse>(`/api/satellites/${group}`),

  publicKey: () => request<{ publicKey: string }>('/api/push/public-key'),

  channels: () => request<ServerChannels>('/api/channels'),

  /** For `push` and `email`: leave out to keep what the server has, null to remove, a value to set. */
  subscribe: (body: { id?: string; areas: WatchArea[]; push?: PushSubscriptionJSON | null; email?: string | null }) =>
    request<SubscriptionView>('/api/subscriptions', { method: 'POST', body: JSON.stringify(body) }),

  subscription: (id: string) => request<SubscriptionView>(`/api/subscriptions/${id}`),

  resendEmail: (id: string) =>
    request<Pick<SubscriptionView, 'emailConfirmation'>>(`/api/subscriptions/${id}/email/resend`, { method: 'POST' }),

  connectTelegram: (id: string) => request<{ url: string }>(`/api/subscriptions/${id}/telegram`, { method: 'POST' }),

  disconnectTelegram: (id: string) => request<void>(`/api/subscriptions/${id}/telegram`, { method: 'DELETE' }),

  test: (id: string) =>
    request<{ result: 'sent' | 'failed'; channels: Partial<Record<ChannelView['kind'], 'sent' | 'gone' | 'failed'>> }>(
      `/api/subscriptions/${id}/test`,
      { method: 'POST' },
    ),

  unsubscribe: (id: string) => request<void>(`/api/subscriptions/${id}`, { method: 'DELETE' }),
}
