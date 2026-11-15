import type { Geometry } from 'geojson'
import type { GdacsCollection } from './types.js'

/** GDACS hazard types, in the order they're offered. web/src/hazards.ts lists the same, in the same order. */
export const HAZARD_TYPES = ['TC', 'FL', 'EQ', 'VO', 'WF', 'DR'] as const
export type HazardType = (typeof HAZARD_TYPES)[number]

export const isHazardType = (v: unknown): v is HazardType => (HAZARD_TYPES as readonly unknown[]).includes(v)

/** What a watch area is sent when it doesn't choose: what every area was sent before more types existed. */
export const DEFAULT_HAZARDS: HazardType[] = ['TC', 'FL']

/** A feature of a GDACS geometry collection; trim() can leave one with no geometry, keeping its properties */
type Feature = Omit<GdacsCollection['features'][number], 'geometry'> & { geometry: Geometry | null }

export interface HazardInfo {
  /** In an alert's title: "ORANGE Earthquake alert" */
  name: string
  /**
   * Fewest days back to ask GDACS for. A drought's latest episode can be weeks old while it's still going,
   * so a short look-back would lose it.
   */
  minLookbackDays?: number
  /**
   * GDACS lists hundreds of Green events of this type a week (over 1,600 earthquakes and 2,500 wildfires
   * in 90 days), so History leaves its Green ones out: dozens of requests and thousands of markers.
   */
  manyGreen?: boolean
  /** A line added to the alert, when the hazard needs saying something about */
  note?: string
  /**
   * The parts of a GDACS geometry collection that count as the area hit. An empty list means GDACS has no
   * footprint yet, and alerts fall back to the event's point; 'none' means GDACS's own map shows the
   * event reached nowhere that counts, so there is nothing to fall back to. web/src/hazards.ts draws the
   * same parts.
   */
  affected: (features: Feature[]) => Geometry[] | 'none'
  /**
   * Furthest, in km, the footprint can reach from the event's point. Alerts don't fetch the footprint of
   * an event further than this from every area that wants it: with Green alerts on, earthquakes and
   * wildfires would otherwise mean hundreds of footprint requests to GDACS each poll. Left out for types
   * whose footprint can run thousands of km from the point (a cyclone's track, a drought).
   */
  maxReachKm?: number
  /**
   * Drops what will never be drawn or matched from a collection before it's cached and served, keeping
   * the features (and what they say) but not their geometry.
   */
  trim?: (features: Feature[]) => Feature[]
}

const cls = (f: Feature) => String(f.properties?.Class ?? '')
const geometries = (features: Feature[]) => features.flatMap((f) => (f.geometry ? [f.geometry] : []))
const polygons = (features: Feature[]) =>
  geometries(features).filter((g) => g.type === 'Polygon' || g.type === 'MultiPolygon')
const isShakeContour = (f: Feature) => /^Poly_SMPInt_\d+$/.test(cls(f))
const isStrong = (f: Feature) => Number(f.properties?.intensity) >= EQ_MIN_INTENSITY

/**
 * Shaking intensity (MMI) from which GDACS's ShakeMap contours count as the area hit: VI is felt by
 * everyone and where light damage starts. Weaker shaking reaches far and would alert half a continent.
 */
export const EQ_MIN_INTENSITY = 6

// A GDACS cyclone geometry collection mixes the wind buffers (Poly_Green/Orange/Red) with things that are
// not an affected area: the uncertainty cone, the track, its points and the event's own centroid.
const CYCLONE_NOT_AFFECTED = /^(Poly_Cones|Point_Centroid|Point_Polygon_Point_\d+|Line_Line_\d+)$/

export const HAZARDS: Record<HazardType, HazardInfo> = {
  TC: {
    name: 'Tropical cyclone',
    affected: (fs) => geometries(fs.filter((f) => !CYCLONE_NOT_AFFECTED.test(cls(f)))),
  },
  FL: { name: 'Flood', affected: geometries },
  EQ: {
    name: 'Earthquake',
    manyGreen: true,
    note: 'This earthquake has already happened. Check on people there, and follow local advice about aftershocks.',
    affected: (fs) => {
      const contours = fs.filter(isShakeContour)
      // No ShakeMap yet: GDACS's 100 km circle round the epicentre stands in for it
      if (!contours.length) return polygons(fs.filter((f) => cls(f) === 'Poly_Circle'))
      // A ShakeMap that shows no strong shaking anywhere: nowhere was hit, not "unknown"
      const strong = polygons(contours.filter(isStrong))
      return strong.length ? strong : 'none'
    },
    // MMI VI reached ~500 km from the M9.1 Tōhoku quake; twice that leaves room
    maxReachKm: 1000,
    // Weak contours are most of the ~600 KB: kept as features (so a ShakeMap is known to exist), not shapes
    trim: (fs) => fs.map((f) => (isShakeContour(f) && !isStrong(f) ? { ...f, geometry: null, bbox: undefined } : f)),
  },
  // GDACS's circle round a volcano is tens of km
  VO: { name: 'Volcano', affected: polygons, maxReachKm: 300 },
  // The largest fire complexes span a couple of hundred km
  WF: { name: 'Wildfire', manyGreen: true, affected: polygons, maxReachKm: 500 },
  DR: { name: 'Drought', minLookbackDays: 40, affected: polygons },
}
