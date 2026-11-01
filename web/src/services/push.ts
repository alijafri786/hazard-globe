import { api } from './api'

export type PushSupport = 'supported' | 'needs-install' | 'unsupported'

/** iOS only allows web push for sites added to the Home Screen. */
export function pushSupport(): PushSupport {
  const hasApis = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (hasApis) return 'supported'
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
  return isIos ? 'needs-install' : 'unsupported'
}

function base64UrlToBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const raw = atob((base64Url + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** Registers the service worker, asks permission and returns a push subscription. */
export async function getPushSubscription(): Promise<PushSubscriptionJSON> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications are blocked for this site.')

  const registration = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready

  const existing = await registration.pushManager.getSubscription()
  if (existing) return existing.toJSON()

  const { publicKey } = await api.publicKey()
  const sub = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(publicKey),
  })
  return sub.toJSON()
}

export async function dropPushSubscription(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration('/sw.js')
  const sub = await registration?.pushManager.getSubscription()
  await sub?.unsubscribe()
}
