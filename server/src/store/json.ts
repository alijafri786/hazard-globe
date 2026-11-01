import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Store, Subscription } from '../types.js'
import type { SubscriptionStore } from './index.js'
import { migrateStore } from './migrate.js'

async function readStore(file: string): Promise<unknown> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { version: 2, subscriptions: [] }
    throw err
  }
  try {
    return JSON.parse(text)
  } catch {
    // Starting empty here would overwrite every subscription on the next save
    throw new Error(`${file} is not valid JSON. Fix or move it, then restart.`)
  }
}

/**
 * Deliberately simple JSON-file store so the project runs with zero infrastructure.
 * Fine for a few hundred subscribers; swap in a database beyond that.
 */
export async function openJsonStore(file: string): Promise<SubscriptionStore> {
  const { store, migrated }: { store: Store; migrated: boolean } = migrateStore(await readStore(file))
  let writing: Promise<void> = Promise.resolve()
  let queued = false

  /** Writes are atomic and coalesced: changes made while a write is queued ride along with it. */
  function persist(): Promise<void> {
    if (queued) return writing
    queued = true
    writing = writing
      .catch(() => undefined) // one failed write must not block every later one
      .then(async () => {
        queued = false
        const snapshot = JSON.stringify(store, null, 2)
        await mkdir(dirname(file), { recursive: true })
        const tmp = `${file}.tmp`
        await writeFile(tmp, snapshot)
        await rename(tmp, file)
      })
    return writing
  }

  if (migrated) {
    await copyFile(file, `${file}.pre-v2.bak`).catch(() => undefined) // nothing to back up for a new file
    await persist()
  }

  const find = (id: string) => store.subscriptions.find((s) => s.id === id)

  return {
    async list() {
      return store.subscriptions
    },
    async get(id) {
      return find(id)
    },
    async findByEndpoint(endpoint) {
      return store.subscriptions.find((s) => s.channels.some((ch) => ch.kind === 'push' && ch.endpoint === endpoint))
    },
    async count() {
      return store.subscriptions.length
    },
    async upsert(sub: Subscription) {
      const i = store.subscriptions.findIndex((s) => s.id === sub.id)
      if (i >= 0) store.subscriptions[i] = sub
      else store.subscriptions.push(sub)
      await persist()
    },
    async remove(id) {
      const before = store.subscriptions.length
      store.subscriptions = store.subscriptions.filter((s) => s.id !== id)
      if (store.subscriptions.length === before) return false
      await persist()
      return true
    },
    async recordNotified(id, areaIds, eventKey, level) {
      const at = new Date().toISOString()
      for (const area of find(id)?.areas ?? []) {
        if (areaIds.includes(area.id)) area.notified[eventKey] = { level, at }
      }
      await persist()
    },
    async pruneNotified(activeKeys, before) {
      let pruned = 0
      for (const area of store.subscriptions.flatMap((s) => s.areas)) {
        for (const [key, { at }] of Object.entries(area.notified)) {
          if (!activeKeys.has(key) && new Date(at) < before) {
            delete area.notified[key]
            pruned++
          }
        }
      }
      if (pruned) await persist()
      return pruned
    },
  }
}
