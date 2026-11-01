import { describe, expect, it, vi } from 'vitest'
import { createHistory } from '../src/history.js'
import type { GdacsCollection } from '../src/types.js'

const collection = (n: number): GdacsCollection => ({ type: 'FeatureCollection', features: Array(n).fill(null) })

describe('createHistory', () => {
  it('fetches each range once per 15 minutes, sharing concurrent requests', async () => {
    let t = 0
    const fetch = vi.fn(async ({ days }: { days?: number } = {}) => collection(days!))
    const history = createHistory(fetch, () => t)

    const [a, b] = await Promise.all([history(30), history(30)])
    expect(a).toBe(b)
    expect(fetch).toHaveBeenCalledExactlyOnceWith({ days: 30 })

    await history(7)
    t += 14 * 60_000
    await history(30)
    expect(fetch).toHaveBeenCalledTimes(2)

    t += 2 * 60_000
    expect((await history(30)).features).toHaveLength(30)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('does not cache failures', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('GDACS 503')).mockResolvedValue(collection(1))
    const history = createHistory(fetch, () => 0)
    await expect(history(90)).rejects.toThrow('GDACS 503')
    expect((await history(90)).features).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
