import type { EventsResponse, FlightsResponse, HazardType, SubscriptionView, WatchArea } from '../types'

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

  geometry: (type: HazardType, eventid: number, episodeid: number) =>
    request<{ type: 'FeatureCollection'; features: unknown[] }>(`/api/events/${type}/${eventid}/${episodeid}/geometry`),

  flights: () => request<FlightsResponse>('/api/flights'),

  publicKey: () => request<{ publicKey: string }>('/api/push/public-key'),

  subscribe: (body: { id?: string; areas: WatchArea[]; push: PushSubscriptionJSON }) =>
    request<SubscriptionView>('/api/subscriptions', { method: 'POST', body: JSON.stringify(body) }),

  subscription: (id: string) => request<SubscriptionView>(`/api/subscriptions/${id}`),

  test: (id: string) => request<{ result: string }>(`/api/subscriptions/${id}/test`, { method: 'POST' }),

  unsubscribe: (id: string) => request<void>(`/api/subscriptions/${id}`, { method: 'DELETE' }),
}
