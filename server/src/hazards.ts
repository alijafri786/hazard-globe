import type { Geometry } from 'geojson'
import type { GdacsCollection } from './types.js'

/** GDACS hazard types, in the order they're offered. web/src/hazards.ts lists the same, in the same order. */
export const HAZARD_TYPES = ['TC', 'FL', 'EQ', 'VO', 'WF', 'DR'] as const
export type HazardType = (typeof HAZARD_TYPES)[number]

export const isHazardType = (v: unknown): v is HazardType => (HAZARD_TYPES as readonly unknown[]).includes(v)

/** What a watch area is sent when it doesn't choose: what every area was sent before more types existed. */
export const DEFAULT_HAZARDS: HazardType[] = ['TC', 'FL']

type Feature = GdacsCollection['features'][number]

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
   * The parts of a GDACS geometry collection that count as the area hit. When none do, alerts fall back
   * to the event's point. web/src/hazards.ts draws the same parts.
   */
  affected: (features: Feature[]) => Geometry[]
}

const cls = (f: Feature) => String(f.properties?.Class ?? '')
const polygons = (features: Feature[]) =>
  features.filter((f) => f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon').map((f) => f.geometry)

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
    affected: (fs) => fs.filter((f) => !CYCLONE_NOT_AFFECTED.test(cls(f))).map((f) => f.geometry),
  },
  FL: { name: 'Flood', affected: (fs) => fs.map((f) => f.geometry) },
  EQ: {
    name: 'Earthquake',
    manyGreen: true,
    note: 'This earthquake has already happened. Check on people there, and follow local advice about aftershocks.',
    affected: (fs) => {
      const shaking = fs.filter(
        (f) => /^Poly_SMPInt_\d+$/.test(cls(f)) && Number(f.properties?.intensity) >= EQ_MIN_INTENSITY,
      )
      // No ShakeMap yet (or nothing that strong): GDACS's 100 km circle round the epicentre
      return polygons(shaking.length ? shaking : fs.filter((f) => cls(f) === 'Poly_Circle'))
    },
  },
  VO: { name: 'Volcano', affected: polygons },
  WF: { name: 'Wildfire', manyGreen: true, affected: polygons },
  DR: { name: 'Drought', minLookbackDays: 40, affected: polygons },
}
