import type { Geometry, Polygon } from 'geojson'
import type { GdacsCollection, HazardType } from './types.js'

export interface TrackPoint {
  time: string
  lon: number
  lat: number
  /** after the forecast was issued, rather than observed */
  forecast: boolean
}

export interface CycloneForecast {
  issuedAt: string
  /** where the storm's centre is likely to go: not how big the storm is */
  cone: Polygon | null
  track: TrackPoint[]
}

export interface EventDetails {
  /** what the event is expected to hit: cyclone wind buffers, flood extents */
  affected: Geometry[]
  forecast: CycloneForecast | null
}

// A GDACS cyclone geometry collection mixes the wind buffers (Poly_Green/Orange/Red) with things that are
// not an affected area: the uncertainty cone, the track, its points and the event's own centroid.
const NOT_AFFECTED = /^(Poly_Cones|Point_Centroid|Point_Polygon_Point_\d+|Line_Line_\d+)$/
const TRACK_POINT = /^Point_Polygon_Point_\d+$/

/** GDACS dates carry no zone and are UTC */
const utc = (s: string) => new Date(/(Z|[+-]\d\d:?\d\d)$/i.test(s) ? s : `${s}Z`)

/** Centre of the small circle GDACS draws for each track point, safe across the 180° meridian. */
function centre(poly: Polygon): [lon: number, lat: number] {
  const ring = poly.coordinates[0].slice(0, -1)
  const lons = ring.map(([lon]) => lon)
  const wraps = Math.max(...lons) - Math.min(...lons) > 180
  const lon = ring.reduce((sum, [x]) => sum + (wraps && x < 0 ? x + 360 : x), 0) / ring.length
  const lat = ring.reduce((sum, [, y]) => sum + y, 0) / ring.length
  return [lon > 180 ? lon - 360 : lon, lat]
}

/** A track point's "MMDDHHMM" key, in the year of the issue: a January point of a December issue is next year's. */
function pointTime(key: unknown, issued: Date): Date | null {
  const m = /^(\d\d)(\d\d)(\d\d)(\d\d)$/.exec(String(key ?? ''))
  if (!m) return null
  const [month, day, hour, minute] = m.slice(1).map(Number)
  let year = issued.getUTCFullYear()
  if (month - 1 < issued.getUTCMonth() - 6) year++
  else if (month - 1 > issued.getUTCMonth() + 6) year--
  return new Date(Date.UTC(year, month - 1, day, hour, minute))
}

/** Splits an event's GDACS geometry into the area it affects and, for cyclones, its forecast. */
export function splitGeometry(collection: GdacsCollection | null, eventtype: HazardType): EventDetails {
  const features = (collection?.features ?? []).filter((f) => f.geometry)
  if (eventtype !== 'TC') return { affected: features.map((f) => f.geometry), forecast: null }

  const kind = (f: (typeof features)[number]) => String(f.properties?.Class ?? '')
  const affected = features.filter((f) => !NOT_AFFECTED.test(kind(f))).map((f) => f.geometry)
  const cone = features.find((f) => kind(f) === 'Poly_Cones' && f.geometry.type === 'Polygon')
  const issuedAt = (cone ?? features.find((f) => f.properties?.polygondate))?.properties?.polygondate
  if (typeof issuedAt !== 'string') return { affected, forecast: null }

  const issued = utc(issuedAt)
  const track = features
    .filter((f) => TRACK_POINT.test(kind(f)) && f.geometry.type === 'Polygon')
    .flatMap((f): TrackPoint[] => {
      const time = pointTime(f.properties?.key, issued)
      if (!time) return []
      const [lon, lat] = centre(f.geometry as Polygon)
      return [{ time: time.toISOString(), lon, lat, forecast: time > issued }]
    })
    .sort((a, b) => a.time.localeCompare(b.time))

  return {
    affected,
    forecast: { issuedAt: issued.toISOString(), cone: (cone?.geometry as Polygon | undefined) ?? null, track },
  }
}
