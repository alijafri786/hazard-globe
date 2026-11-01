import type { AlertLevel, EventsResponse, FlightsResponse, HazardType, WatchArea } from '../types'

const BASE = import.meta.env.VITE_API_BASE ?? ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) {
    const msg = await res.json().then((b) => b.error).catch(() => res.statusText)
    throw new Error(msg || `Request failed (${res.status})`)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

export const api = {
  events: () => request<EventsResponse>('/api/events'),

  geometry: (type: HazardType, eventid: number, episodeid: number) =>
    request<{ type: 'FeatureCollection'; features: unknown[] }>(`/api/events/${type}/${eventid}/${episodeid}/geometry`),

  flights: () => request<FlightsResponse>('/api/flights'),

  publicKey: () => request<{ publicKey: string }>('/api/push/public-key'),

  subscribe: (body: {
    id?: string
    area: WatchArea
    hazards: HazardType[]
    minAlert: AlertLevel
    push: PushSubscriptionJSON
  }) => request<{ id: string }>('/api/subscriptions', { method: 'POST', body: JSON.stringify(body) }),

  test: (id: string) => request<{ result: string }>(`/api/subscriptions/${id}/test`, { method: 'POST' }),

  unsubscribe: (id: string) => request<void>(`/api/subscriptions/${id}`, { method: 'DELETE' }),
}
