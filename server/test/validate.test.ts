import { describe, expect, it } from 'vitest'
import { MAX_AREAS } from '../src/types.js'
import { parseAreas, parsePushChannel } from '../src/validate.js'
import { alerted, makeArea } from './fixtures.js'

const input = (extra: object = {}) => ({ label: 'Home', lon: 1, lat: 2, radiusKm: 100, ...extra })

describe('parseAreas', () => {
  it('accepts 1 to MAX_AREAS areas with defaults filled in', () => {
    const [area] = parseAreas([{ lon: 1, lat: 2, radiusKm: 100 }])!
    expect(area).toMatchObject({ label: 'My area', hazards: ['TC', 'FL'], minAlert: 'Orange', notified: {} })
    expect(parseAreas([])).toBeNull()
    expect(parseAreas(Array.from({ length: MAX_AREAS }, () => input()))).toHaveLength(MAX_AREAS)
    expect(parseAreas(Array.from({ length: MAX_AREAS + 1 }, () => input()))).toBeNull()
  })

  it.each([
    ['latitude out of range', { lat: 91 }],
    ['longitude out of range', { lon: -181 }],
    ['radius too small', { radiusKm: 4 }],
    ['radius too large', { radiusKm: 1001 }],
    ['a number sent as text', { lat: '5' }],
    ['not a number', { lon: Number.NaN }],
  ])('rejects %s', (_, extra) => {
    expect(parseAreas([input(extra)])).toBeNull()
  })

  it('rejects input that is not a list of objects', () => {
    expect(parseAreas('nope')).toBeNull()
    expect(parseAreas([null])).toBeNull()
  })

  it('cleans hazards, level and label', () => {
    const [area] = parseAreas([input({ hazards: ['FL', 'EQ', 'FL'], minAlert: 'Purple', label: '  x'.padEnd(200, 'y') })])!
    expect(area.hazards).toEqual(['FL'])
    expect(area.minAlert).toBe('Orange')
    expect(area.label).toHaveLength(80)
    expect(area.label.startsWith('x')).toBe(true)
  })

  it('uses top-level hazards and level as defaults (the v1 request shape)', () => {
    const [area] = parseAreas([input()], [], { hazards: ['TC'], minAlert: 'Red' })!
    expect(area).toMatchObject({ hazards: ['TC'], minAlert: 'Red' })
  })

  describe('merging with stored areas', () => {
    const stored = makeArea({ id: 'home', lon: 1, lat: 2, notified: alerted('TC-1', 'Red') })

    it('keeps id and alert history when the client sends the id back', () => {
      const [area] = parseAreas([input({ id: 'home', label: 'Renamed', radiusKm: 300 })], [stored])!
      expect(area).toMatchObject({ id: 'home', label: 'Renamed', radiusKm: 300, notified: stored.notified })
    })

    it('matches an area sent without an id by its unchanged centre', () => {
      const [area] = parseAreas([input()], [stored])!
      expect(area).toMatchObject({ id: 'home', notified: stored.notified })
    })

    it('starts the alert history afresh when the centre moves', () => {
      const [area] = parseAreas([input({ id: 'home', lon: 30 })], [stored])!
      expect(area).toMatchObject({ id: 'home', notified: {} })
    })

    it('gives unknown and repeated ids new ones', () => {
      const areas = parseAreas([input({ id: 'home' }), input({ id: 'home' }), input({ id: 'made-up' })], [stored])!
      expect(areas[0].id).toBe('home')
      expect(new Set(areas.map((a) => a.id)).size).toBe(3)
      expect(areas.map((a) => a.id)).not.toContain('made-up')
    })
  })
})

describe('parsePushChannel', () => {
  const valid = { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } }

  it('accepts a browser push subscription', () => {
    expect(parsePushChannel(valid)).toEqual({ kind: 'push', ...valid })
  })

  it.each([
    ['plain http', { ...valid, endpoint: 'http://push.example/1' }],
    ['missing keys', { endpoint: valid.endpoint }],
    ['an endpoint that is not text', { ...valid, endpoint: 42 }],
    ['an endpoint over 2048 characters', { ...valid, endpoint: `https://${'x'.repeat(2048)}` }],
    ['nothing at all', undefined],
  ])('rejects %s', (_, value) => {
    expect(parsePushChannel(value)).toBeNull()
  })
})
