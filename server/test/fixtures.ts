import type { GdacsEvent, GdacsEventProps, Subscription, WatchArea } from '../src/types.js'

export function makeSub(overrides: Partial<Omit<Subscription, 'area'>> & { area?: Partial<WatchArea> } = {}): Subscription {
  const { area, ...rest } = overrides
  return {
    id: 'sub-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    hazards: ['TC', 'FL'],
    minAlert: 'Orange',
    push: { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } },
    notified: {},
    ...rest,
    area: { label: 'Home', lon: 0, lat: 0, radiusKm: 100, ...area },
  }
}

export function makeEvent(props: Partial<GdacsEventProps> = {}, at: [number, number] = [0, 0]): GdacsEvent {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: at },
    properties: {
      eventtype: 'TC',
      eventid: 1000,
      episodeid: 1,
      name: 'Alpha',
      alertlevel: 'Orange',
      ...props,
    },
  }
}

/** A square polygon of `half` degrees around a centre. */
export function square(lon: number, lat: number, half: number) {
  return {
    type: 'Polygon' as const,
    coordinates: [
      [
        [lon - half, lat - half],
        [lon + half, lat - half],
        [lon + half, lat + half],
        [lon - half, lat + half],
        [lon - half, lat - half],
      ],
    ],
  }
}
