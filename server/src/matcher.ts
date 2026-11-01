import booleanIntersects from '@turf/boolean-intersects'
import circle from '@turf/circle'
import type { Feature, Geometry, Polygon } from 'geojson'
import type { WatchArea } from './types.js'

type Circle = Pick<WatchArea, 'lon' | 'lat' | 'radiusKm'>

export function areaPolygon(area: Circle): Feature<Polygon> {
  return circle([area.lon, area.lat], area.radiusKm, { units: 'kilometers', steps: 64 })
}

function* positions(c: unknown): Generator<number[]> {
  if (!Array.isArray(c)) return
  if (typeof c[0] === 'number') yield c as number[]
  else for (const child of c) yield* positions(child)
}

function lonExtent(g: Geometry): [min: number, max: number] {
  if (g.type === 'GeometryCollection') {
    const extents = g.geometries.map(lonExtent)
    return [Math.min(...extents.map((e) => e[0])), Math.max(...extents.map((e) => e[1]))]
  }
  let min = Infinity
  let max = -Infinity
  for (const [lon] of positions(g.coordinates)) {
    min = Math.min(min, lon)
    max = Math.max(max, lon)
  }
  return [min, max]
}

function shiftLon(g: Geometry, delta: number): Geometry {
  if (g.type === 'GeometryCollection') return { ...g, geometries: g.geometries.map((child) => shiftLon(child, delta)) }
  const move = (c: unknown): unknown =>
    Array.isArray(c) ? (typeof c[0] === 'number' ? [c[0] + delta, ...c.slice(1)] : c.map(move)) : c
  return { ...g, coordinates: move(g.coordinates) } as Geometry
}

/**
 * Turf intersects on a flat map, so shapes that run past ±180° miss shapes on the other side of the line:
 * a 500 km circle around Fiji reaches lon 183.7, while a storm just east of the line sits at -178.
 * Returns the whole-world shifts of `g` worth testing so both sides meet.
 */
function lonShifts([zoneMin, zoneMax]: [number, number], g: Geometry): number[] {
  const [min, max] = lonExtent(g)
  const shifts = [0]
  if (zoneMax > 180 || min < -180) shifts.push(360)
  if (zoneMin < -180 || max > 180) shifts.push(-360)
  return shifts
}

/**
 * True when any affected-area geometry, or the event's own location, touches the watch area.
 * Falls back to the event point when GDACS has no polygon yet (common early in an event).
 */
export function touchesArea(area: Circle, eventGeometry: Geometry | null, affected: Geometry[]): boolean {
  const zone = areaPolygon(area)
  const zoneExtent = lonExtent(zone.geometry)
  const candidates = affected.length ? affected : eventGeometry ? [eventGeometry] : []
  return candidates.some((g) => {
    try {
      return lonShifts(zoneExtent, g).some((delta) =>
        booleanIntersects(zone, { type: 'Feature', properties: {}, geometry: delta ? shiftLon(g, delta) : g }),
      )
    } catch {
      return false // malformed geometry from upstream should never crash the poller
    }
  })
}
