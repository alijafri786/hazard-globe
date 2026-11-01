import { serve } from '@hono/node-server'
import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { compress } from 'hono/compress'
import { cors } from 'hono/cors'
import { config, pushEnabled } from './config.js'
import { getFlights } from './flights.js'
import { fetchGeometryCollection } from './gdacs.js'
import { latestEvents, pollOnce, startPolling } from './poller.js'
import { sendPush } from './push.js'
import { getSubscription, removeSubscription, upsertSubscription } from './store.js'
import { ALERT_RANK, type AlertLevel, type HazardType, type Subscription } from './types.js'

const app = new Hono()
app.use('/api/*', cors({ origin: config.webOrigin }))

app.get('/api/health', (c) => c.json({ ok: true, pushEnabled, lastPoll: latestEvents()?.fetchedAt ?? null }))

app.get('/api/events', async (c) => {
  if (!latestEvents()) await pollOnce()
  const latest = latestEvents()
  if (!latest) return c.json({ error: 'GDACS unavailable, try again shortly' }, 503)
  c.header('Cache-Control', 'public, max-age=300')
  return c.json({ fetchedAt: latest.fetchedAt, ...latest.data })
})

app.get('/api/events/:type/:eventid/:episodeid/geometry', async (c) => {
  const type = c.req.param('type') as HazardType
  if (type !== 'TC' && type !== 'FL') return c.json({ error: 'unsupported hazard type' }, 400)
  const eventid = Number(c.req.param('eventid'))
  const episodeid = Number(c.req.param('episodeid'))
  if (!Number.isInteger(eventid) || !Number.isInteger(episodeid)) return c.json({ error: 'bad id' }, 400)
  const data = await fetchGeometryCollection(type, eventid, episodeid).catch(() => null)
  c.header('Cache-Control', 'public, max-age=900')
  return c.json(data ?? { type: 'FeatureCollection', features: [] })
})

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

interface SubscribeBody {
  id?: string
  area: { label?: string; lon: number; lat: number; radiusKm: number }
  hazards?: HazardType[]
  minAlert?: AlertLevel
  push: Subscription['push']
}

app.post('/api/subscriptions', async (c) => {
  const body = await c.req.json<SubscribeBody>().catch(() => null)
  const a = body?.area
  const valid =
    body?.push?.endpoint?.startsWith('https://') &&
    body.push.keys?.p256dh &&
    body.push.keys?.auth &&
    a &&
    Math.abs(a.lat) <= 90 &&
    Math.abs(a.lon) <= 180 &&
    a.radiusKm >= 5 &&
    a.radiusKm <= 1000
  if (!body || !valid) return c.json({ error: 'invalid subscription' }, 400)

  const existing = body.id ? await getSubscription(body.id) : undefined
  const hazards = (body.hazards ?? ['TC', 'FL']).filter((h): h is HazardType => h === 'TC' || h === 'FL')
  const minAlert: AlertLevel = body.minAlert && body.minAlert in ALERT_RANK ? body.minAlert : 'Orange'

  const sub: Subscription = {
    id: existing?.id ?? randomUUID(),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    area: { label: (a.label || 'My area').slice(0, 80), lon: a.lon, lat: a.lat, radiusKm: a.radiusKm },
    hazards: hazards.length ? hazards : ['TC', 'FL'],
    minAlert,
    push: body.push,
    notified: existing?.notified ?? {},
  }
  await upsertSubscription(sub)
  return c.json({ id: sub.id, area: sub.area, hazards: sub.hazards, minAlert: sub.minAlert }, existing ? 200 : 201)
})

app.post('/api/subscriptions/:id/test', async (c) => {
  const sub = await getSubscription(c.req.param('id'))
  if (!sub) return c.json({ error: 'not found' }, 404)
  const result = await sendPush(sub, {
    title: 'Hazard Globe test alert',
    body: `Alerts are working for ${sub.area.label} (${sub.area.radiusKm} km).`,
    tag: 'test',
  })
  return c.json({ result })
})

app.delete('/api/subscriptions/:id', async (c) => {
  const ok = await removeSubscription(c.req.param('id'))
  return ok ? c.body(null, 204) : c.json({ error: 'not found' }, 404)
})

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`hazard-globe server on http://localhost:${info.port} (push ${pushEnabled ? 'on' : 'OFF — set VAPID keys'})`)
  startPolling()
})
