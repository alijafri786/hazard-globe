import webpush from 'web-push'
import { config, pushEnabled } from './config.js'
import type { AlertPayload, Subscription } from './types.js'

if (pushEnabled) {
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey)
}

export type SendResult = 'sent' | 'gone' | 'failed'

/** 'gone' means the browser revoked the subscription and it should be deleted. */
export async function sendPush(sub: Subscription, payload: AlertPayload): Promise<SendResult> {
  if (!pushEnabled) {
    console.warn('[push] VAPID keys missing — would have sent:', payload.title)
    return 'failed'
  }
  const channel = sub.channels.find((ch) => ch.kind === 'push')
  if (!channel) return 'failed'
  try {
    await webpush.sendNotification(channel, JSON.stringify(payload), { TTL: 6 * 60 * 60, urgency: 'high' })
    return 'sent'
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode
    if (status === 404 || status === 410) return 'gone'
    console.error('[push] failed', status, (err as Error).message)
    return 'failed'
  }
}
