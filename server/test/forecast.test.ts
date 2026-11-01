import { describe, expect, it } from 'vitest'
import { splitGeometry } from '../src/forecast.js'
import { cycloneCollection, ring, square } from './fixtures.js'

describe('splitGeometry', () => {
  it('keeps only the wind buffers as the area a cyclone affects', () => {
    const wind = [square(10, 10, 1), square(10, 10, 2), square(10, 10, 3)]
    const { affected } = splitGeometry(cycloneCollection({ wind, points: [{ key: '06011800', lon: 1, lat: 1 }] }), 'TC')
    expect(affected).toEqual(wind) // not the cone, track, points or centroid
  })

  it('reads the cone, issue time and track, marking points after the issue as forecast', () => {
    const points = [
      { key: '06020600', lon: 3, lat: 3 },
      { key: '06011200', lon: 1, lat: 1 },
      { key: '06011800', lon: 2, lat: 2 },
    ]
    const { forecast } = splitGeometry(cycloneCollection({ points }), 'TC')
    expect(forecast?.issuedAt).toBe('2026-06-01T18:00:00.000Z')
    expect(forecast?.cone).toEqual(square(0, 0, 1))
    expect(forecast?.track.map((t) => [t.time, t.forecast])).toEqual([
      ['2026-06-01T12:00:00.000Z', false],
      ['2026-06-01T18:00:00.000Z', false],
      ['2026-06-02T06:00:00.000Z', true],
    ])
    expect(forecast?.track[0].lon).toBeCloseTo(1)
    expect(forecast?.track[0].lat).toBeCloseTo(1)
  })

  it('puts track points in the right year around new year', () => {
    const late = splitGeometry(cycloneCollection({ issued: '2026-12-31T18:00:00', points: [{ key: '01010600', lon: 0, lat: 0 }] }), 'TC')
    expect(late.forecast?.track[0]).toMatchObject({ time: '2027-01-01T06:00:00.000Z', forecast: true })

    const early = splitGeometry(cycloneCollection({ issued: '2027-01-01T00:00:00', points: [{ key: '12311800', lon: 0, lat: 0 }] }), 'TC')
    expect(early.forecast?.track[0]).toMatchObject({ time: '2026-12-31T18:00:00.000Z', forecast: false })
  })

  it('finds the centre of a point drawn across the 180° meridian', () => {
    const collection = cycloneCollection({ points: [{ key: '06020000', lon: 179.95, lat: -17 }] })
    collection.features.at(-2)!.geometry = { ...ring(179.95, -17), coordinates: [ring(179.95, -17).coordinates[0].map(([x, y]) => [x > 180 ? x - 360 : x, y])] }
    const [point] = splitGeometry(collection, 'TC').forecast!.track
    expect(point.lon).toBeCloseTo(179.95)
  })

  it('has no forecast without an issue time, and copes with no cone or no collection', () => {
    const noDate = cycloneCollection()
    for (const f of noDate.features) delete f.properties.polygondate
    expect(splitGeometry(noDate, 'TC')).toEqual({ affected: [square(10, 10, 1)], forecast: null })
    expect(splitGeometry(cycloneCollection({ cone: null }), 'TC').forecast?.cone).toBeNull()
    expect(splitGeometry(null, 'TC')).toEqual({ affected: [], forecast: null })
  })

  it('treats everything as affected for floods, which have no forecast', () => {
    const flood = { type: 'FeatureCollection' as const, features: [{ type: 'Feature' as const, geometry: square(5, 5, 1), properties: {} as never }] }
    expect(splitGeometry(flood, 'FL')).toEqual({ affected: [square(5, 5, 1)], forecast: null })
  })
})
