import { config } from '../config.js'
import type { AlertLevel, Subscription } from '../types.js'
import { openJsonStore } from './json.js'

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
  /** Remember the highest level a subscriber has been alerted at for an event. */
  recordNotified(id: string, eventKey: string, level: AlertLevel): Promise<void>
}

export function openStore(): Promise<SubscriptionStore> {
  return openJsonStore(config.dataFile)
}
