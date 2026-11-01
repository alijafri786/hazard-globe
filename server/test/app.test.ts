import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, type AppOptions } from '../src/app.js'
import type { SubscriptionStore } from '../src/store/index.js'
import { openJsonStore } from '../src/store/json.js'

let dir: string
let store: SubscriptionStore
const sendPush = vi.fn(async () => 'sent' as const)

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hazard-app-'))
  store = await openJsonStore(join(dir, 'store.json'))
  sendPush.mockClear()
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(dir, { recursive: true, force: true })
})

function setup(options: Partial<AppOptions> = {}) {
  const poller = { latestEvents: () => null, pollOnce: async () => undefined }
  const app = createApp({ store, poller, sendPush }, { trustProxy: 1, ...options })
  const post = (path: string, body: unknown, ip = '1.1.1.1') =>
    app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  return { app, post }
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
  channels: unknown[]
}

describe('POST /api/subscriptions', () => {
  it('creates a subscription with defaults and returns it without private fields', async () => {
    const { post } = setup()
    const res = await post('/api/subscriptions', subscribeBody())
    expect(res.status).toBe(201)
    const view = (await res.json()) as View
    expect(view.areas).toEqual([
      { id: expect.any(String), ...home, hazards: ['TC', 'FL'], minAlert: 'Orange' }, // no `notified`
    ])
    expect(view.channels).toEqual([{ kind: 'push' }]) // no endpoint or keys
    expect(await store.count()).toBe(1)
  })

  it('stores several areas, each with its own settings', async () => {
    const { post } = setup()
    const areas = [
      { ...home, minAlert: 'Red' },
      { label: 'Work', lon: 5, lat: 6, radiusKm: 50, hazards: ['FL'] },
    ]
    const view = (await (await post('/api/subscriptions', subscribeBody(undefined, { areas }))).json()) as View
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
  })

  it('updates rather than duplicates when a browser re-subscribes without its id', async () => {
    const { post } = setup()
    const first = (await (await post('/api/subscriptions', subscribeBody())).json()) as View
    const again = await post('/api/subscriptions', subscribeBody(undefined, { areas: [{ ...home, minAlert: 'Red' }] }))
    expect(again.status).toBe(200)
    const view = (await again.json()) as View
    expect(view.id).toBe(first.id)
    expect(view.areas[0]).toMatchObject({ id: first.areas[0].id, minAlert: 'Red' })
    expect(await store.count()).toBe(1)
  })

  it('keeps an area’s alert history across updates', async () => {
    const { post } = setup()
    const { id, areas } = (await (await post('/api/subscriptions', subscribeBody())).json()) as View
    await store.recordNotified(id, [areas[0].id], 'TC-1', 'Red')

    const renamed = { ...home, id: areas[0].id, label: 'Renamed' }
    await post('/api/subscriptions', subscribeBody(undefined, { id, areas: [renamed, { ...home, lon: 9 }] }))
    const stored = (await store.get(id))!
    expect(stored.areas.map((a) => a.label)).toEqual(['Renamed', 'Home'])
    expect(stored.areas[0].notified['TC-1'].level).toBe('Red')
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
})

describe('POST /api/subscriptions/:id/test', () => {
  it('sends a test alert and limits each subscription to 5 per 10 minutes', async () => {
    const { post } = setup()
    const { id } = (await (await post('/api/subscriptions', subscribeBody())).json()) as { id: string }

    for (let i = 0; i < 5; i++) expect(await (await post(`/api/subscriptions/${id}/test`, {})).json()).toEqual({ result: 'sent' })
    expect((await post(`/api/subscriptions/${id}/test`, {}, '9.9.9.9')).status).toBe(429)
    expect(sendPush).toHaveBeenCalledTimes(5)
  })

  it('answers 404 for an unknown subscription', async () => {
    const { post } = setup()
    expect((await post('/api/subscriptions/nope/test', {})).status).toBe(404)
  })
})

describe('GET /api/subscriptions/:id', () => {
  it('returns the public view, or 404 once removed', async () => {
    const { app, post } = setup()
    const created = (await (await post('/api/subscriptions', subscribeBody())).json()) as View
    expect(await (await app.request(`/api/subscriptions/${created.id}`)).json()).toEqual(created)
    await store.remove(created.id)
    expect((await app.request(`/api/subscriptions/${created.id}`)).status).toBe(404)
  })
})

describe('DELETE /api/subscriptions/:id', () => {
  it('removes once, then 404s', async () => {
    const { app, post } = setup()
    const { id } = (await (await post('/api/subscriptions', subscribeBody())).json()) as { id: string }
    expect((await app.request(`/api/subscriptions/${id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await app.request(`/api/subscriptions/${id}`, { method: 'DELETE' })).status).toBe(404)
  })
})

describe('GET geometry', () => {
  it('limits each IP to 60 lookups a minute', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
    const { app } = setup()
    const get = (i: number) =>
      app.request(`/api/events/TC/${i}/1/geometry`, { headers: { 'X-Forwarded-For': '3.3.3.3' } })
    for (let i = 0; i < 60; i++) expect((await get(i)).status).toBe(200)
    expect((await get(60)).status).toBe(429)
  })
})
