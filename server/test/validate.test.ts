import { describe, expect, it } from 'vitest'
import { MAX_AREAS } from '../src/types.js'
import { mergeChannels, parseAreas, parseEmail, parsePushChannel } from '../src/validate.js'
import { alerted, emailChannel, makeArea, pushChannel, telegramChannel } from './fixtures.js'

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

describe('parseEmail', () => {
  it('accepts a plausible address, trimmed and lower-cased', () => {
    expect(parseEmail('  Me.Too+alerts@Example.CO.uk ')).toBe('me.too+alerts@example.co.uk')
  })

  it.each([
    ['no-at-sign'],
    ['a@b'],
    ['two words@example.com'],
    ['<script>@x.com'],
    [`${'a'.repeat(250)}@x.com`],
    [42],
    // shapes that address parsers have been tricked into reading as extra recipients
    ['me@example.com,them@evil.test'],
    ['me;them@evil.test'],
    ['(comment)me@example.com'],
    ['"me>"@evil.test'],
    ['me@exa_mple.com'],
  ])('rejects %s', (v) => expect(parseEmail(v)).toBeNull())
})

describe('mergeChannels', () => {
  const push = { endpoint: 'https://push.example/new', keys: { p256dh: 'p', auth: 'a' } }

  it('keeps channels the request does not mention', () => {
    const existing = [pushChannel(), emailChannel(), telegramChannel()]
    expect(mergeChannels(existing, {})).toEqual({ channels: existing })
  })

  it('replaces or removes push', () => {
    expect(mergeChannels([pushChannel(), emailChannel()], { push })!.channels).toEqual([emailChannel(), { kind: 'push', ...push }])
    expect(mergeChannels([pushChannel(), emailChannel()], { push: null })!.channels).toEqual([emailChannel()])
    expect(mergeChannels([], { push: { endpoint: 'nope' } })).toBeNull()
  })

  it('adds a new address unconfirmed, with a fresh token, and asks for confirmation', () => {
    const { channels, confirm } = mergeChannels([pushChannel()], { email: 'me@example.com' })!
    expect(confirm).toEqual({ kind: 'email', address: 'me@example.com', verified: false, token: expect.stringMatching(/^[\w-]{32}$/) })
    expect(channels).toEqual([pushChannel(), confirm])
  })

  it('keeps the same address as it is, confirmed or not', () => {
    const existing = [emailChannel({ verified: true })]
    expect(mergeChannels(existing, { email: 'ME@example.com' })).toEqual({ channels: existing })
  })

  it('replaces a changed address, and removes it on null', () => {
    const changed = mergeChannels([emailChannel()], { email: 'new@example.com' })!
    expect(changed.channels).toEqual([changed.confirm])
    expect(changed.confirm?.token).not.toBe('email-token')
    expect(mergeChannels([emailChannel(), telegramChannel()], { email: null })!.channels).toEqual([telegramChannel()])
    expect(mergeChannels([], { email: 'nope' })).toBeNull()
  })
})
