import { createHash } from 'node:crypto'
import type { AlertLevel, HazardType, Store } from '../types.js'

/** The original format: one area and one push endpoint per subscription, no version field. */
interface StoreV1 {
  subscriptions: {
    id: string
    createdAt: string
    area: { label: string; lon: number; lat: number; radiusKm: number }
    hazards: HazardType[]
    minAlert: AlertLevel
    push: { endpoint: string; keys: { p256dh: string; auth: string } }
    notified: Record<string, AlertLevel>
  }[]
}

/** Upgrades whatever is on disk to the current format. Returns `migrated: true` when anything changed. */
export function migrateStore(raw: unknown, now = new Date()): { store: Store; migrated: boolean } {
  const data = raw as Partial<Store> & Partial<StoreV1>
  if (data.version === 2) return { store: data as Store, migrated: false }
  if (data.version !== undefined) throw new Error(`Unknown store version ${data.version}`)

  const at = now.toISOString()
  const subscriptions = (data as StoreV1).subscriptions ?? []
  return {
    migrated: true,
    store: {
      version: 2,
      subscriptions: subscriptions.map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        channels: [{ kind: 'push', endpoint: s.push.endpoint, keys: s.push.keys }],
        areas: [
          {
            // Stable, so migrating or importing the same file twice gives the same area. Hashed because
            // subscription ids are secrets.
            id: createHash('sha256').update(`area:${s.id}`).digest('hex').slice(0, 32),
            ...s.area,
            hazards: s.hazards,
            minAlert: s.minAlert,
            notified: Object.fromEntries(Object.entries(s.notified).map(([key, level]) => [key, { level, at }])),
          },
        ],
      })),
    },
  }
}
