/**
 * GDACS hazard types and how each is named and drawn. server/src/hazards.ts lists the same types in the
 * same order (a server test checks), and decides the same footprint parts this file draws.
 */
export const HAZARD_TYPES = ['TC', 'FL', 'EQ', 'VO', 'WF', 'DR'] as const
export type HazardType = (typeof HAZARD_TYPES)[number]

export type Shape = 'circle' | 'square' | 'diamond' | 'triangle' | 'flame' | 'hexagon'

export interface HazardMeta {
  /** Toggles and checkboxes: "Tropical cyclones" */
  label: string
  /** Under an event's name in the list: "Cyclone" */
  noun: string
  /** In an area's summary: "storms" */
  plural: string
  /** Marker outline, so types differ even at the same alert level */
  outline: string
  shape: Shape
}

export const HAZARDS: Record<HazardType, HazardMeta> = {
  TC: { label: 'Tropical cyclones', noun: 'Cyclone', plural: 'storms', outline: '#ffffff', shape: 'circle' },
  FL: { label: 'Floods', noun: 'Flood', plural: 'floods', outline: '#4cc3ff', shape: 'square' },
  EQ: { label: 'Earthquakes', noun: 'Earthquake', plural: 'earthquakes', outline: '#e8d5b0', shape: 'diamond' },
  VO: { label: 'Volcanoes', noun: 'Volcano', plural: 'volcanoes', outline: '#ff8a65', shape: 'triangle' },
  WF: { label: 'Wildfires', noun: 'Wildfire', plural: 'wildfires', outline: '#ffd54f', shape: 'flame' },
  DR: { label: 'Droughts', noun: 'Drought', plural: 'droughts', outline: '#c8a165', shape: 'hexagon' },
}

/** "Storms", "Storms and floods", "Storms, floods and earthquakes" */
export function hazardList(types: readonly HazardType[]): string {
  const words = HAZARD_TYPES.filter((t) => types.includes(t)).map((t) => HAZARDS[t].plural)
  const text = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : (words[0] ?? '')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Each shape's outline in a 24×24 box, centred on 12,12 */
const PATHS: Record<Shape, string> = {
  circle: 'M12 3a9 9 0 1 0 0.001 0z',
  square: 'M4 4h16v16H4z',
  diamond: 'M12 2l10 10-10 10L2 12z',
  triangle: 'M12 3l10 17H2z',
  flame: 'M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-7 1 2 1 3 3 4 0-3-1-6 0-9z',
  hexagon: 'M7 3h10l5 9-5 9H7l-5-9z',
}

/** An SVG image of a type's shape, filled with `fill`: for markers and for the toggles that match them. */
export function hazardSymbol(type: HazardType, fill: string, size = 24): string {
  const { shape, outline } = HAZARDS[type]
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">` +
    `<path d="${PATHS[shape]}" fill="${fill}" stroke="${outline}" stroke-width="2.5" stroke-linejoin="round"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** One feature of a GDACS geometry collection */
export interface GeoFeature {
  type: 'Feature'
  geometry: { type: string; coordinates: unknown } | null
  properties?: Record<string, unknown> | null
}

/** Shaking from which an earthquake's ShakeMap contours count as the area hit (MMI VI). Same as the server. */
export const EQ_MIN_INTENSITY = 6

const cls = (f: GeoFeature) => String(f.properties?.Class ?? '')
const isPolygon = (f: GeoFeature) => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon'

/**
 * The parts of a non-cyclone event's geometry to draw as the area hit: the same parts that decide alerts
 * on the server. Cyclones are split in services/cyclone.ts.
 */
export function affectedFeatures(features: GeoFeature[], type: HazardType): GeoFeature[] {
  const withGeometry = features.filter((f) => f.geometry)
  switch (type) {
    case 'FL':
      return withGeometry
    case 'EQ': {
      const shaking = withGeometry.filter(
        (f) => /^Poly_SMPInt_\d+$/.test(cls(f)) && Number(f.properties?.intensity) >= EQ_MIN_INTENSITY,
      )
      return (shaking.length ? shaking : withGeometry.filter((f) => cls(f) === 'Poly_Circle')).filter(isPolygon)
    }
    default:
      return withGeometry.filter(isPolygon)
  }
}
