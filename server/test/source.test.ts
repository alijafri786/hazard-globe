import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCachedSource } from '../src/source.js'

const MINUTE = 60_000

afterEach(() => vi.restoreAllMocks())

describe('createCachedSource', () => {
  it('fetches once per time-to-live, sharing a fetch between concurrent requests', async () => {
    let t = 0
    const fetch = vi.fn(async (key: string) => ({ key, at: t }))
    const source = createCachedSource({ ttlMs: 10 * MINUTE, failureRetryMs: MINUTE, fetch, now: () => t })

    const [a, b] = await Promise.all([source.get('x'), source.get('x')])
    expect(a).toBe(b)
    expect(fetch).toHaveBeenCalledExactlyOnceWith('x')

    t += 9 * MINUTE
    await source.get('x')
    expect(fetch).toHaveBeenCalledTimes(1)

    await source.get('y') // keys are separate
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('serves the old copy while refreshing and after a failure, then waits before retrying', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let t = 0
    let resolve!: (v: number) => void
    const fetch = vi
      .fn<(key: string) => Promise<number>>()
      .mockResolvedValueOnce(1)
      .mockImplementationOnce(() => new Promise((r) => (resolve = r)))
      .mockRejectedValueOnce(new Error('upstream 503'))
      .mockResolvedValue(3)
    const source = createCachedSource({ ttlMs: 10 * MINUTE, failureRetryMs: 5 * MINUTE, fetch, now: () => t })
    expect(await source.get('k')).toBe(1)

    t += 10 * MINUTE // due: answered straight away from the old copy
    expect(await source.get('k')).toBe(1)
    resolve(2)
    await vi.waitFor(async () => expect(await source.get('k')).toBe(2))

    t += 10 * MINUTE // this refresh fails: still the old copy
    await source.get('k')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    expect(await source.get('k')).toBe(2)

    t += 4 * MINUTE // not retried until failureRetryMs has passed
    await source.get('k')
    expect(fetch).toHaveBeenCalledTimes(3)
    t += MINUTE
    await source.get('k')
    await vi.waitFor(async () => expect(await source.get('k')).toBe(3))
  })

  it('answers null when upstream has never answered, and peek never fetches', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetch = vi.fn().mockRejectedValue(new Error('down'))
    const source = createCachedSource<string, number>({ ttlMs: MINUTE, failureRetryMs: MINUTE, fetch, now: () => 0 })
    expect(source.peek('k')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    expect(await source.get('k')).toBeNull()
  })

  it('reports when the copy was fetched', async () => {
    let t = 1_000
    const source = createCachedSource({ ttlMs: MINUTE, failureRetryMs: MINUTE, fetch: async () => 'v', now: () => t })
    expect(await source.getWithTime('k')).toEqual({ data: 'v', fetchedAt: 1_000 })
    t += 30_000
    expect((await source.getWithTime('k'))?.fetchedAt).toBe(1_000)
  })

  it('drops the oldest key past maxEntries', async () => {
    const fetch = vi.fn(async (key: number) => key)
    const source = createCachedSource({ ttlMs: MINUTE, failureRetryMs: MINUTE, maxEntries: 2, fetch, now: () => 0 })
    await source.get(1)
    await source.get(2)
    await source.get(3)
    expect(source.peek(1)).toBeNull()
    expect(source.peek(3)).toBe(3)
    await source.get(1)
    expect(fetch).toHaveBeenCalledTimes(4)
  })
})
