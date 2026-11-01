import webpush from 'web-push'
import { config, pushEnabled } from './config.js'
import type { Notifier } from './delivery.js'
import type { PushChannel } from './types.js'

if (pushEnabled) {
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey)
}

export const pushNotifier: Notifier<PushChannel> = {
  async send(channel, payload) {
    if (!pushEnabled) {
      console.warn('[push] VAPID keys missing — would have sent:', payload.title)
      return 'failed'
    }
    try {
      await webpush.sendNotification(channel, JSON.stringify(payload), { TTL: 6 * 60 * 60, urgency: 'high' })
      return 'sent'
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) return 'gone' // the browser revoked the subscription
      console.error('[push] failed', status, (err as Error).message)
      return 'failed'
    }
  },
}
