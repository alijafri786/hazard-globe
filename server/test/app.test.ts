import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, type AppDeps, type AppOptions } from '../src/app.js'
import type { Deliver } from '../src/delivery.js'
import type { SubscriptionStore } from '../src/store/index.js'
import { openJsonStore } from '../src/store/json.js'
import type { EmailChannel, TelegramChannel } from '../src/types.js'
import { pushChannel } from './fixtures.js'

let dir: string
let store: SubscriptionStore
const deliver = vi.fn<Deliver>(async () => ({ results: { push: 'sent' }, gone: [] }))
const sendConfirmation = vi.fn(async () => undefined)
const history = vi.fn(async (days: number) => ({ type: 'FeatureCollection' as const, features: [], days }))
const flightTrack = vi.fn<AppDeps['flightTrack']>(async (icao24) =>
  icao24 === 'a4c592'
    ? {
        icao24,
        points: [
          [1, -73.78, 40.62, 0],
          [2, -73.79, 40.61, 300],
        ],
      }
    : null,
)
const satellites = vi.fn<AppDeps['satellites']>(async (group) => ({
  group,
  fetchedAt: '2026-11-02T20:00:00.000Z',
  satellites: [],
}))

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hazard-app-'))
  store = await openJsonStore(join(dir, 'store.json'))
  deliver.mockClear()
  sendConfirmation.mockClear()
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(dir, { recursive: true, force: true })
})

function setup(options: Partial<AppOptions> = {}, deps: Partial<AppDeps> = {}) {
  const poller = { latestEvents: () => null, pollOnce: async () => undefined }
  const app = createApp(
    { store, poller, history, satellites, flightTrack, deliver, pushEnabled: true, email: { sendConfirmation }, telegramBot: 'hg_bot', ...deps },
    { trustProxy: 1, ...options },
  )
  const call = (method: string, path: string, body?: unknown, ip = '1.1.1.1') =>
    app.request(path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
  const post = (path: string, body: unknown = {}, ip?: string) => call('POST', path, body, ip)
  const subscribe = async (extra: object = {}) => (await (await post('/api/subscriptions', subscribeBody(undefined, extra))).json()) as View
  return { app, call, post, subscribe }
}

const home = { label: 'Home', lon: 1, lat: 2, radiusKm: 100 }
const subscribeBody = (endpoint = 'https://push.example/1', extra: object = {}) => ({
  areas: [home],
  push: { endpoint, keys: { p256dh: 'p', auth: 'a' } },
  ...extra,
})

interface View {
  id: string
  areas: { id: string; label: string; minAlert: string; notified?: unknown }[]
  channels: { kind: string; address?: string; verified?: boolean; linked?: boolean }[]
  emailConfirmation?: string
}

const stored = async (id: string) => (await store.get(id))!
const emailOf = async (id: string) => (await stored(id)).channels.find((c): c is EmailChannel => c.kind === 'email')

describe('GET /api/channels', () => {
  it('lists the ways this server can notify people', async () => {
    expect(await (await setup().app.request('/api/channels')).json()).toEqual({ push: true, email: true, telegram: { bot: 'hg_bot' } })
    const bare = setup({}, { email: undefined, telegramBot: undefined, pushEnabled: false }).app
    expect(await (await bare.request('/api/channels')).json()).toEqual({ push: false, email: false, telegram: null })
  })
})

describe('POST /api/subscriptions', () => {
  it('creates a subscription with defaults and returns it without private fields', async () => {
    const { post } = setup()
    const res = await post('/api/subscriptions', subscribeBody())
    expect(res.status).toBe(201)
    const view = (await res.json()) as View
    expect(view.areas).toEqual([
      { id: expect.any(String), ...home, hazards: ['TC', 'FL'], minAlert: 'Orange', forecastAlerts: false }, // no `notified`
    ])
    expect(view.channels).toEqual([{ kind: 'push' }]) // no endpoint or keys
    expect(await store.count()).toBe(1)
  })

  it('stores several areas, each with its own settings', async () => {
    const { subscribe } = setup()
    const areas = [
      { ...home, minAlert: 'Red' },
      { label: 'Work', lon: 5, lat: 6, radiusKm: 50, hazards: ['FL'] },
    ]
    const view = await subscribe({ areas })
    expect(view.areas.map((a) => [a.label, a.minAlert])).toEqual([
      ['Home', 'Red'],
      ['Work', 'Orange'],
    ])
  })

  it('still accepts the single-area request older clients send', async () => {
    const { post } = setup()
    const v1 = { area: home, hazards: ['TC'], minAlert: 'Red', push: subscribeBody().push }
    const res = await post('/api/subscriptions', v1)
    expect(res.status).toBe(201)
    expect(((await res.json()) as View).areas).toMatchObject([{ label: 'Home', hazards: ['TC'], minAlert: 'Red' }])
  })

  it('rejects invalid input', async () => {
    const { post } = setup()
    expect((await post('/api/subscriptions', 'not json')).status).toBe(400)
    expect((await post('/api/subscriptions', subscribeBody('http://insecure.example'))).status).toBe(400)
    const tooBig = subscribeBody(undefined, { areas: [{ lon: 1, lat: 2, radiusKm: 5000 }] })
    expect((await post('/api/subscriptions', tooBig)).status).toBe(400)
    expect((await post('/api/subscriptions', subscribeBody(undefined, { areas: [] }))).status).toBe(400)
    expect((await post('/api/subscriptions', subscribeBody(undefined, { email: 'not-an-address' }))).status).toBe(400)
  })

  it('updates rather than duplicates when a browser re-subscribes without its id', async () => {
    const { post, subscribe } = setup()
    const first = await subscribe()
    const again = await post('/api/subscriptions', subscribeBody(undefined, { areas: [{ ...home, minAlert: 'Red' }] }))
    expect(again.status).toBe(200)
    const view = (await again.json()) as View
    expect(view.id).toBe(first.id)
    expect(view.areas[0]).toMatchObject({ id: first.areas[0].id, minAlert: 'Red' })
    expect(await store.count()).toBe(1)
  })

  it('keeps an area’s alert history across updates', async () => {
    const { post, subscribe } = setup()
    const { id, areas } = await subscribe()
    await store.recordNotified(id, [areas[0].id], 'TC-1', 'Red')

    const renamed = { ...home, id: areas[0].id, label: 'Renamed' }
    await post('/api/subscriptions', subscribeBody(undefined, { id, areas: [renamed, { ...home, lon: 9 }] }))
    const sub = await stored(id)
    expect(sub.areas.map((a) => a.label)).toEqual(['Renamed', 'Home'])
    expect(sub.areas[0].notified['TC-1'].level).toBe('Red')
  })

  it('refuses new subscribers at the cap but still lets existing ones update', async () => {
    const { post } = setup({ maxSubscribers: 1 })
    expect((await post('/api/subscriptions', subscribeBody('https://push.example/1'))).status).toBe(201)
    expect((await post('/api/subscriptions', subscribeBody('https://push.example/2'))).status).toBe(503)
    expect((await post('/api/subscriptions', subscribeBody('https://push.example/1'))).status).toBe(200)
  })

  it('rate-limits each IP to 20 per hour', async () => {
    const { post } = setup()
    for (let i = 0; i < 20; i++) expect((await post('/api/subscriptions', subscribeBody())).status).toBeLessThan(300)
    expect((await post('/api/subscriptions', subscribeBody())).status).toBe(429)
    expect((await post('/api/subscriptions', subscribeBody(), '2.2.2.2')).status).toBeLessThan(300)
  })

  it('rejects oversized bodies', async () => {
    const { post } = setup()
    const res = await post('/api/subscriptions', subscribeBody(undefined, { padding: 'x'.repeat(20_000) }))
    expect(res.status).toBe(413)
  })

  describe('channels', () => {
    it('can be created with email only, which waits for confirmation', async () => {
      const { post } = setup()
      const res = await post('/api/subscriptions', { areas: [home], email: ' Me@Example.com ' })
      expect(res.status).toBe(201)
      const view = (await res.json()) as View
      expect(view.channels).toEqual([{ kind: 'email', address: 'me@example.com', verified: false }])
      expect(view.emailConfirmation).toBe('sent')
      expect(sendConfirmation).toHaveBeenCalledExactlyOnceWith(await emailOf(view.id), ['Home'])
    })

    it('keeps a confirmed address when it is sent again, and starts over when it changes', async () => {
      const { subscribe } = setup()
      const { id } = await subscribe({ email: 'me@example.com' })
      const first = (await emailOf(id))!
      await store.upsert({ ...(await stored(id)), channels: [pushChannel(), { ...first, verified: true }] })

      const same = await subscribe({ id, email: 'me@example.com' })
      expect(same.channels).toContainEqual({ kind: 'email', address: 'me@example.com', verified: true })
      expect(same.emailConfirmation).toBeUndefined()

      const changed = await subscribe({ id, email: 'new@example.com' })
      expect(changed.channels).toContainEqual({ kind: 'email', address: 'new@example.com', verified: false })
      expect((await emailOf(id))!.token).not.toBe(first.token)
      expect(sendConfirmation).toHaveBeenCalledTimes(2)
    })

    it('leaves channels it was not told about alone, and removes them on null', async () => {
      const { subscribe } = setup()
      const { id } = await subscribe({ email: 'me@example.com' })
      expect((await subscribe({ id, push: undefined })).channels.map((c) => c.kind)).toEqual(['push', 'email'])
      expect((await subscribe({ id, email: null })).channels.map((c) => c.kind)).toEqual(['push'])
      expect((await subscribe({ id, push: null })).channels).toEqual([])
    })

    it('limits confirmation emails to 3 an hour per address', async () => {
      const { subscribe } = setup()
      const results = []
      for (const n of [1, 2, 3, 4]) results.push((await subscribe({ email: `me@example.com`, push: pushChannel(n) })).emailConfirmation)
      expect(results).toEqual(['sent', 'sent', 'sent', 'limited'])
    })

    it('refuses email when the server has no mail set up', async () => {
      const { post } = setup({}, { email: undefined })
      expect((await post('/api/subscriptions', { areas: [home], email: 'me@example.com' })).status).toBe(400)
    })
  })
})

describe('POST /api/subscriptions/:id/email/resend', () => {
  it('resends to an unconfirmed address only', async () => {
    const { post, subscribe } = setup()
    const { id } = await subscribe({ email: 'me@example.com' })
    expect(await (await post(`/api/subscriptions/${id}/email/resend`)).json()).toEqual({ emailConfirmation: 'sent' })

    const email = (await emailOf(id))!
    await store.upsert({ ...(await stored(id)), channels: [{ ...email, verified: true }] })
    expect((await post(`/api/subscriptions/${id}/email/resend`)).status).toBe(409)
  })
})

describe('email links', () => {
  async function pending() {
    const s = setup()
    const { id } = await s.subscribe({ email: 'me@example.com' })
    return { ...s, id, token: (await emailOf(id))!.token }
  }

  it('confirm: GET only asks, POST confirms', async () => {
    const { app, call, id, token } = await pending()
    const ask = await app.request(`/api/email/confirm?token=${token}`)
    expect(ask.headers.get('content-type')).toContain('text/html')
    const html = await ask.text()
    expect(html).toContain('<form method="post"><button>Confirm</button></form>')
    expect(html).toContain('me@example.com')
    expect((await emailOf(id))!.verified).toBe(false)

    const done = await call('POST', `/api/email/confirm?token=${token}`)
    expect(await done.text()).toContain('Email alerts are on')
    expect((await emailOf(id))!.verified).toBe(true)
  })

  it('confirm: an unknown token gets a friendly 404 page', async () => {
    const { app } = await pending()
    const res = await app.request('/api/email/confirm?token=nope')
    expect(res.status).toBe(404)
    expect(await res.text()).toContain('no longer valid')
  })

  it('unsubscribe: GET only asks, POST (one-click) removes the address and keeps other channels', async () => {
    const { app, id, token } = await pending()
    expect(await (await app.request(`/api/email/unsubscribe?token=${token}`)).text()).toContain('Stop email alerts?')
    expect(await emailOf(id)).toBeDefined()

    const oneClick = await app.request(`/api/email/unsubscribe?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    })
    expect(oneClick.status).toBe(200)
    expect((await stored(id)).channels.map((c) => c.kind)).toEqual(['push'])
    expect((await app.request(`/api/email/unsubscribe?token=${token}`, { method: 'POST' })).status).toBe(200) // repeatable
  })

  it('unsubscribe: removes the subscription when email was its only channel', async () => {
    const { post } = setup()
    const { id } = (await (await post('/api/subscriptions', { areas: [home], email: 'me@example.com' })).json()) as View
    const token = (await emailOf(id))!.token
    await post(`/api/email/unsubscribe?token=${token}`)
    expect(await store.get(id)).toBeUndefined()
  })
})

describe('Telegram linking', () => {
  it('creates a pending channel with a 15-minute link to the bot, replacing any earlier one', async () => {
    const now = Date.parse('2026-06-01T12:00:00Z')
    const { post, subscribe } = setup({ now: () => now })
    const { id } = await subscribe()

    const first = (await (await post(`/api/subscriptions/${id}/telegram`)).json()) as { url: string }
    const second = (await (await post(`/api/subscriptions/${id}/telegram`)).json()) as { url: string }
    const telegram = (await stored(id)).channels.filter((c): c is TelegramChannel => c.kind === 'telegram')

    expect(telegram).toEqual([{ kind: 'telegram', token: expect.any(String), linkExpiresAt: '2026-06-01T12:15:00.000Z' }])
    expect(second.url).toBe(`https://t.me/hg_bot?start=${telegram[0].token}`)
    expect(first.url).not.toBe(second.url)
    expect(((await (await setup().app.request(`/api/subscriptions/${id}`)).json()) as View).channels).toContainEqual({
      kind: 'telegram',
      linked: false,
    })
  })

  it('disconnects', async () => {
    const { call, post, subscribe } = setup()
    const { id } = await subscribe()
    await post(`/api/subscriptions/${id}/telegram`)
    expect((await call('DELETE', `/api/subscriptions/${id}/telegram`)).status).toBe(204)
    expect((await stored(id)).channels.map((c) => c.kind)).toEqual(['push'])
  })

  it('answers 501 when the server has no bot', async () => {
    const { post, subscribe } = setup({}, { telegramBot: undefined })
    const { id } = await subscribe()
    expect((await post(`/api/subscriptions/${id}/telegram`)).status).toBe(501)
  })
})

describe('POST /api/subscriptions/:id/test', () => {
  it('reports per channel and limits each subscription to 5 per 10 minutes', async () => {
    const { post, subscribe } = setup()
    const { id } = await subscribe()

    for (let i = 0; i < 5; i++) {
      expect(await (await post(`/api/subscriptions/${id}/test`)).json()).toEqual({ result: 'sent', channels: { push: 'sent' } })
    }
    expect((await post(`/api/subscriptions/${id}/test`, {}, '9.9.9.9')).status).toBe(429)
    expect(deliver).toHaveBeenCalledTimes(5)
  })

  it('says failed when nothing could be reached', async () => {
    deliver.mockResolvedValueOnce({ results: {}, gone: [] })
    const { post, subscribe } = setup()
    const { id } = await subscribe()
    expect(await (await post(`/api/subscriptions/${id}/test`)).json()).toEqual({ result: 'failed', channels: {} })
  })

  it('answers 404 for an unknown subscription', async () => {
    const { post } = setup()
    expect((await post('/api/subscriptions/nope/test')).status).toBe(404)
  })
})

describe('GET /api/subscriptions/:id', () => {
  it('returns the public view, or 404 once removed', async () => {
    const { app, subscribe } = setup()
    const created = await subscribe({ email: 'me@example.com' })
    const { emailConfirmation: _, ...view } = created
    expect(await (await app.request(`/api/subscriptions/${created.id}`)).json()).toEqual(view)
    await store.remove(created.id)
    expect((await app.request(`/api/subscriptions/${created.id}`)).status).toBe(404)
  })
})

describe('DELETE /api/subscriptions/:id', () => {
  it('removes once, then 404s', async () => {
    const { call, subscribe } = setup()
    const { id } = await subscribe()
    expect((await call('DELETE', `/api/subscriptions/${id}`)).status).toBe(204)
    expect((await call('DELETE', `/api/subscriptions/${id}`)).status).toBe(404)
  })
})

describe('GET /api/events/history', () => {
  it('serves the offered ranges only', async () => {
    const { app } = setup()
    const res = await app.request('/api/events/history?days=30')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ days: 30, type: 'FeatureCollection', features: [], fetchedAt: expect.any(String) })
    expect(history).toHaveBeenLastCalledWith(30)
    for (const days of ['31', '0', '365', 'x', '']) {
      expect((await app.request(`/api/events/history?days=${days}`)).status).toBe(400)
    }
  })

  it('answers 503 when GDACS fails', async () => {
    history.mockRejectedValueOnce(new Error('GDACS 503'))
    expect((await setup().app.request('/api/events/history?days=7')).status).toBe(503)
  })
})

describe('GET /api/flights/:icao24/track', () => {
  it('answers with the track, 404 without one, and 400 for anything but an icao24', async () => {
    const { app } = setup()
    const res = await app.request('/api/flights/a4c592/track')
    expect(res.status).toBe(200)
    expect((await res.json()).points).toHaveLength(2)
    expect((await app.request('/api/flights/406540/track')).status).toBe(404)
    for (const id of ['A4C592', 'a4c59', 'a4c5921', 'zzzzzz']) {
      expect((await app.request(`/api/flights/${id}/track`)).status).toBe(400)
    }
  })

  it('limits each IP to 30 lookups a minute', async () => {
    const { app } = setup()
    const get = () => app.request('/api/flights/406540/track', { headers: { 'X-Forwarded-For': '9.9.9.9' } })
    for (let i = 0; i < 30; i++) expect((await get()).status).toBe(404)
    expect((await get()).status).toBe(429)
  })
})

describe('GET /api/ships', () => {
  const snapshot = {
    time: '2026-11-02T12:00:00.000Z',
    refreshSeconds: 120,
    receiving: true,
    collectingSince: '2026-11-02T11:00:00.000Z',
    error: null,
    ships: [[353136000, 'EVER GIVEN', 70, 4.05, 51.9, 12.4, 87, 87, 30]],
  }
  const details = vi.fn((mmsi: number) => (mmsi === 353136000 ? ({ mmsi, name: 'EVER GIVEN' } as never) : null))
  const ships = { snapshot: () => snapshot as never, details }

  it("says ships aren't set up without an AISStream key", async () => {
    const { app } = setup()
    for (const path of ['/api/ships', '/api/ships/353136000']) {
      const res = await app.request(path)
      expect(res.status).toBe(501)
      expect(await res.json()).toEqual({ error: "Ships aren't set up on this server" })
    }
  })

  it('serves the snapshot and each ship’s details', async () => {
    const { app } = setup({}, { ships })
    expect(await (await app.request('/api/ships')).json()).toEqual(snapshot)
    expect(await (await app.request('/api/ships/353136000')).json()).toEqual({ mmsi: 353136000, name: 'EVER GIVEN' })
    expect((await app.request('/api/ships/1')).status).toBe(404)
    for (const id of ['0', 'abc', '1.5', '1000000000']) expect((await app.request(`/api/ships/${id}`)).status).toBe(400)
  })
})

describe('GET /api/satellites/:group', () => {
  it('serves the offered groups only, compressed', async () => {
    const { app } = setup()
    const res = await app.request('/api/satellites/stations', { headers: { 'Accept-Encoding': 'gzip' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Encoding')).toBe('gzip')
    expect(satellites).toHaveBeenLastCalledWith('stations')
    for (const group of ['debris', 'STATIONS', 'active%20', 'gnss.json']) {
      expect((await app.request(`/api/satellites/${group}`)).status).toBe(400)
    }
  })

  it('answers 503 when CelesTrak has never answered', async () => {
    satellites.mockResolvedValueOnce(null)
    expect((await setup().app.request('/api/satellites/active')).status).toBe(503)
  })
})

describe('GET geometry', () => {
  it('limits each IP to 60 lookups a minute', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
    const { app } = setup()
    const get = (i: number) => app.request(`/api/events/TC/${i}/1/geometry`, { headers: { 'X-Forwarded-For': '3.3.3.3' } })
    for (let i = 0; i < 60; i++) expect((await get(i)).status).toBe(200)
    expect((await get(60)).status).toBe(429)
  })
})
