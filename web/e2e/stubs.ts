import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'

/**
 * Headless browsers have no push service, so stand in for the browser side of web push:
 * permission is granted, and the service worker hands back a fixed subscription.
 * The server runs in E2E mode, where "sending" a push only logs it.
 */
export async function stubPush(page: Page, endpoint: string) {
  await page.addInitScript((endpoint) => {
    const subscription = {
      endpoint,
      toJSON: () => ({ endpoint, keys: { p256dh: 'e2e-p256dh', auth: 'e2e-auth' } }),
      unsubscribe: async () => true,
    }
    const registration = {
      pushManager: { getSubscription: async () => subscription, subscribe: async () => subscription },
    }
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' })
    Notification.requestPermission = async () => 'granted'
    const sw = navigator.serviceWorker as unknown as Record<string, unknown>
    sw.register = async () => registration
    sw.getRegistration = async () => registration
    Object.defineProperty(sw, 'ready', { get: () => Promise.resolve(registration) })
  }, endpoint)
}

/** Keep GDACS out of the tests: the globe loads with no events. */
export async function stubHazardData(page: Page) {
  await page.route('**/api/events', (route) =>
    route.fulfill({ json: { fetchedAt: new Date().toISOString(), type: 'FeatureCollection', features: [] } }),
  )
}

export const STORAGE_KEY = 'hazard-globe:watch-areas'

interface Mail {
  to: string
  subject: string
  text: string
  headers?: Record<string, string>
}

/** Mail the E2E server "sent", newest last. It writes to a file instead of an SMTP server. */
export async function outbox(to: string): Promise<Mail[]> {
  const text = await readFile(`${process.env.E2E_DATA_FILE}.outbox.jsonl`, 'utf8').catch(() => '')
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Mail)
    .filter((m) => m.to === to)
}

export const linkIn = (mail: Mail, path: string) => mail.text.match(new RegExp(`https?://\\S+${path}\\?token=[\\w-]+`))![0]
