import type {
  AlertLevel,
  EmailChannel,
  GdacsEvent,
  GdacsEventProps,
  PushChannel,
  Subscription,
  TelegramChannel,
  WatchArea,
} from '../src/types.js'

export const pushChannel = (n: number | string = 1): PushChannel => ({
  kind: 'push',
  endpoint: `https://push.example/${n}`,
  keys: { p256dh: 'p', auth: 'a' },
})
export const emailChannel = (overrides: Partial<EmailChannel> = {}): EmailChannel => ({
  kind: 'email',
  address: 'me@example.com',
  verified: true,
  token: 'email-token',
  ...overrides,
})
export const telegramChannel = (overrides: Partial<TelegramChannel> = {}): TelegramChannel => ({
  kind: 'telegram',
  chatId: '4242',
  token: 'telegram-token',
  ...overrides,
})

export function makeArea(overrides: Partial<WatchArea> = {}): WatchArea {
  return {
    id: 'area-1',
    label: 'Home',
    lon: 0,
    lat: 0,
    radiusKm: 100,
    hazards: ['TC', 'FL'],
    minAlert: 'Orange',
    notified: {},
    ...overrides,
  }
}

/** A subscription with one area built from `area`, unless `areas` is given. */
export function makeSub(
  overrides: Partial<Omit<Subscription, 'areas'>> & { area?: Partial<WatchArea>; areas?: WatchArea[] } = {},
): Subscription {
  const { area, areas, ...rest } = overrides
  return {
    id: 'sub-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    channels: [pushChannel()],
    areas: areas ?? [makeArea(area)],
    ...rest,
  }
}

/** A `notified` record saying the area was already alerted about `key` at `level`. */
export const alerted = (key: string, level: AlertLevel, at = '2026-01-01T00:00:00.000Z') => ({ [key]: { level, at } })

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
