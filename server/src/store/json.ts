import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Store, Subscription } from '../types.js'
import type { SubscriptionStore } from './index.js'

async function readStore(file: string): Promise<Store> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { subscriptions: [] }
    throw err
  }
  try {
    return JSON.parse(text) as Store
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
  const store = await readStore(file)
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

  const find = (id: string) => store.subscriptions.find((s) => s.id === id)

  return {
    async list() {
      return store.subscriptions
    },
    async get(id) {
      return find(id)
    },
    async findByEndpoint(endpoint) {
      return store.subscriptions.find((s) => s.push.endpoint === endpoint)
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
    async recordNotified(id, eventKey, level) {
      const sub = find(id)
      if (!sub) return
      sub.notified[eventKey] = level
      await persist()
    },
  }
}
