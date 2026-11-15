import type { PlannedAlert } from './alerts.js'
import { anySent, sameChannel, type Deliver } from './delivery.js'
import type { SubscriptionStore } from './store/index.js'
import type { Channel } from './types.js'

/**
 * Sends planned alerts, whatever their source (GDACS, tsunami messages, fires), and records each one sent so
 * it isn't sent again. Channels that will never work again are dropped, and a subscription left with no way
 * to reach anyone goes too.
 */
export async function sendAlerts(
  alerts: PlannedAlert[],
  store: SubscriptionStore,
  deliver: Deliver,
): Promise<{ sent: number; expired: number }> {
  let sent = 0
  const gone = new Map<string, Channel[]>()

  for (const alert of alerts) {
    const goneHere = gone.get(alert.sub.id) ?? []
    // don't retry a channel that already turned out to be gone this round
    const sub = { ...alert.sub, channels: alert.sub.channels.filter((c) => !goneHere.includes(c)) }
    const delivery = await deliver(sub, alert.payload)
    if (anySent(delivery)) {
      await store.recordNotified(sub.id, alert.areaIds, alert.eventKey, alert.level)
      sent++
    }
    if (delivery.gone.length) gone.set(sub.id, [...goneHere, ...delivery.gone])
  }

  let expired = 0
  for (const [id, channels] of gone) {
    const sub = await store.get(id)
    if (!sub) continue
    const left = sub.channels.filter((c) => !channels.some((g) => sameChannel(c, g)))
    if (left.length) await store.upsert({ ...sub, channels: left })
    else {
      await store.remove(id)
      expired++
    }
  }
  return { sent, expired }
}
