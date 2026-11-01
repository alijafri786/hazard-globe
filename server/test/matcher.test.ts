import type { Geometry } from 'geojson'
import { describe, expect, it } from 'vitest'
import { touchesArea } from '../src/matcher.js'
import { square } from './fixtures.js'

const point = (lon: number, lat: number): Geometry => ({ type: 'Point', coordinates: [lon, lat] })
const area = (lon: number, lat: number, radiusKm: number) => ({ label: 'Test', lon, lat, radiusKm })

describe('touchesArea', () => {
  it('matches an event point inside the circle and not one outside', () => {
    expect(touchesArea(area(0, 0, 100), point(0.5, 0.5), [])).toBe(true)
    expect(touchesArea(area(0, 0, 100), point(2, 0), [])).toBe(false)
  })

  it('matches a footprint that overlaps the circle without containing its centre', () => {
    expect(touchesArea(area(0, 0, 100), point(9, 9), [square(1.5, 0, 0.7)])).toBe(true)
  })

  it('returns false when there is no geometry at all', () => {
    expect(touchesArea(area(0, 0, 100), null, [])).toBe(false)
  })

  it('returns false for malformed geometry', () => {
    const broken = { type: 'Polygon', coordinates: 'nope' } as unknown as Geometry
    expect(touchesArea(area(0, 0, 100), null, [broken])).toBe(false)
  })

  describe('across the 180° meridian', () => {
    // A 500 km circle around Fiji runs from lon ~174 to ~184 in Turf's flat coordinates
    it('matches a storm just east of the line from an area just west of it', () => {
      expect(touchesArea(area(179, -17, 500), point(-178, -17), [])).toBe(true)
    })

    it('matches a storm just west of the line from an area just east of it', () => {
      expect(touchesArea(area(-179, -17, 500), point(178, -17), [])).toBe(true)
    })

    it('matches a footprint that runs past 180° in its own coordinates', () => {
      expect(touchesArea(area(-178, -17, 100), null, [square(182, -17, 1)])).toBe(true)
    })

    it('looks inside geometry collections', () => {
      const collection: Geometry = { type: 'GeometryCollection', geometries: [point(100, 0), point(-178, -17)] }
      expect(touchesArea(area(179, -17, 500), null, [collection])).toBe(true)
    })

    it('still ignores storms that are far away on the other side', () => {
      expect(touchesArea(area(179, -17, 100), point(-170, -17), [])).toBe(false)
    })
  })
})
