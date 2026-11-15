export interface CachedSourceOptions<K, V> {
  /** How long a good copy is kept before the next request refreshes it */
  ttlMs: number
  /** After a failure, how long before upstream is tried again, so an outage isn't one request per visitor */
  failureRetryMs: number
  fetch: (key: K) => Promise<V>
  /** Keys kept at most; the one least recently fetched goes first. Unlimited when left out. */
  maxEntries?: number
  /** Prefix for log lines, e.g. "satellites" */
  name?: string
  now?: () => number
}

interface Entry<V> {
  value?: { data: V; fetchedAt: number }
  nextAttemptAt: number
  inflight?: Promise<void>
}

/**
 * An upstream source fetched on demand and shared by every visitor. A due refresh is shared by
 * concurrent requests; while it runs, and after it fails, the last good copy is served. Only a key
 * that has never been fetched makes its caller wait. Answers null when upstream has never answered.
 */
export function createCachedSource<K, V>({
  ttlMs,
  failureRetryMs,
  fetch,
  maxEntries = Infinity,
  name = 'source',
  now = Date.now,
}: CachedSourceOptions<K, V>) {
  const cache = new Map<K, Entry<V>>()

  function refresh(key: K, entry: Entry<V>) {
    entry.inflight = fetch(key)
      .then((data) => {
        entry.value = { data, fetchedAt: now() }
        entry.nextAttemptAt = now() + ttlMs
      })
      .catch((err: Error) => {
        entry.nextAttemptAt = now() + failureRetryMs
        console.error(`[${name}] ${String(key)} failed:`, err.message)
      })
      .finally(() => {
        entry.inflight = undefined
      })
  }

  function entryFor(key: K): Entry<V> {
    let entry = cache.get(key)
    if (entry) return entry
    cache.set(key, (entry = { nextAttemptAt: 0 }))
    if (cache.size > maxEntries) cache.delete(cache.keys().next().value!)
    return entry
  }

  /** The latest good copy and when it was fetched, refreshing it first if due. */
  async function getWithTime(key: K): Promise<{ data: V; fetchedAt: number } | null> {
    const entry = entryFor(key)
    if (!entry.inflight && now() >= entry.nextAttemptAt) refresh(key, entry)
    if (!entry.value && entry.inflight) await entry.inflight
    return entry.value ?? null
  }

  return {
    getWithTime,
    get: async (key: K): Promise<V | null> => (await getWithTime(key))?.data ?? null,
    /** What is cached now, without fetching */
    peek: (key: K): V | null => cache.get(key)?.value?.data ?? null,
  }
}
