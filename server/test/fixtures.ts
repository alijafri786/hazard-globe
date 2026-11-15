import type { Geometry, Polygon } from 'geojson'
import type {
  AlertLevel,
  GdacsCollection,
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
    forecastAlerts: false,
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

/** A small circle-ish polygon, as GDACS draws track points */
export function ring(lon: number, lat: number, r = 0.1): Polygon {
  const pts = Array.from({ length: 8 }, (_, i) => [lon + r * Math.cos((i * Math.PI) / 4), lat + r * Math.sin((i * Math.PI) / 4)])
  return { type: 'Polygon', coordinates: [[...pts, pts[0]]] }
}

/** A GDACS-style cyclone geometry collection: wind buffers, centroid, track lines and points, cone */
export function cycloneCollection({
  issued = '2026-06-01T18:00:00',
  wind = [square(10, 10, 1)] as Geometry[],
  cone = square(0, 0, 1) as Polygon | null,
  points = [] as { key: string; lon: number; lat: number }[],
} = {}): GdacsCollection {
  const feature = (geometry: Geometry, props: Record<string, unknown>) =>
    ({ type: 'Feature', geometry, properties: { polygondate: issued, ...props } }) as unknown as GdacsCollection['features'][number]
  return {
    type: 'FeatureCollection',
    features: [
      feature({ type: 'Point', coordinates: [0, 0] }, { Class: 'Point_Centroid' }),
      ...wind.map((g, i) => feature(g, { Class: ['Poly_Green', 'Poly_Orange', 'Poly_Red'][i % 3] })),
      feature({ type: 'LineString', coordinates: [[0, 0], [1, 1]] }, { Class: 'Line_Line_0', forecast: true }),
      ...points.map((p, i) => feature(ring(p.lon, p.lat), { Class: `Point_Polygon_Point_${i}`, key: p.key })),
      ...(cone ? [feature(cone, { Class: 'Poly_Cones', polygonlabel: 'Uncertainty Cones' })] : []),
    ],
  }
}

const gdacsFeature = (geometry: Geometry, props: Record<string, unknown>) =>
  ({ type: 'Feature', geometry, properties: props }) as unknown as GdacsCollection['features'][number]

/**
 * A GDACS earthquake geometry collection, shaped like a real one (event 1573141, Oct 2026): the epicentre,
 * a 100 km circle, and ShakeMap contours whose `intensity` steps by 0.5 and whose Class rounds it up.
 */
export function earthquakeCollection({
  at = [0, 0] as [number, number],
  contours = [4, 5, 6, 7] as number[],
} = {}): GdacsCollection {
  const [lon, lat] = at
  return {
    type: 'FeatureCollection',
    features: [
      gdacsFeature({ type: 'Point', coordinates: at }, { Class: 'Point_Centroid', polygonlabel: 'Centroid' }),
      gdacsFeature(square(lon, lat, 0.9), { Class: 'Poly_Circle', polygonlabel: '100km' }),
      // weaker shaking reaches further: intensity 4 covers the most ground
      ...contours.map((i) =>
        gdacsFeature(
          { type: 'MultiPolygon', coordinates: [square(lon, lat, 10 / i).coordinates] },
          { Class: `Poly_SMPInt_${Math.ceil(i)}`, polygonlabel: `Intensity ${i}`, intensity: i },
        ),
      ),
    ],
  }
}

/** The centroid-plus-one-polygon shape GDACS gives volcanoes (Poly_Circle), wildfires and droughts (Poly_area). */
export function areaCollection(area: Geometry, Class = 'Poly_area', at: [number, number] = [0, 0]): GdacsCollection {
  return {
    type: 'FeatureCollection',
    features: [
      gdacsFeature({ type: 'Point', coordinates: at }, { Class: 'Point_Centroid', polygonlabel: 'Centroid' }),
      gdacsFeature(area, { Class, polygonlabel: 'Affected Area' }),
    ],
  }
}
