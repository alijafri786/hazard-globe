import { fetchEvents } from './gdacs.js'
import type { GdacsCollection } from './types.js'

/** The only ranges offered, each ending today, so a handful of cache entries serve every visitor. */
export const HISTORY_DAYS = [7, 30, 90] as const
export type HistoryDays = (typeof HISTORY_DAYS)[number]

const TTL_MS = 15 * 60_000

/**
 * 90 days of floods alone can run past the live feed's 10 pages, so History pages further. It leaves out
 * Green earthquakes and wildfires, which would take dozens more requests and thousands of markers.
 */
export const HISTORY_QUERY = (days: HistoryDays) => ({ days, maxPages: 20, skipManyGreen: true })

export const isHistoryDays =(n: number): n is HistoryDays => (HISTORY_DAYS as readonly number[]).includes(n)

/**
 * Past events for the time slider. Each range is fetched from GDACS at most once per 15 minutes,
 * concurrent requests share one fetch, and failures aren't cached.
 */
export function createHistory(fetch: typeof fetchEvents = fetchEvents, now = Date.now) {
  const cache = new Map<HistoryDays, { at: number; data: Promise<GdacsCollection> }>()

  return function history(days: HistoryDays): Promise<GdacsCollection> {
    const hit = cache.get(days)
    if (hit && now() - hit.at < TTL_MS) return hit.data
    const data = fetch(HISTORY_QUERY(days))
    cache.set(days, { at: now(), data })
    data.catch(() => cache.get(days)?.data === data && cache.delete(days))
    return data
  }
}
