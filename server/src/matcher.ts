import booleanIntersects from '@turf/boolean-intersects'
import circle from '@turf/circle'
import type { Feature, Geometry, Polygon } from 'geojson'
import type { WatchArea } from './types.js'

export function areaPolygon(area: WatchArea): Feature<Polygon> {
  return circle([area.lon, area.lat], area.radiusKm, { units: 'kilometers', steps: 64 })
}

/**
 * True when any affected-area geometry, or the event's own location, touches the watch area.
 * Falls back to the event point when GDACS has no polygon yet (common early in an event).
 */
export function touchesArea(area: WatchArea, eventGeometry: Geometry | null, affected: Geometry[]): boolean {
  const zone = areaPolygon(area)
  const candidates = affected.length ? affected : eventGeometry ? [eventGeometry] : []
  return candidates.some((g) => {
    try {
      return booleanIntersects(zone, { type: 'Feature', properties: {}, geometry: g })
    } catch {
      return false // malformed geometry from upstream should never crash the poller
    }
  })
}
