import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Deliver, Delivery } from '../src/delivery.js'
import type { SubscriptionStore } from '../src/store/index.js'
import type { Subscription } from '../src/types.js'
import { emailChannel, makeEvent, makeSub, pushChannel } from './fixtures.js'

const gdacs = vi.hoisted(() => ({ fetchEvents: vi.fn(), fetchEventGeometry: vi.fn() }))
vi.mock('../src/gdacs.js', () => gdacs)

const { createPoller } = await import('../src/poller.js')

function fakeStore(subs: Subscription[]): SubscriptionStore {
  return {
    list: vi.fn(async () => subs),
    get: vi.fn(async (id: string) => subs.find((s) => s.id === id)),
    findByChannel: vi.fn(async () => []),
    findByToken: vi.fn(async () => undefined),
    count: vi.fn(async () => subs.length),
    upsert: vi.fn(async () => undefined),
    remove: vi.fn(async () => true),
    recordNotified: vi.fn(async () => undefined),
    pruneNotified: vi.fn(async () => 0),
  }
}

const delivering = (fn: (sub: Subscription) => Delivery) => vi.fn<Deliver>(async (sub) => fn(sub))
const sent: Delivery = { results: { push: 'sent' }, gone: [] }

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
  it('records each alert that reached at least one channel', async () => {
    const store = fakeStore([makeSub({ id: 'a' })])
    const deliver = delivering(() => ({ results: { push: 'failed', email: 'sent' }, gone: [] }))
    await createPoller(store, deliver).pollOnce()

    expect(deliver).toHaveBeenCalledTimes(2)
    expect(store.recordNotified).toHaveBeenCalledWith('a', ['area-1'], 'TC-1', 'Orange')
    expect(store.recordNotified).toHaveBeenCalledWith('a', ['area-1'], 'TC-2', 'Red')
  })

  it('does not record alerts that reached no channel, so they are retried next poll', async () => {
    const store = fakeStore([makeSub()])
    await createPoller(store, delivering(() => ({ results: { push: 'failed' }, gone: [] }))).pollOnce()
    expect(store.recordNotified).not.toHaveBeenCalled()
    expect(store.remove).not.toHaveBeenCalled()
  })

  it('removes a subscription whose only channel is gone, and stops sending to it', async () => {
    const store = fakeStore([makeSub({ id: 'a' }), makeSub({ id: 'b', channels: [pushChannel(2)] })])
    const deliver = delivering((sub) =>
      sub.id === 'a' ? { results: { push: 'gone' }, gone: sub.channels } : sent,
    )
    await createPoller(store, deliver).pollOnce()

    const toA = deliver.mock.calls.filter(([s]) => s.id === 'a')
    expect(toA.map(([s]) => s.channels.length)).toEqual([1, 0]) // second alert skips the dead channel
    expect(store.remove).toHaveBeenCalledExactlyOnceWith('a')
    expect(store.recordNotified).toHaveBeenCalledTimes(2) // both events for 'b'
  })

  it('keeps a subscription that still has another channel, minus the gone one', async () => {
    const email = emailChannel()
    const store = fakeStore([makeSub({ id: 'a', channels: [pushChannel(), email] })])
    const deliver = delivering((sub) => ({
      results: { push: 'gone', email: 'sent' },
      gone: sub.channels.filter((c) => c.kind === 'push'),
    }))
    await createPoller(store, deliver).pollOnce()

    expect(store.remove).not.toHaveBeenCalled()
    expect(store.upsert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'a', channels: [email] }))
  })

  it('forgets alerts older than 30 days for events GDACS no longer lists', async () => {
    const store = fakeStore([])
    const before = Date.now()
    await createPoller(store, delivering(() => sent)).pollOnce()

    const [active, cutoff] = vi.mocked(store.pruneNotified).mock.calls[0]
    expect([...active]).toEqual(['TC-1', 'TC-2'])
    expect(before - cutoff.getTime()).toBeGreaterThanOrEqual(30 * 86_400_000 - 1000)
  })

  it('keeps the latest events and shares one poll between concurrent callers', async () => {
    const poller = createPoller(fakeStore([]), delivering(() => sent))
    await Promise.all([poller.pollOnce(), poller.pollOnce()])
    expect(gdacs.fetchEvents).toHaveBeenCalledTimes(1)
    expect(poller.latestEvents()?.data.features).toHaveLength(2)
  })

  it('survives a GDACS outage', async () => {
    gdacs.fetchEvents.mockRejectedValueOnce(new Error('GDACS 503'))
    const poller = createPoller(fakeStore([]), delivering(() => sent))
    await expect(poller.pollOnce()).resolves.toBeUndefined()
    expect(poller.latestEvents()).toBeNull()
  })
})
