import { config } from './config.js'
import { fetchEventGeometry, fetchEvents } from './gdacs.js'
import { touchesArea } from './matcher.js'
import { sendPush } from './push.js'
import { listSubscriptions, removeSubscription, save } from './store.js'
import { ALERT_RANK, type GdacsCollection, type GdacsEvent } from './types.js'

let latest: { fetchedAt: string; data: GdacsCollection } | null = null
let inflight: Promise<void> | null = null

export function latestEvents() {
  return latest
}

const HAZARD_NAME = { TC: 'Tropical cyclone', FL: 'Flood' } as const

function describe(e: GdacsEvent): { title: string; body: string } {
  const p = e.properties
  const name = p.name || p.description || HAZARD_NAME[p.eventtype]
  const where = p.country ? ` — ${p.country}` : ''
  const severity = p.severitydata?.severitytext ? `\n${p.severitydata.severitytext}` : ''
  return {
    title: `${p.alertlevel.toUpperCase()} ${HAZARD_NAME[p.eventtype]} alert`,
    body: `${name}${where}${severity}`,
  }
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
    let sent = 0
    const gone: string[] = []

    for (const event of data.features) {
      const p = event.properties
      // Only bother fetching polygons for events at least one subscriber cares about
      const interested = subs.filter(
        (s) => s.hazards.includes(p.eventtype) && ALERT_RANK[p.alertlevel] >= ALERT_RANK[s.minAlert],
      )
      if (!interested.length) continue

      const eventKey = `${p.eventtype}-${p.eventid}`
      const pending = interested.filter((s) => {
        const prev = s.notified[eventKey]
        return !prev || ALERT_RANK[p.alertlevel] > ALERT_RANK[prev] // new, or escalated
      })
      if (!pending.length) continue

      const affected = await fetchEventGeometry(p.eventtype, p.eventid, p.episodeid).catch(() => [])

      for (const sub of pending) {
        if (!touchesArea(sub.area, event.geometry, affected)) continue
        const { title, body } = describe(event)
        const result = await sendPush(sub, {
          title,
          body: `${body}\nNear: ${sub.area.label}`,
          url: p.url?.report,
          tag: eventKey,
        })
        if (result === 'sent') {
          sub.notified[eventKey] = p.alertlevel
          sent++
        } else if (result === 'gone') {
          gone.push(sub.id)
        }
      }
    }

    for (const id of new Set(gone)) await removeSubscription(id)
    await save()
    console.log(
      `[poll] ${data.features.length} events, ${subs.length} subscriptions, ${sent} alerts sent, ` +
        `${gone.length} expired, ${Date.now() - started}ms`,
    )
  } catch (err) {
    console.error('[poll] failed:', (err as Error).message)
  }
}

export function startPolling(): void {
  void pollOnce()
  setInterval(() => void pollOnce(), config.pollIntervalMinutes * 60_000)
}
