import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { compress } from 'hono/compress'
import { cors } from 'hono/cors'
import { config, pushEnabled } from './config.js'
import { getFlights } from './flights.js'
import { fetchGeometryCollection } from './gdacs.js'
import type { Poller } from './poller.js'
import type { SendResult } from './push.js'
import { clientIp, rateLimit } from './ratelimit.js'
import type { SubscriptionStore } from './store/index.js'
import type { AlertPayload, HazardType, Subscription } from './types.js'
import { parseAreas, parsePushChannel } from './validate.js'

export interface AppDeps {
  store: SubscriptionStore
  poller: Pick<Poller, 'latestEvents' | 'pollOnce'>
  sendPush: (sub: Subscription, payload: AlertPayload) => Promise<SendResult>
}

export interface AppOptions {
  trustProxy: number
  maxSubscribers: number
  now: () => number
}

/** Untrusted: everything is checked in validate.ts. `area`, `hazards` and `minAlert` are the v1 single-area form. */
interface SubscribeBody {
  id?: unknown
  areas?: unknown
  area?: unknown
  hazards?: unknown
  minAlert?: unknown
  push?: unknown
}

const MINUTE = 60_000

/** What a client may see: no alert history, and no channel secrets. */
const publicView = (sub: Subscription) => ({
  id: sub.id,
  areas: sub.areas.map(({ notified: _, ...area }) => area),
  channels: sub.channels.map((ch) => ({ kind: ch.kind })),
})

export function createApp({ store, poller, sendPush }: AppDeps, options: Partial<AppOptions> = {}) {
  const { trustProxy, maxSubscribers, now } = {
    trustProxy: config.trustProxy,
    maxSubscribers: config.maxSubscribers,
    now: Date.now,
    ...options,
  }
  const byIp = (c: Parameters<typeof clientIp>[0]) => clientIp(c, trustProxy)

  const app = new Hono()
  app.use('/api/*', cors({ origin: config.webOrigin }))
  app.use('/api/*', rateLimit({ windowMs: MINUTE, max: 300, key: byIp, now }))

  app.get('/api/health', (c) => c.json({ ok: true, pushEnabled, lastPoll: poller.latestEvents()?.fetchedAt ?? null }))

  app.get('/api/events', async (c) => {
    if (!poller.latestEvents()) await poller.pollOnce()
    const latest = poller.latestEvents()
    if (!latest) return c.json({ error: 'GDACS unavailable, try again shortly' }, 503)
    c.header('Cache-Control', 'public, max-age=300')
    return c.json({ fetchedAt: latest.fetchedAt, ...latest.data })
  })

  // Uncached ids reach GDACS, so stop anyone walking through ids at our expense
  app.get(
    '/api/events/:type/:eventid/:episodeid/geometry',
    rateLimit({ windowMs: MINUTE, max: 60, key: byIp, now }),
    async (c) => {
      const type = c.req.param('type') as HazardType
      if (type !== 'TC' && type !== 'FL') return c.json({ error: 'unsupported hazard type' }, 400)
      const eventid = Number(c.req.param('eventid'))
      const episodeid = Number(c.req.param('episodeid'))
      if (!Number.isInteger(eventid) || !Number.isInteger(episodeid)) return c.json({ error: 'bad id' }, 400)
      const data = await fetchGeometryCollection(type, eventid, episodeid).catch(() => null)
      c.header('Cache-Control', 'public, max-age=900')
      return c.json(data ?? { type: 'FeatureCollection', features: [] })
    },
  )

  // ~1 MB of JSON for a global snapshot, so this is the one route worth compressing
  app.get('/api/flights', compress(), async (c) => {
    const snapshot = await getFlights()
    if (!snapshot) return c.json({ error: 'Flight data unavailable, try again shortly' }, 503)
    c.header('Cache-Control', 'public, max-age=60')
    return c.json(snapshot)
  })

  app.get('/api/push/public-key', (c) =>
    pushEnabled ? c.json({ publicKey: config.vapid.publicKey }) : c.json({ error: 'push not configured' }, 501),
  )

  app.post(
    '/api/subscriptions',
    rateLimit({ windowMs: 60 * MINUTE, max: 20, key: byIp, now }),
    bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json({ error: 'request too large' }, 413) }),
    async (c) => {
      const body = await c.req.json<SubscribeBody>().catch(() => null)
      const push = parsePushChannel(body?.push)
      if (!body || !push) return c.json({ error: 'invalid subscription' }, 400)

      // A browser that lost its saved id re-subscribes with the same endpoint: update, don't duplicate
      const existing =
        (typeof body.id === 'string' ? await store.get(body.id) : undefined) ??
        (await store.findByEndpoint(push.endpoint))
      const areas = parseAreas(body.areas ?? (body.area ? [body.area] : undefined), existing?.areas, body)
      if (!areas) return c.json({ error: 'invalid subscription' }, 400)
      if (!existing && (await store.count()) >= maxSubscribers) {
        return c.json({ error: 'This server has reached its subscriber limit' }, 503)
      }

      const sub: Subscription = {
        id: existing?.id ?? randomUUID(),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        channels: [push],
        areas,
      }
      await store.upsert(sub)
      return c.json(publicView(sub), existing ? 200 : 201)
    },
  )

  app.get('/api/subscriptions/:id', async (c) => {
    const sub = await store.get(c.req.param('id'))
    return sub ? c.json(publicView(sub)) : c.json({ error: 'not found' }, 404)
  })

  app.post(
    '/api/subscriptions/:id/test',
    rateLimit({ windowMs: 10 * MINUTE, max: 5, key: (c) => c.req.param('id') ?? '', now }),
    async (c) => {
      const sub = await store.get(c.req.param('id'))
      if (!sub) return c.json({ error: 'not found' }, 404)
      const result = await sendPush(sub, {
        title: 'Hazard Globe test alert',
        body: `Alerts are working for ${sub.areas.map((a) => a.label).join(', ')}.`,
        tag: 'test',
      })
      return c.json({ result })
    },
  )

  app.delete('/api/subscriptions/:id', async (c) => {
    const ok = await store.remove(c.req.param('id'))
    return ok ? c.body(null, 204) : c.json({ error: 'not found' }, 404)
  })

  return app
}
