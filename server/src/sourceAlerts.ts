import type { PlannedAlert } from './alerts.js'
import type { Deliver } from './delivery.js'
import type { ExtraHazard } from './hazards.js'
import { sendAlerts } from './sendAlerts.js'
import type { SubscriptionStore } from './store/index.js'
import { ALERT_RANK, type AlertLevel, type AlertPayload, type Subscription, type WatchArea } from './types.js'

/**
 * Something to alert about that isn't a GDACS event: a tsunami message, a cluster of fires. It reaches
 * `reachKm` from its point; an area within that (plus its own radius) hears about it.
 */
export interface AlertItem {
  /** stable across polls: the same thing at a higher level alerts again, at the same level not */
  key: string
  hazard: ExtraHazard
  level: AlertLevel
  lon: number
  lat: number
  reachKm: number
  /** the message, naming the areas it reached */
  payload: (areas: WatchArea[]) => AlertPayload
}

/** Great-circle distance in km */
function km(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const rad = Math.PI / 180
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Who to alert about which items: as for GDACS events, an area must have chosen the hazard, at its level or
 * above, and not have heard about it at this level already; and it must be within the item's reach. One
 * alert per subscriber per item, naming every area it reached.
 */
export function planItemAlerts(items: AlertItem[], subs: Subscription[]): PlannedAlert[] {
  const planned: PlannedAlert[] = []
  for (const item of items) {
    for (const sub of subs) {
      const areas = sub.areas.filter((a) => {
        if (!a.hazards.includes(item.hazard)) return false
        if (!(ALERT_RANK[item.level] >= ALERT_RANK[a.minAlert])) return false
        const prev = a.notified[item.key]
        if (prev && ALERT_RANK[item.level] <= ALERT_RANK[prev.level]) return false
        return km(a, item) <= item.reachKm + a.radiusKm
      })
      if (!areas.length) continue
      planned.push({
        sub,
        eventKey: item.key,
        level: item.level,
        areaIds: areas.map((a) => a.id),
        payload: { ...item.payload(areas), tag: item.key },
      })
    }
  }
  return planned
}

/**
 * Polls one alert source on its own schedule, apart from GDACS, and sends what it finds. A round that fails
 * is logged and the next one tries again; one already running is never started twice.
 */
export function createSourcePoller({
  name,
  intervalMs,
  items,
  store,
  deliver,
}: {
  name: string
  intervalMs: number
  items: () => Promise<AlertItem[]>
  store: SubscriptionStore
  deliver: Deliver
}) {
  let running = false

  async function pollOnce(): Promise<number> {
    if (running) return 0
    running = true
    try {
      const found = await items()
      if (!found.length) return 0
      const alerts = planItemAlerts(found, await store.list())
      const { sent, expired } = await sendAlerts(alerts, store, deliver)
      if (sent || expired) console.log(`[${name}] ${found.length} items, ${sent} alerts sent, ${expired} expired`)
      return sent
    } catch (err) {
      console.error(`[${name}] failed:`, (err as Error).message)
      return 0
    } finally {
      running = false
    }
  }

  function start() {
    void pollOnce()
    setInterval(() => void pollOnce(), intervalMs)
  }

  return { pollOnce, start }
}
