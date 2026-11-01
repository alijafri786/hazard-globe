import { planAlerts } from './alerts.js'
import { config } from './config.js'
import { fetchEventGeometry, fetchEvents } from './gdacs.js'
import type { SendResult } from './push.js'
import type { SubscriptionStore } from './store/index.js'
import type { AlertPayload, GdacsCollection, Subscription } from './types.js'

export type Poller = ReturnType<typeof createPoller>

export function createPoller(
  store: SubscriptionStore,
  send: (sub: Subscription, payload: AlertPayload) => Promise<SendResult>,
) {
  let latest: { fetchedAt: string; data: GdacsCollection } | null = null
  let inflight: Promise<void> | null = null

  async function poll(): Promise<void> {
    const started = Date.now()
    try {
      const data = await fetchEvents()
      latest = { fetchedAt: new Date().toISOString(), data }

      const subs = await store.list()
      const alerts = await planAlerts(data.features, subs, ({ properties: p }) =>
        fetchEventGeometry(p.eventtype, p.eventid, p.episodeid).catch(() => []),
      )
      let sent = 0
      const gone = new Set<string>()

      for (const { sub, eventKey, level, payload } of alerts) {
        if (gone.has(sub.id)) continue // the browser already revoked it this poll
        const result = await send(sub, payload)
        if (result === 'sent') {
          await store.recordNotified(sub.id, eventKey, level)
          sent++
        } else if (result === 'gone') {
          gone.add(sub.id)
        }
      }

      for (const id of gone) await store.remove(id)
      console.log(
        `[poll] ${data.features.length} events, ${subs.length} subscriptions, ${sent} alerts sent, ` +
          `${gone.size} expired, ${Date.now() - started}ms`,
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
