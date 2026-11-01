import type { Geometry, Polygon } from 'geojson'
import { describe, expect, it, vi } from 'vitest'
import { planAlerts } from '../src/alerts.js'
import { splitGeometry, type EventDetails } from '../src/forecast.js'
import type { AlertLevel, GdacsEvent } from '../src/types.js'
import { alerted, cycloneCollection, makeArea, makeEvent, makeSub, square } from './fixtures.js'

const details = (affected: Geometry[] = []): EventDetails => ({ affected, forecast: null })
const noGeometry = async () => details()

describe('planAlerts', () => {
  it('alerts a subscriber about a new event in their area', async () => {
    const sub = makeSub()
    const event = makeEvent({ country: 'Atlantis', url: { report: 'https://gdacs.example/r' } })
    const [alert, ...rest] = await planAlerts([event], [sub], noGeometry)

    expect(rest).toHaveLength(0)
    expect(alert).toMatchObject({ sub, eventKey: 'TC-1000', level: 'Orange', areaIds: ['area-1'] })
    expect(alert.payload).toEqual({
      title: 'ORANGE Tropical cyclone alert',
      body: 'Alpha — Atlantis\nNear: Home',
      url: 'https://gdacs.example/r',
      tag: 'TC-1000',
    })
  })

  it('does not repeat an alert at the same level', async () => {
    const geometryFor = vi.fn(noGeometry)
    const sub = makeSub({ area: { notified: alerted('TC-1000', 'Orange') } })
    expect(await planAlerts([makeEvent()], [sub], geometryFor)).toEqual([])
    expect(geometryFor).not.toHaveBeenCalled()
  })

  it('alerts again when the level escalates', async () => {
    const sub = makeSub({ area: { notified: alerted('TC-1000', 'Orange') } })
    const alerts = await planAlerts([makeEvent({ alertlevel: 'Red' })], [sub], noGeometry)
    expect(alerts.map((a) => a.level)).toEqual(['Red'])
  })

  it('does not alert when the level drops', async () => {
    const sub = makeSub({ area: { minAlert: 'Green', notified: alerted('TC-1000', 'Red') } })
    expect(await planAlerts([makeEvent({ alertlevel: 'Orange' })], [sub], noGeometry)).toEqual([])
  })

  it.each<[AlertLevel, AlertLevel, boolean]>([
    ['Green', 'Orange', false],
    ['Orange', 'Orange', true],
    ['Red', 'Orange', true],
    ['Orange', 'Red', false],
    ['Green', 'Green', true],
  ])('a %s event for an area wanting %s+ alerts: %s', async (level, minAlert, expected) => {
    const alerts = await planAlerts([makeEvent({ alertlevel: level })], [makeSub({ area: { minAlert } })], noGeometry)
    expect(alerts.length > 0).toBe(expected)
  })

  it('ignores alert levels it does not know', async () => {
    const event = makeEvent({ alertlevel: 'Purple' as AlertLevel })
    expect(await planAlerts([event], [makeSub({ area: { minAlert: 'Green' } })], noGeometry)).toEqual([])
  })

  it('skips hazard types the area did not choose', async () => {
    const sub = makeSub({ area: { hazards: ['TC'] } })
    expect(await planAlerts([makeEvent({ eventtype: 'FL' })], [sub], noGeometry)).toEqual([])
  })

  it('falls back to the event point when there is no footprint', async () => {
    const near = makeEvent({}, [0.5, 0.5]) // ~80 km from the centre
    const far = makeEvent({ eventid: 2000 }, [5, 5])
    const alerts = await planAlerts([near, far], [makeSub()], noGeometry)
    expect(alerts.map((a) => a.eventKey)).toEqual(['TC-1000'])
  })

  it('uses the footprint instead of the point when there is one', async () => {
    const pointFarFootprintNear = makeEvent({}, [10, 10])
    const pointNearFootprintFar = makeEvent({ eventid: 2000 }, [0, 0])
    const footprints: Record<number, Geometry[]> = { 1000: [square(0, 0, 1)], 2000: [square(10, 10, 1)] }
    const alerts = await planAlerts(
      [pointFarFootprintNear, pointNearFootprintFar],
      [makeSub()],
      async (e) => details(footprints[e.properties.eventid]),
    )
    expect(alerts.map((a) => a.eventKey)).toEqual(['TC-1000'])
  })

  it('treats malformed geometry as no match instead of throwing', async () => {
    const broken = { type: 'Polygon', coordinates: [[['x', 'y']]] } as unknown as Geometry
    await expect(planAlerts([makeEvent()], [makeSub()], async () => details([broken]))).resolves.toEqual([])
  })

  it('fetches geometry once per event however many subscribers want it', async () => {
    const geometryFor = vi.fn(noGeometry)
    const subs = [makeSub({ id: 'a' }), makeSub({ id: 'b' }), makeSub({ id: 'c', area: { hazards: ['FL'] } })]
    const alerts = await planAlerts([makeEvent()], subs, geometryFor)
    expect(geometryFor).toHaveBeenCalledTimes(1)
    expect(alerts.map((a) => a.sub.id)).toEqual(['a', 'b'])
  })

  it('falls back to the hazard name when the event has no name', async () => {
    const event: GdacsEvent = makeEvent({ eventtype: 'FL', name: undefined, alertlevel: 'Red' })
    const [alert] = await planAlerts([event], [makeSub()], noGeometry)
    expect(alert.payload.title).toBe('RED Flood alert')
    expect(alert.payload.body).toBe('Flood\nNear: Home')
  })

  describe('with several areas', () => {
    const home = makeArea({ id: 'home', label: 'Home' })
    const work = makeArea({ id: 'work', label: 'Work', lon: 0.5 })
    const faraway = makeArea({ id: 'far', label: 'Far away', lon: 50 })

    it('sends one alert naming every area the event touches', async () => {
      const alerts = await planAlerts([makeEvent()], [makeSub({ areas: [home, faraway, work] })], noGeometry)
      expect(alerts).toHaveLength(1)
      expect(alerts[0].areaIds).toEqual(['home', 'work'])
      expect(alerts[0].payload.body).toBe('Alpha\nNear: Home, Work')
    })

    it('applies each area’s own minimum level and hazards', async () => {
      const redOnly = { ...work, minAlert: 'Red' as const }
      const floodsOnly = makeArea({ id: 'fl', label: 'Floods', hazards: ['FL'] })
      const alerts = await planAlerts([makeEvent()], [makeSub({ areas: [home, redOnly, floodsOnly] })], noGeometry)
      expect(alerts[0].areaIds).toEqual(['home'])
    })

    it('alerts an area that has not heard about an event another area already has', async () => {
      const told = { ...home, notified: alerted('TC-1000', 'Orange') }
      const alerts = await planAlerts([makeEvent()], [makeSub({ areas: [told, work] })], noGeometry)
      expect(alerts[0].areaIds).toEqual(['work'])
      expect(alerts[0].payload.body).toBe('Alpha\nNear: Work')
    })
  })
})

describe('forecast-cone alerts', () => {
  // Winds far away, cone over the area at (0, 0), closest forecast position on Wed 3 Jun
  const cyclone = (cone: Polygon | null = square(0, 0, 1), wind: Geometry[] = [square(10, 10, 1)]) => async () =>
    splitGeometry(
      cycloneCollection({
        cone,
        wind,
        points: [
          { key: '06011800', lon: 3, lat: 0 },
          { key: '06021800', lon: 2, lat: 0 },
          { key: '06030600', lon: 0.5, lat: 0 },
          { key: '06031800', lon: -2, lat: 0 },
        ],
      }),
      'TC',
    )
  const optedIn = (overrides = {}) => makeArea({ forecastAlerts: true, ...overrides })

  it('alerts an opted-in area the cone reaches, separately from impact alerts', async () => {
    const event = makeEvent({ country: 'Atlantis', url: { report: 'https://gdacs.example/r' } })
    const [alert, ...rest] = await planAlerts([event], [makeSub({ areas: [optedIn()] })], cyclone())
    expect(rest).toEqual([])
    expect(alert).toMatchObject({ eventKey: 'TC-1000:cone', level: 'Orange', areaIds: ['area-1'] })
    expect(alert.payload).toMatchObject({ title: 'Forecast: Tropical cyclone may reach Home', tag: 'TC-1000:cone', url: 'https://gdacs.example/r' })
    expect(alert.payload.body).toContain('Alpha — Atlantis (Orange)')
    expect(alert.payload.body).toContain('Its forecast cone reaches: Home')
    expect(alert.payload.body).toContain('Closest: Home around Wed 3 Jun')
    expect(alert.payload.body).toContain('Forecast issued 1 Jun')
    expect(alert.payload.body).toContain("The cone shows the likely path of the storm's centre, not its size. Not an official warning.")
  })

  it('is opt-in, and only for cyclones', async () => {
    expect(await planAlerts([makeEvent()], [makeSub()], cyclone())).toEqual([])
    expect(await planAlerts([makeEvent({ eventtype: 'FL' })], [makeSub({ areas: [optedIn()] })], cyclone())).toEqual([])
  })

  it('no longer counts the cone as the area hit, so it alone never triggers an impact alert', async () => {
    const alerts = await planAlerts([makeEvent()], [makeSub()], cyclone())
    expect(alerts).toEqual([])
  })

  it('sends the impact alert instead when the winds reach the area too', async () => {
    const alerts = await planAlerts([makeEvent()], [makeSub({ areas: [optedIn()] })], cyclone(square(0, 0, 1), [square(0, 0, 1)]))
    expect(alerts.map((a) => a.eventKey)).toEqual(['TC-1000'])
  })

  it('stays quiet once the area has had the impact alert for that storm', async () => {
    const area = optedIn({ notified: alerted('TC-1000', 'Orange') })
    expect(await planAlerts([makeEvent()], [makeSub({ areas: [area] })], cyclone())).toEqual([])
  })

  it('alerts once per storm, and again only if its level rises', async () => {
    const area = optedIn({ notified: alerted('TC-1000:cone', 'Orange') })
    expect(await planAlerts([makeEvent()], [makeSub({ areas: [area] })], cyclone())).toEqual([])
    const red = await planAlerts([makeEvent({ alertlevel: 'Red' })], [makeSub({ areas: [area] })], cyclone())
    expect(red.map((a) => [a.eventKey, a.level])).toEqual([['TC-1000:cone', 'Red']])
  })

  it('respects the area’s minimum level, and needs a cone', async () => {
    expect(await planAlerts([makeEvent()], [makeSub({ areas: [optedIn({ minAlert: 'Red' })] })], cyclone())).toEqual([])
    expect(await planAlerts([makeEvent()], [makeSub({ areas: [optedIn()] })], cyclone(null))).toEqual([])
  })

  it('names every area the cone reaches in one alert', async () => {
    const areas = [optedIn({ id: 'a', label: 'Home' }), optedIn({ id: 'b', label: 'Work', lon: -0.5 }), optedIn({ id: 'c', label: 'Far', lon: 40 })]
    const [alert] = await planAlerts([makeEvent()], [makeSub({ areas })], cyclone())
    expect(alert.areaIds).toEqual(['a', 'b'])
    expect(alert.payload.title).toBe('Forecast: Tropical cyclone may reach your areas')
    expect(alert.payload.body).toContain('Its forecast cone reaches: Home, Work')
  })
})
