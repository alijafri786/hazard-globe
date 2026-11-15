import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Deliver } from '../src/delivery.js'
import { createSourcePoller, planItemAlerts, type AlertItem } from '../src/sourceAlerts.js'
import { openJsonStore } from '../src/store/json.js'
import type { SubscriptionStore } from '../src/store/index.js'
import type { WatchArea } from '../src/types.js'
import { alerted, makeSub } from './fixtures.js'

const item = (over: Partial<AlertItem> = {}): AlertItem => ({
  key: 'TS-PHEB-1',
  hazard: 'TS',
  level: 'Red',
  lon: 0,
  lat: 0,
  reachKm: 1000,
  payload: (areas) => ({ title: 'Tsunami warning', body: areas.map((a) => a.label).join(', ') }),
  ...over,
})
const watching = (area: Partial<WatchArea>) => makeSub({ area: { hazards: ['TS'], ...area } })

describe('planItemAlerts', () => {
  it('alerts an area that chose the hazard, within reach, naming it', () => {
    const sub = watching({ lon: 8, lat: 0 }) // ~890 km away
    const [alert, ...rest] = planItemAlerts([item()], [sub])
    expect(rest).toEqual([])
    expect(alert).toMatchObject({ sub, eventKey: 'TS-PHEB-1', level: 'Red', areaIds: ['area-1'] })
    expect(alert.payload).toEqual({ title: 'Tsunami warning', body: 'Home', tag: 'TS-PHEB-1' })
  })

  it('counts the area’s own radius in the reach', () => {
    expect(planItemAlerts([item()], [watching({ lon: 10, lat: 0, radiusKm: 50 })])).toEqual([]) // ~1,110 km
    expect(planItemAlerts([item()], [watching({ lon: 10, lat: 0, radiusKm: 150 })])).toHaveLength(1)
  })

  it('leaves out areas that didn’t choose it, or want only stronger alerts', () => {
    expect(planItemAlerts([item()], [makeSub({ area: { hazards: ['TC', 'FL'] } })])).toEqual([])
    expect(planItemAlerts([item({ level: 'Green' })], [watching({})])).toEqual([]) // minAlert is Orange
  })

  it('alerts again only when the level rises', () => {
    expect(planItemAlerts([item()], [watching({ notified: alerted('TS-PHEB-1', 'Red') })])).toEqual([])
    expect(planItemAlerts([item({ level: 'Orange' })], [watching({ notified: alerted('TS-PHEB-1', 'Red') })])).toEqual([])
    expect(planItemAlerts([item()], [watching({ notified: alerted('TS-PHEB-1', 'Orange') })])).toHaveLength(1)
  })
})

describe('createSourcePoller', () => {
  let dir: string
  let store: SubscriptionStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'source-alerts-'))
    store = await openJsonStore(join(dir, 'store.json'))
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(dir, { recursive: true, force: true })
  })

  it('sends what it finds and remembers, so the next round sends nothing', async () => {
    await store.upsert(watching({}))
    const deliver = vi.fn<Deliver>(async () => ({ results: { push: 'sent' }, gone: [] }))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const poller = createSourcePoller({ name: 'test', intervalMs: 60_000, items: async () => [item()], store, deliver })
    expect(await poller.pollOnce()).toBe(1)
    expect(deliver).toHaveBeenCalledOnce()
    expect((await store.get('sub-1'))!.areas[0].notified['TS-PHEB-1'].level).toBe('Red')
    expect(await poller.pollOnce()).toBe(0)
    expect(deliver).toHaveBeenCalledOnce()
  })

  it('logs a failed round and carries on', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const poller = createSourcePoller({
      name: 'test',
      intervalMs: 60_000,
      items: async () => {
        throw new Error('feed down')
      },
      store,
      deliver: vi.fn(),
    })
    expect(await poller.pollOnce()).toBe(0)
    expect(error).toHaveBeenCalledWith('[test] failed:', 'feed down')
  })
})
