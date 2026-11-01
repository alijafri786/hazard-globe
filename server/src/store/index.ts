import { config } from '../config.js'
import type { AlertLevel, Subscription } from '../types.js'
import { pgDb } from './db.js'
import { openJsonStore } from './json.js'
import { openPostgresStore } from './postgres.js'

/**
 * Everything the server needs from storage, as intent-level operations so a database version
 * can do targeted writes instead of saving the whole document.
 */
export interface SubscriptionStore {
  list(): Promise<Subscription[]>
  get(id: string): Promise<Subscription | undefined>
  findByEndpoint(endpoint: string): Promise<Subscription | undefined>
  count(): Promise<number>
  upsert(sub: Subscription): Promise<void>
  remove(id: string): Promise<boolean>
  /** Remember the level each of these areas has been alerted at for an event. */
  recordNotified(id: string, areaIds: string[], eventKey: string, level: AlertLevel): Promise<void>
  /** Forget alerts sent before `before` for events no longer in `activeKeys`. Returns how many went. */
  pruneNotified(activeKeys: Set<string>, before: Date): Promise<number>
}

export const storeKind = config.databaseUrl ? 'postgres' : 'json'

/** Postgres when DATABASE_URL is set (migrating it first), otherwise the JSON file. */
export function openStore(): Promise<SubscriptionStore> {
  return config.databaseUrl ? openPostgresStore(pgDb(config.databaseUrl)) : openJsonStore(config.dataFile)
}
