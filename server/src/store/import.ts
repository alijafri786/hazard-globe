import { readFile } from 'node:fs/promises'
import type { SubscriptionStore } from './index.js'
import { migrateStore } from './migrate.js'

/**
 * Copies every subscription from a JSON store file (any version) into another store, alert history
 * included. Safe to run more than once: existing subscriptions are updated, not duplicated.
 */
export async function importJsonFile(file: string, target: SubscriptionStore): Promise<number> {
  const { store } = migrateStore(JSON.parse(await readFile(file, 'utf8')))
  for (const sub of store.subscriptions) await target.upsert(sub)
  return store.subscriptions.length
}
