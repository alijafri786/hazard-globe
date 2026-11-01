/** One feature of a GDACS geometry collection */
export interface GeoFeature {
  type: 'Feature'
  geometry: { type: string; coordinates: unknown } | null
  properties?: Record<string, unknown> | null
}

export interface CycloneParts {
  /** wind buffers (or, for floods, everything): drawn as the affected area */
  area: GeoFeature[]
  /** outer ring of the uncertainty cone, as [lon, lat] pairs */
  cone: number[][] | null
  track: { coords: number[][]; forecast: boolean }[]
  /** forecast positions only: observed ones are on the track already */
  forecastPoints: { lon: number; lat: number; time: number }[]
}

const kind = (f: GeoFeature) => String(f.properties?.Class ?? '')
const NOT_AREA = /^(Poly_Cones|Point_Centroid|Point_Polygon_Point_\d+|Line_Line_\d+)$/

/** GDACS dates carry no zone and are UTC */
const utc = (s: string) => Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(s) ? s : `${s}Z`)

/** Centre of the small circle GDACS draws for a track point, safe across the 180° meridian */
function centre(ring: number[][]): [number, number] {
  const pts = ring.slice(0, -1)
  const wraps = Math.max(...pts.map(([x]) => x)) - Math.min(...pts.map(([x]) => x)) > 180
  const lon = pts.reduce((s, [x]) => s + (wraps && x < 0 ? x + 360 : x), 0) / pts.length
  return [lon > 180 ? lon - 360 : lon, pts.reduce((s, [, y]) => s + y, 0) / pts.length]
}

/** A track point's "MMDDHHMM" key, in the issue's year (a January point of a December issue is next year's) */
function pointTime(key: unknown, issued: Date): number | null {
  const m = /^(\d\d)(\d\d)(\d\d)(\d\d)$/.exec(String(key ?? ''))
  if (!m) return null
  const [month, day, hour, minute] = m.slice(1).map(Number)
  let year = issued.getUTCFullYear()
  if (month - 1 < issued.getUTCMonth() - 6) year++
  else if (month - 1 > issued.getUTCMonth() + 6) year--
  return Date.UTC(year, month - 1, day, hour, minute)
}

/** Separates a GDACS geometry collection into what to draw how. Mirrors server/src/forecast.ts. */
export function splitCyclone(features: GeoFeature[], eventtype: string): CycloneParts {
  const withGeometry = features.filter((f) => f.geometry)
  if (eventtype !== 'TC') return { area: withGeometry, cone: null, track: [], forecastPoints: [] }

  const cone = withGeometry.find((f) => kind(f) === 'Poly_Cones' && f.geometry!.type === 'Polygon')
  const issuedAt = (cone ?? withGeometry.find((f) => f.properties?.polygondate))?.properties?.polygondate
  const issued = typeof issuedAt === 'string' ? new Date(utc(issuedAt)) : null

  return {
    area: withGeometry.filter((f) => !NOT_AREA.test(kind(f))),
    cone: cone ? (cone.geometry!.coordinates as number[][][])[0] : null,
    track: withGeometry
      .filter((f) => /^Line_Line_\d+$/.test(kind(f)) && f.geometry!.type === 'LineString')
      .map((f) => ({ coords: f.geometry!.coordinates as number[][], forecast: f.properties?.forecast === true })),
    forecastPoints: issued
      ? withGeometry
          .filter((f) => /^Point_Polygon_Point_\d+$/.test(kind(f)) && f.geometry!.type === 'Polygon')
          .flatMap((f) => {
            const time = pointTime(f.properties?.key, issued)
            if (time === null || time <= issued.getTime()) return []
            const [lon, lat] = centre((f.geometry!.coordinates as number[][][])[0])
            return [{ lon, lat, time }]
          })
          .sort((a, b) => a.time - b.time)
      : [],
  }
}
