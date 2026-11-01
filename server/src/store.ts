import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { config } from './config.js'
import type { Store, Subscription } from './types.js'

/**
 * Deliberately simple JSON-file store so the project runs with zero infrastructure.
 * Replace with Postgres (or SQLite) once there are more than a few hundred subscribers.
 */
let cache: Store | null = null
let writing: Promise<void> = Promise.resolve()

async function load(): Promise<Store> {
  if (cache) return cache
  try {
    cache = JSON.parse(await readFile(config.dataFile, 'utf8')) as Store
  } catch {
    cache = { subscriptions: [] }
  }
  return cache
}

async function persist(): Promise<void> {
  const snapshot = JSON.stringify(cache, null, 2)
  writing = writing.then(async () => {
    await mkdir(dirname(config.dataFile), { recursive: true })
    const tmp = `${config.dataFile}.tmp`
    await writeFile(tmp, snapshot)
    await rename(tmp, config.dataFile) // atomic replace
  })
  return writing
}

export async function listSubscriptions(): Promise<Subscription[]> {
  return (await load()).subscriptions
}

export async function getSubscription(id: string): Promise<Subscription | undefined> {
  return (await load()).subscriptions.find((s) => s.id === id)
}

export async function upsertSubscription(sub: Subscription): Promise<void> {
  const store = await load()
  const i = store.subscriptions.findIndex((s) => s.id === sub.id)
  if (i >= 0) store.subscriptions[i] = sub
  else store.subscriptions.push(sub)
  await persist()
}

export async function removeSubscription(id: string): Promise<boolean> {
  const store = await load()
  const before = store.subscriptions.length
  store.subscriptions = store.subscriptions.filter((s) => s.id !== id)
  if (store.subscriptions.length === before) return false
  await persist()
  return true
}

export async function save(): Promise<void> {
  await load()
  await persist()
}
