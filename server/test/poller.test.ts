import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubscriptionStore } from '../src/store/index.js'
import type { Subscription } from '../src/types.js'
import { makeEvent, makeSub } from './fixtures.js'

const gdacs = vi.hoisted(() => ({ fetchEvents: vi.fn(), fetchEventGeometry: vi.fn() }))
vi.mock('../src/gdacs.js', () => gdacs)

const { createPoller } = await import('../src/poller.js')

function fakeStore(subs: Subscription[]): SubscriptionStore {
  return {
    list: vi.fn(async () => subs),
    get: vi.fn(async (id: string) => subs.find((s) => s.id === id)),
    findByEndpoint: vi.fn(async () => undefined),
    count: vi.fn(async () => subs.length),
    upsert: vi.fn(async () => undefined),
    remove: vi.fn(async () => true),
    recordNotified: vi.fn(async () => undefined),
    pruneNotified: vi.fn(async () => 0),
  }
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  gdacs.fetchEventGeometry.mockResolvedValue([])
  gdacs.fetchEvents.mockResolvedValue({
    type: 'FeatureCollection',
    features: [makeEvent({ eventid: 1 }), makeEvent({ eventid: 2, alertlevel: 'Red' })],
  })
})

describe('poller', () => {
  it('records each alert that was delivered', async () => {
    const store = fakeStore([makeSub({ id: 'a' })])
    const send = vi.fn(async () => 'sent' as const)
    await createPoller(store, send).pollOnce()

    expect(send).toHaveBeenCalledTimes(2)
    expect(store.recordNotified).toHaveBeenCalledWith('a', ['area-1'], 'TC-1', 'Orange')
    expect(store.recordNotified).toHaveBeenCalledWith('a', ['area-1'], 'TC-2', 'Red')
  })

  it('forgets alerts older than 30 days for events GDACS no longer lists', async () => {
    const store = fakeStore([])
    const before = Date.now()
    await createPoller(store, async () => 'sent').pollOnce()

    const [active, cutoff] = vi.mocked(store.pruneNotified).mock.calls[0]
    expect([...active]).toEqual(['TC-1', 'TC-2'])
    expect(before - cutoff.getTime()).toBeGreaterThanOrEqual(30 * 86_400_000 - 1000)
  })

  it('does not record failed sends, so they are retried next poll', async () => {
    const store = fakeStore([makeSub()])
    await createPoller(store, async () => 'failed').pollOnce()
    expect(store.recordNotified).not.toHaveBeenCalled()
    expect(store.remove).not.toHaveBeenCalled()
  })

  it('removes revoked subscriptions and stops sending to them', async () => {
    const store = fakeStore([makeSub({ id: 'a' }), makeSub({ id: 'b' })])
    const send = vi.fn(async (sub: Subscription) => (sub.id === 'a' ? 'gone' : 'sent') as 'gone' | 'sent')
    await createPoller(store, send).pollOnce()

    expect(send.mock.calls.filter(([s]) => s.id === 'a')).toHaveLength(1)
    expect(store.remove).toHaveBeenCalledExactlyOnceWith('a')
    expect(store.recordNotified).toHaveBeenCalledTimes(2) // both events for 'b'
  })

  it('keeps the latest events and shares one poll between concurrent callers', async () => {
    const poller = createPoller(fakeStore([]), async () => 'sent')
    await Promise.all([poller.pollOnce(), poller.pollOnce()])
    expect(gdacs.fetchEvents).toHaveBeenCalledTimes(1)
    expect(poller.latestEvents()?.data.features).toHaveLength(2)
  })

  it('survives a GDACS outage', async () => {
    gdacs.fetchEvents.mockRejectedValueOnce(new Error('GDACS 503'))
    const poller = createPoller(fakeStore([]), async () => 'sent')
    await expect(poller.pollOnce()).resolves.toBeUndefined()
    expect(poller.latestEvents()).toBeNull()
  })
})
