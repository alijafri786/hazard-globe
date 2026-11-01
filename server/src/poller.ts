import { coneKey, eventKey, planAlerts } from './alerts.js'
import { config } from './config.js'
import { anySent, sameChannel, type Deliver } from './delivery.js'
import { splitGeometry } from './forecast.js'
import { fetchEvents, fetchGeometryCollection } from './gdacs.js'
import type { SubscriptionStore } from './store/index.js'
import type { Channel, GdacsCollection } from './types.js'

export type Poller = ReturnType<typeof createPoller>

// Long enough that an event dropping out of one GDACS response and back in doesn't alert twice
const FORGET_AFTER_MS = 30 * 86_400_000

export function createPoller(store: SubscriptionStore, deliver: Deliver) {
  /** Drops channels that will never work again; a subscription left with no way to reach anyone goes too. */
  async function removeChannels(id: string, gone: Channel[]): Promise<'removed' | 'pruned' | 'missing'> {
    const sub = await store.get(id)
    if (!sub) return 'missing'
    const channels = sub.channels.filter((c) => !gone.some((g) => sameChannel(c, g)))
    if (!channels.length) return (await store.remove(id), 'removed')
    await store.upsert({ ...sub, channels })
    return 'pruned'
  }

  let latest: { fetchedAt: string; data: GdacsCollection } | null = null
  let inflight: Promise<void> | null = null

  async function poll(): Promise<void> {
    const started = Date.now()
    try {
      const data = await fetchEvents()
      latest = { fetchedAt: new Date().toISOString(), data }

      const subs = await store.list()
      const alerts = await planAlerts(data.features, subs, ({ properties: p }) =>
        fetchGeometryCollection(p.eventtype, p.eventid, p.episodeid)
          .catch(() => null)
          .then((collection) => splitGeometry(collection, p.eventtype)),
      )
      let sent = 0
      const gone = new Map<string, Channel[]>()

      for (const alert of alerts) {
        const goneHere = gone.get(alert.sub.id) ?? []
        // don't retry a channel that already turned out to be gone this poll
        const sub = { ...alert.sub, channels: alert.sub.channels.filter((c) => !goneHere.includes(c)) }
        const delivery = await deliver(sub, alert.payload)
        if (anySent(delivery)) {
          await store.recordNotified(sub.id, alert.areaIds, alert.eventKey, alert.level)
          sent++
        }
        if (delivery.gone.length) gone.set(sub.id, [...goneHere, ...delivery.gone])
      }

      let expired = 0
      for (const [id, channels] of gone) if ((await removeChannels(id, channels)) === 'removed') expired++
      const pruned = await store.pruneNotified(
        new Set(data.features.flatMap((e) => [eventKey(e), coneKey(e)])),
        new Date(Date.now() - FORGET_AFTER_MS),
      )
      console.log(
        `[poll] ${data.features.length} events, ${subs.length} subscriptions, ${sent} alerts sent, ` +
          `${expired} expired, ${pruned} old alerts forgotten, ${Date.now() - started}ms`,
      )
    } catch (err) {
      console.error('[poll] failed:', (err as Error).message)
    }
  }

  /** Runs a poll, or joins the one already in progress so callers can await fresh data. */
  function pollOnce(): Promise<void> {
    inflight ??= poll().finally(() => {
      inflight = null
    })
    return inflight
  }

  function start(): void {
    void pollOnce()
    setInterval(() => void pollOnce(), config.pollIntervalMinutes * 60_000)
  }

  return { latestEvents: () => latest, pollOnce, start }
}
