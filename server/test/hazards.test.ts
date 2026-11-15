import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { planAlerts } from '../src/alerts.js'
import { splitGeometry } from '../src/forecast.js'
import { HAZARD_TYPES, HAZARDS, isHazardType } from '../src/hazards.js'
import type { GdacsCollection, HazardType } from '../src/types.js'
import { areaCollection, earthquakeCollection, makeEvent, makeSub, square } from './fixtures.js'

const affected = (collection: GdacsCollection, type: HazardType) => splitGeometry(collection, type).affected

describe('hazard types', () => {
  it('lists the same types, in the same order, as the web app', () => {
    const web = readFileSync(new URL('../../web/src/hazards.ts', import.meta.url), 'utf8')
    const listed = /export const HAZARD_TYPES = \[([^\]]*)\]/.exec(web)?.[1]
    expect(listed?.match(/[A-Z]{2}/g)).toEqual([...HAZARD_TYPES])
  })

  it('recognises only GDACS types', () => {
    expect(HAZARD_TYPES.every(isHazardType)).toBe(true)
    expect(isHazardType('XX')).toBe(false)
    expect(isHazardType('toString')).toBe(false)
  })
})

describe('affected areas', () => {
  it('counts only strong shaking (intensity 6+) as an earthquake’s footprint', () => {
    const contours = affected(earthquakeCollection({ contours: [4, 4.5, 5, 5.5, 6, 6.5, 7] }), 'EQ')
    expect(contours).toHaveLength(3)
    expect(contours.every((g) => g.type === 'MultiPolygon')).toBe(true)
  })

  it('falls back to the 100 km circle only while there is no ShakeMap', () => {
    expect(affected(earthquakeCollection({ contours: [] }), 'EQ')).toEqual([square(0, 0, 0.9)])
  })

  it('takes a ShakeMap with no strong shaking to mean nowhere was hit, not "unknown"', () => {
    expect(splitGeometry(earthquakeCollection({ contours: [4, 5, 5.5] }), 'EQ')).toEqual({
      affected: [],
      reachesNowhere: true,
      forecast: null,
    })
  })

  it.each<[HazardType, string]>([
    ['VO', 'Poly_Circle'],
    ['WF', 'Poly_area'],
    ['DR', 'Poly_area'],
  ])('uses the %s polygon and leaves out the centroid', (type, cls) => {
    expect(affected(areaCollection(square(5, 5, 1), cls), type)).toEqual([square(5, 5, 1)])
  })

  it('keeps floods as they were: every geometry, centroid included', () => {
    expect(affected(areaCollection(square(5, 5, 1)), 'FL')).toHaveLength(2)
  })

  it('has nothing but the event point to go on for a type with no polygon', () => {
    expect(affected({ type: 'FeatureCollection', features: [] }, 'WF')).toEqual([])
  })
})

describe('trimming before caching', () => {
  it('keeps an earthquake’s weak contours as features without their shapes, and the rest whole', () => {
    const full = earthquakeCollection({ contours: [4, 5, 6, 7] })
    const trimmed = HAZARDS.EQ.trim!(full.features)
    expect(trimmed).toHaveLength(full.features.length)
    const shapes = trimmed.map((f) => [f.properties?.Class, f.geometry?.type ?? null])
    expect(shapes).toEqual([
      ['Point_Centroid', 'Point'],
      ['Poly_Circle', 'Polygon'],
      ['Poly_SMPInt_4', null],
      ['Poly_SMPInt_5', null],
      ['Poly_SMPInt_6', 'MultiPolygon'],
      ['Poly_SMPInt_7', 'MultiPolygon'],
    ])
  })

  it('decides the same footprint from a trimmed collection as from the whole one', () => {
    for (const contours of [[4, 5, 6, 7], [4, 5], []]) {
      const full = earthquakeCollection({ contours })
      const trimmed = { ...full, features: HAZARDS.EQ.trim!(full.features) } as GdacsCollection
      expect(splitGeometry(trimmed, 'EQ')).toEqual(splitGeometry(full, 'EQ'))
    }
  })
})

describe('alerts for the newer hazard types', () => {
  const quake = makeEvent({
    eventtype: 'EQ',
    eventid: 7,
    name: 'Earthquake in Atlantis',
    country: 'Atlantis',
    severitydata: { severitytext: 'Magnitude 7M, Depth:18km' },
  })
  const lookup = (collection: GdacsCollection) => async () => splitGeometry(collection, 'EQ')
  const areaAt = (lon: number, hazards: HazardType[] = ['EQ']) => makeSub({ area: { lon, lat: 0, radiusKm: 5, hazards } })

  it('alerts an area inside the strong-shaking contour, saying the earthquake has already happened', async () => {
    const [alert] = await planAlerts([quake], [areaAt(1.5)], lookup(earthquakeCollection()))
    expect(alert.eventKey).toBe('EQ-7')
    expect(alert.payload.title).toBe('ORANGE Earthquake alert')
    expect(alert.payload.body).toBe(
      'Earthquake in Atlantis — Atlantis\nMagnitude 7M, Depth:18km\nNear: Home\n' + HAZARDS.EQ.note,
    )
  })

  it('does not alert anyone, even at the epicentre, when the ShakeMap shows no strong shaking', async () => {
    const weak = earthquakeCollection({ contours: [4, 4.5, 5] })
    expect(await planAlerts([quake], [areaAt(0)], lookup(weak))).toEqual([])
  })

  it('does not fetch the footprint of an earthquake too far away to reach any area', async () => {
    const lookupFn = vi.fn(lookup(earthquakeCollection()))
    // 20° of longitude at the equator: ~2,200 km, past an earthquake's 1,000 km reach
    expect(await planAlerts([quake], [areaAt(20)], lookupFn)).toEqual([])
    expect(lookupFn).not.toHaveBeenCalled()
    // the same distance still counts for types whose footprint can run that far
    const drought = makeEvent({ eventtype: 'DR', eventid: 8 })
    const far = makeSub({ area: { lon: 20, lat: 0, radiusKm: 5, hazards: ['DR'] } })
    const droughtLookup = vi.fn(async () => splitGeometry(areaCollection(square(10, 0, 11)), 'DR'))
    expect(await planAlerts([drought], [far], droughtLookup)).toHaveLength(1)
  })

  it('does not alert an area that only felt weak shaking', async () => {
    expect(await planAlerts([quake], [areaAt(1.8)], lookup(earthquakeCollection()))).toEqual([])
  })

  it('does not alert areas that did not choose earthquakes', async () => {
    expect(await planAlerts([quake], [areaAt(0, ['TC', 'FL'])], lookup(earthquakeCollection()))).toEqual([])
  })

  it.each<[HazardType, string]>([
    ['VO', 'ORANGE Volcano alert'],
    ['WF', 'ORANGE Wildfire alert'],
    ['DR', 'ORANGE Drought alert'],
  ])('names a %s alert', async (type, title) => {
    const event = makeEvent({ eventtype: type, eventid: 9, name: 'X' })
    const sub = makeSub({ area: { hazards: [type] } })
    const [alert] = await planAlerts([event], [sub], async () => splitGeometry(areaCollection(square(0, 0, 1)), type))
    expect(alert.payload.title).toBe(title)
    expect(alert.payload.body).toBe('X\nNear: Home')
  })
})
