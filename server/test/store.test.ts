import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openJsonStore } from '../src/store/json.js'
import { alerted, makeArea, makeSub } from './fixtures.js'

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hazard-store-'))
  file = join(dir, 'nested', 'store.json')
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('openJsonStore', () => {
  it('starts empty when the file does not exist yet', async () => {
    const store = await openJsonStore(file)
    expect(await store.list()).toEqual([])
    expect(await store.count()).toBe(0)
  })

  it('persists subscriptions and per-area notifications across reopen', async () => {
    const store = await openJsonStore(file)
    await store.upsert(makeSub({ id: 'a', areas: [makeArea({ id: 'x' }), makeArea({ id: 'y' })] }))
    await store.recordNotified('a', ['y'], 'TC-1', 'Red')

    const areas = (await (await openJsonStore(file)).get('a'))!.areas
    expect(areas[0].notified).toEqual({})
    expect(areas[1].notified['TC-1']).toMatchObject({ level: 'Red', at: expect.any(String) })
  })

  it('refuses to open a corrupted file rather than overwriting it', async () => {
    await writeFile(join(dir, 'bad.json'), '{"subscriptions": [')
    await expect(openJsonStore(join(dir, 'bad.json'))).rejects.toThrow('is not valid JSON')
    expect(await readFile(join(dir, 'bad.json'), 'utf8')).toBe('{"subscriptions": [')
  })

  it('refuses a store from a newer version', async () => {
    await writeFile(join(dir, 'future.json'), '{"version": 3, "subscriptions": []}')
    await expect(openJsonStore(join(dir, 'future.json'))).rejects.toThrow('Unknown store version 3')
  })

  it('keeps every change when many writes happen at once', async () => {
    const store = await openJsonStore(file)
    await Promise.all(Array.from({ length: 25 }, (_, i) => store.upsert(makeSub({ id: `s${i}` }))))
    expect(await (await openJsonStore(file)).count()).toBe(25)
  })

  it('updates in place, finds by push endpoint and removes', async () => {
    const store = await openJsonStore(file)
    await store.upsert(makeSub({ id: 'a', area: { label: 'Old' } }))
    await store.upsert(makeSub({ id: 'a', area: { label: 'New' } }))
    expect(await store.count()).toBe(1)
    expect((await store.findByEndpoint('https://push.example/1'))?.areas[0].label).toBe('New')
    expect(await store.findByEndpoint('https://push.example/other')).toBeUndefined()

    expect(await store.remove('a')).toBe(true)
    expect(await store.remove('a')).toBe(false)
    expect(await (await openJsonStore(file)).count()).toBe(0)
  })

  it('ignores notifications for a subscription that has gone', async () => {
    const store = await openJsonStore(file)
    await expect(store.recordNotified('missing', ['x'], 'TC-1', 'Red')).resolves.toBeUndefined()
  })

  it('forgets old alerts for events that are no longer active, and nothing else', async () => {
    const store = await openJsonStore(file)
    const notified = {
      ...alerted('TC-old-gone', 'Red', '2026-01-01T00:00:00.000Z'),
      ...alerted('TC-old-active', 'Red', '2026-01-01T00:00:00.000Z'),
      ...alerted('TC-recent-gone', 'Red', '2026-03-01T00:00:00.000Z'),
    }
    await store.upsert(makeSub({ area: { notified } }))

    expect(await store.pruneNotified(new Set(['TC-old-active']), new Date('2026-02-01'))).toBe(1)
    const kept = (await (await openJsonStore(file)).list())[0].areas[0].notified
    expect(Object.keys(kept).sort()).toEqual(['TC-old-active', 'TC-recent-gone'])
  })
})

describe('migrating a v1 store', () => {
  const v1 = {
    subscriptions: [
      {
        id: 'old-sub',
        createdAt: '2025-06-01T00:00:00.000Z',
        area: { label: "Mum's", lon: 10, lat: 20, radiusKm: 150 },
        hazards: ['TC'],
        minAlert: 'Red',
        push: { endpoint: 'https://push.example/old', keys: { p256dh: 'p', auth: 'a' } },
        notified: { 'TC-7': 'Red' },
      },
    ],
  }

  it('turns each subscription into one push channel and one area, keeping its alert history', async () => {
    await writeFile(join(dir, 'v1.json'), JSON.stringify(v1))
    const store = await openJsonStore(join(dir, 'v1.json'))
    const sub = (await store.get('old-sub'))!

    expect(sub.channels).toEqual([{ kind: 'push', endpoint: 'https://push.example/old', keys: { p256dh: 'p', auth: 'a' } }])
    expect(sub.areas).toHaveLength(1)
    expect(sub.areas[0]).toMatchObject({ label: "Mum's", lon: 10, lat: 20, radiusKm: 150, hazards: ['TC'], minAlert: 'Red' })
    expect(sub.areas[0].id).toEqual(expect.any(String))
    expect(sub.areas[0].notified['TC-7'].level).toBe('Red')
  })

  it('writes the upgraded file straight away and keeps a backup of the original', async () => {
    await writeFile(join(dir, 'v1.json'), JSON.stringify(v1))
    await openJsonStore(join(dir, 'v1.json'))

    expect(JSON.parse(await readFile(join(dir, 'v1.json'), 'utf8')).version).toBe(2)
    expect(JSON.parse(await readFile(join(dir, 'v1.json.pre-v2.bak'), 'utf8'))).toEqual(v1)
  })
})
