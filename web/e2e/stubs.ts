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
