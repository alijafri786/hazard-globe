import { planAlerts } from './alerts.js'
import { config } from './config.js'
import { fetchEventGeometry, fetchEvents } from './gdacs.js'
import { sendPush } from './push.js'
import { listSubscriptions, removeSubscription, save } from './store.js'
import type { GdacsCollection } from './types.js'

let latest: { fetchedAt: string; data: GdacsCollection } | null = null
let inflight: Promise<void> | null = null

export function latestEvents() {
  return latest
}

/** Runs a poll, or joins the one already in progress so callers can await fresh data. */
export function pollOnce(): Promise<void> {
  inflight ??= poll().finally(() => {
    inflight = null
  })
  return inflight
}

async function poll(): Promise<void> {
  const started = Date.now()
  try {
    const data = await fetchEvents()
    latest = { fetchedAt: new Date().toISOString(), data }

    const subs = await listSubscriptions()
    const alerts = await planAlerts(data.features, subs, ({ properties: p }) =>
      fetchEventGeometry(p.eventtype, p.eventid, p.episodeid).catch(() => []),
    )
    let sent = 0
    const gone = new Set<string>()

    for (const { sub, eventKey, level, payload } of alerts) {
      if (gone.has(sub.id)) continue // the browser already revoked it this poll
      const result = await sendPush(sub, payload)
      if (result === 'sent') {
        sub.notified[eventKey] = level
        sent++
      } else if (result === 'gone') {
        gone.add(sub.id)
      }
    }

    for (const id of gone) await removeSubscription(id)
    await save()
    console.log(
      `[poll] ${data.features.length} events, ${subs.length} subscriptions, ${sent} alerts sent, ` +
        `${gone.size} expired, ${Date.now() - started}ms`,
    )
  } catch (err) {
    console.error('[poll] failed:', (err as Error).message)
  }
}

export function startPolling(): void {
  void pollOnce()
  setInterval(() => void pollOnce(), config.pollIntervalMinutes * 60_000)
}
