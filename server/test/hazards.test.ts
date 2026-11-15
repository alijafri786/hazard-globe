import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
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

  it('falls back to the 100 km circle when there is no strong-shaking contour', () => {
    expect(affected(earthquakeCollection({ contours: [4, 5] }), 'EQ')).toEqual([square(0, 0, 0.9)])
    expect(affected(earthquakeCollection({ contours: [] }), 'EQ')).toEqual([square(0, 0, 0.9)])
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
