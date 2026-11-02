import type {
  ChannelView,
  EventsResponse,
  FlightsResponse,
  HazardType,
  SatellitesResponse,
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
