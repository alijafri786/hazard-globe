import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { compress } from 'hono/compress'
import { cors } from 'hono/cors'
import { config } from './config.js'
import { anySent, type Deliver } from './delivery.js'
import type { EmailNotifier } from './email.js'
import { getFlights } from './flights.js'
import { fetchGeometryCollection } from './gdacs.js'
import { escapeHtml, page } from './html.js'
import type { Poller } from './poller.js'
import { clientIp, createLimiter, rateLimit } from './ratelimit.js'
import type { SubscriptionStore } from './store/index.js'
import type { Channel, EmailChannel, HazardType, Subscription, TelegramChannel, WatchArea } from './types.js'
import { mergeChannels, newToken, parseAreas, parsePushChannel } from './validate.js'

export interface AppDeps {
  store: SubscriptionStore
  poller: Pick<Poller, 'latestEvents' | 'pollOnce'>
  deliver: Deliver
  pushEnabled: boolean
  /** Present when email is set up */
  email?: Pick<EmailNotifier, 'sendConfirmation'>
  /** The bot's username, present when Telegram is set up */
  telegramBot?: string
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
  email?: unknown
}

const MINUTE = 60_000
const TELEGRAM_LINK_MINUTES = 15

/** What a client may see: no alert history, push keys or channel tokens. */
function viewChannel(ch: Channel) {
  switch (ch.kind) {
    case 'push':
      return { kind: ch.kind }
    case 'email':
      return { kind: ch.kind, address: ch.address, verified: ch.verified }
    case 'telegram':
      return { kind: ch.kind, linked: Boolean(ch.chatId) }
  }
}

const publicView = (sub: Subscription) => ({
  id: sub.id,
  areas: sub.areas.map(({ notified: _, ...area }) => area),
  channels: sub.channels.map(viewChannel),
})

const labels = (areas: WatchArea[]) => escapeHtml(areas.map((a) => a.label).join(', '))

export function createApp(deps: AppDeps, options: Partial<AppOptions> = {}) {
  const { store, poller, deliver, email, telegramBot } = deps
  const { trustProxy, maxSubscribers, now } = {
    trustProxy: config.trustProxy,
    maxSubscribers: config.maxSubscribers,
    now: Date.now,
    ...options,
  }
  const byIp = (c: Parameters<typeof clientIp>[0]) => clientIp(c, trustProxy)
  const byId = (c: Parameters<typeof clientIp>[0]) => c.req.param('id') ?? ''
  // However the request arrives, one address gets a handful of confirmation emails an hour at most
  const confirmLimit = createLimiter({ windowMs: 60 * MINUTE, max: 3, now })

  async function sendConfirmation(ch: EmailChannel, areas: WatchArea[]): Promise<'sent' | 'limited' | 'failed'> {
    if (!email) return 'failed'
    if (confirmLimit(ch.address)) return 'limited'
    try {
      await email.sendConfirmation(ch, areas.map((a) => a.label))
      return 'sent'
    } catch (err) {
      console.error('[email] confirmation failed:', (err as Error).message)
      return 'failed'
    }
  }

  async function findByToken<K extends 'email' | 'telegram'>(kind: K, token: string | undefined) {
    const sub = token ? await store.findByToken(token) : undefined
    const ch = sub?.channels.find((c): c is Extract<Channel, { kind: K }> => c.kind === kind && c.token === token)
    return sub && ch ? { sub, ch } : null
  }

  const app = new Hono()
  app.use('/api/*', cors({ origin: config.webOrigin }))
  app.use('/api/*', rateLimit({ windowMs: MINUTE, max: 300, key: byIp, now }))

  app.get('/api/health', (c) =>
    c.json({ ok: true, pushEnabled: deps.pushEnabled, lastPoll: poller.latestEvents()?.fetchedAt ?? null }),
  )

  /** Which ways of being notified this server offers */
  app.get('/api/channels', (c) =>
    c.json({ push: deps.pushEnabled, email: Boolean(email), telegram: telegramBot ? { bot: telegramBot } : null }),
  )

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
    config.vapid.publicKey ? c.json({ publicKey: config.vapid.publicKey }) : c.json({ error: 'push not configured' }, 501),
  )

  app.post(
    '/api/subscriptions',
    rateLimit({ windowMs: 60 * MINUTE, max: 20, key: byIp, now }),
    bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json({ error: 'request too large' }, 413) }),
    async (c) => {
      const body = await c.req.json<SubscribeBody>().catch(() => null)
      if (!body || typeof body !== 'object') return c.json({ error: 'invalid subscription' }, 400)
      if (body.email != null && !email) return c.json({ error: 'Email alerts are not set up on this server' }, 400)
      const endpoint = parsePushChannel(body.push)?.endpoint

      // A browser that lost its saved id re-subscribes with the same endpoint: update, don't duplicate
      const existing =
        (typeof body.id === 'string' ? await store.get(body.id) : undefined) ??
        (endpoint ? (await store.findByChannel('push', endpoint))[0] : undefined)
      const areas = parseAreas(body.areas ?? (body.area ? [body.area] : undefined), existing?.areas, body)
      const merged = mergeChannels(existing?.channels ?? [], body)
      if (!areas || !merged) return c.json({ error: 'invalid subscription' }, 400)
      if (!existing && (await store.count()) >= maxSubscribers) {
        return c.json({ error: 'This server has reached its subscriber limit' }, 503)
      }

      const sub: Subscription = {
        id: existing?.id ?? randomUUID(),
        createdAt: existing?.createdAt ?? new Date(now()).toISOString(),
        channels: merged.channels,
        areas,
      }
      await store.upsert(sub)
      const emailConfirmation = merged.confirm && (await sendConfirmation(merged.confirm, areas))
      return c.json({ ...publicView(sub), ...(emailConfirmation && { emailConfirmation }) }, existing ? 200 : 201)
    },
  )

  app.get('/api/subscriptions/:id', async (c) => {
    const sub = await store.get(c.req.param('id'))
    return sub ? c.json(publicView(sub)) : c.json({ error: 'not found' }, 404)
  })

  app.post('/api/subscriptions/:id/email/resend', async (c) => {
    const sub = await store.get(c.req.param('id'))
    if (!sub) return c.json({ error: 'not found' }, 404)
    const ch = sub.channels.find((x): x is EmailChannel => x.kind === 'email' && !x.verified)
    if (!ch) return c.json({ error: 'No email address is waiting for confirmation' }, 409)
    return c.json({ emailConfirmation: await sendConfirmation(ch, sub.areas) })
  })

  /** Starts linking a Telegram chat: the user opens the returned t.me link and the bot finishes the job. */
  app.post(
    '/api/subscriptions/:id/telegram',
    rateLimit({ windowMs: 60 * MINUTE, max: 10, key: byId, now }),
    async (c) => {
      if (!telegramBot) return c.json({ error: 'Telegram alerts are not set up on this server' }, 501)
      const sub = await store.get(c.req.param('id'))
      if (!sub) return c.json({ error: 'not found' }, 404)
      const pending: TelegramChannel = {
        kind: 'telegram',
        token: newToken(),
        linkExpiresAt: new Date(now() + TELEGRAM_LINK_MINUTES * MINUTE).toISOString(),
      }
      await store.upsert({ ...sub, channels: [...sub.channels.filter((x) => x.kind !== 'telegram'), pending] })
      return c.json({ url: `https://t.me/${telegramBot}?start=${pending.token}`, expiresInMinutes: TELEGRAM_LINK_MINUTES })
    },
  )

  app.delete('/api/subscriptions/:id/telegram', async (c) => {
    const sub = await store.get(c.req.param('id'))
    if (!sub) return c.json({ error: 'not found' }, 404)
    await store.upsert({ ...sub, channels: sub.channels.filter((x) => x.kind !== 'telegram') })
    return c.body(null, 204)
  })

  app.post(
    '/api/subscriptions/:id/test',
    rateLimit({ windowMs: 10 * MINUTE, max: 5, key: byId, now }),
    async (c) => {
      const sub = await store.get(c.req.param('id'))
      if (!sub) return c.json({ error: 'not found' }, 404)
      const delivery = await deliver(sub, {
        title: 'Hazard Globe test alert',
        body: `Alerts are working for ${sub.areas.map((a) => a.label).join(', ')}.`,
        tag: 'test',
      })
      return c.json({ result: anySent(delivery) ? 'sent' : 'failed', channels: delivery.results })
    },
  )

  app.delete('/api/subscriptions/:id', async (c) => {
    const ok = await store.remove(c.req.param('id'))
    return ok ? c.body(null, 204) : c.json({ error: 'not found' }, 404)
  })

  // Links in emails. GET only shows a button, because mail scanners open links on their own;
  // POST does the work (and is what mail apps send for one-click unsubscribe).
  const invalidLink = page('This link is no longer valid', '<p>Open Hazard Globe to check your alert settings.</p>')

  app.get('/api/email/confirm', async (c) => {
    const found = await findByToken('email', c.req.query('token'))
    if (!found) return c.html(invalidLink, 404)
    const { sub, ch } = found
    if (ch.verified) return c.html(page('Email alerts are on', `<p>${escapeHtml(ch.address)} is already confirmed.</p>`))
    return c.html(
      page(
        'Confirm email alerts',
        `<p>Send alerts about tropical cyclones and floods near ${labels(sub.areas)} to <b>${escapeHtml(ch.address)}</b>?</p>
<form method="post"><button>Confirm</button></form>`,
      ),
    )
  })

  app.post('/api/email/confirm', async (c) => {
    const found = await findByToken('email', c.req.query('token'))
    if (!found) return c.html(invalidLink, 404)
    const { sub, ch } = found
    await store.upsert({ ...sub, channels: sub.channels.map((x) => (x === ch ? { ...ch, verified: true } : x)) })
    return c.html(
      page(
        'Email alerts are on',
        `<p>We'll email <b>${escapeHtml(ch.address)}</b> about storms and floods near ${labels(sub.areas)}. You can close this tab.</p>`,
      ),
    )
  })

  app.get('/api/email/unsubscribe', async (c) => {
    const found = await findByToken('email', c.req.query('token'))
    if (!found) return c.html(page('Already unsubscribed', '<p>This address gets no more email alerts.</p>'))
    return c.html(
      page(
        'Stop email alerts?',
        `<p>Stop sending alerts to <b>${escapeHtml(found.ch.address)}</b>? Alerts in your browser or Telegram are not affected.</p>
<form method="post"><button>Stop email alerts</button></form>`,
      ),
    )
  })

  app.post('/api/email/unsubscribe', async (c) => {
    const found = await findByToken('email', c.req.query('token'))
    if (found) {
      const { sub, ch } = found
      const channels = sub.channels.filter((x) => x !== ch)
      // Nothing left to reach anyone with: the subscription has no purpose any more
      if (channels.length) await store.upsert({ ...sub, channels })
      else await store.remove(sub.id)
    }
    return c.html(page('Unsubscribed', "<p>You won't get any more email alerts at this address.</p>"))
  })

  return app
}
