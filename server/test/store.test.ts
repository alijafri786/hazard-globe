import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { migrate, type Db } from '../src/store/db.js'
import { importJsonFile } from '../src/store/import.js'
import type { SubscriptionStore } from '../src/store/index.js'
import { openJsonStore } from '../src/store/json.js'
import { openPostgresStore } from '../src/store/postgres.js'
import { alerted, makeArea, makeSub } from './fixtures.js'
import { pgliteDb } from './pglite.js'

let dir: string
let db: Db

beforeAll(async () => {
  db = await pgliteDb()
  await migrate(db)
}, 30_000)
afterAll(() => db.close())

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hazard-store-'))
  await db.exec('truncate subscriptions cascade')
})
afterEach(() => rm(dir, { recursive: true, force: true }))

/** Opens the store under test; opening again sees the same data, like a server restart. */
const backends: [string, () => Promise<SubscriptionStore>][] = [
  ['json', () => openJsonStore(join(dir, 'nested', 'store.json'))],
  ['postgres', () => openPostgresStore(db)],
]

const endpoint = (n: number | string) => `https://push.example/${n}`

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

describe.each(backends)('%s store', (_, open) => {
  it('starts empty', async () => {
    const store = await open()
    expect(await store.list()).toEqual([])
    expect(await store.count()).toBe(0)
  })

  it('gives back exactly what was saved, after a restart', async () => {
    const sub = makeSub({
      id: 'a',
      createdAt: '2026-02-03T04:05:06.789Z',
      areas: [
        makeArea({ id: 'x', label: 'Home', lon: -0.12, lat: 51.5, radiusKm: 75, notified: alerted('TC-1', 'Red') }),
        makeArea({ id: 'y', label: "Mum's", hazards: ['FL'], minAlert: 'Green' }),
      ],
    })
    await (await open()).upsert(sub)
    expect(await (await open()).get('a')).toEqual(sub)
  })

  it('records alerts per area', async () => {
    const store = await open()
    await store.upsert(makeSub({ id: 'a', areas: [makeArea({ id: 'x' }), makeArea({ id: 'y' })] }))
    await store.recordNotified('a', ['y'], 'TC-1', 'Orange')
    await store.recordNotified('a', ['y'], 'TC-1', 'Red') // escalation overwrites

    const [x, y] = (await (await open()).get('a'))!.areas
    expect(x.notified).toEqual({})
    expect(y.notified['TC-1']).toMatchObject({ level: 'Red', at: expect.any(String) })
  })

  it('ignores alerts for a subscription that has gone, or an area that is not its own', async () => {
    const store = await open()
    await store.upsert(makeSub({ id: 'a', areas: [makeArea({ id: 'x' })] }))
    await store.recordNotified('missing', ['x'], 'TC-1', 'Red')
    await store.recordNotified('a', ['not-mine'], 'TC-1', 'Red')
    expect((await store.get('a'))!.areas[0].notified).toEqual({})
  })

  it('keeps areas in order, and drops removed ones', async () => {
    const store = await open()
    const [x, y, z] = ['x', 'y', 'z'].map((id) => makeArea({ id, label: id.toUpperCase() }))
    await store.upsert(makeSub({ id: 'a', areas: [x, y, z] }))
    await store.upsert(makeSub({ id: 'a', areas: [z, x] }))
    expect((await (await open()).get('a'))!.areas.map((a) => a.id)).toEqual(['z', 'x'])
  })

  it('keeps alert history through an edit, and clears it when the centre moves', async () => {
    const store = await open()
    const notified = alerted('TC-1', 'Red', '2026-03-01T00:00:00.000Z')
    await store.upsert(makeSub({ id: 'a', areas: [makeArea({ id: 'x', notified })] }))

    await store.upsert(makeSub({ id: 'a', areas: [makeArea({ id: 'x', label: 'Renamed', radiusKm: 300, notified })] }))
    expect((await store.get('a'))!.areas[0].notified).toEqual(notified)

    await store.upsert(makeSub({ id: 'a', areas: [makeArea({ id: 'x', lon: 5, notified: {} })] }))
    expect((await (await open()).get('a'))!.areas[0].notified).toEqual({})
  })

  it('updates in place, finds by push endpoint and removes', async () => {
    const store = await open()
    await store.upsert(makeSub({ id: 'a', area: { id: 'x', label: 'Old' } }))
    await store.upsert(makeSub({ id: 'a', area: { id: 'x', label: 'New' } }))
    expect(await store.count()).toBe(1)
    expect((await store.findByEndpoint(endpoint(1)))?.areas[0].label).toBe('New')
    expect(await store.findByEndpoint(endpoint('other'))).toBeUndefined()

    expect(await store.remove('a')).toBe(true)
    expect(await store.remove('a')).toBe(false)
    expect(await (await open()).count()).toBe(0)
  })

  it('keeps every change when many writes happen at once', async () => {
    const store = await open()
    const subs = Array.from({ length: 25 }, (_, i) =>
      makeSub({
        id: `s${i}`,
        channels: [{ kind: 'push', endpoint: endpoint(i), keys: { p256dh: 'p', auth: 'a' } }],
        area: { id: `area-${i}` },
      }),
    )
    await Promise.all(subs.map((s) => store.upsert(s)))
    expect(await (await open()).count()).toBe(25)
  })

  it('forgets old alerts for events that are no longer active, and nothing else', async () => {
    const store = await open()
    const notified = {
      ...alerted('TC-old-gone', 'Red', '2026-01-01T00:00:00.000Z'),
      ...alerted('TC-old-active', 'Red', '2026-01-01T00:00:00.000Z'),
      ...alerted('TC-recent-gone', 'Red', '2026-03-01T00:00:00.000Z'),
    }
    await store.upsert(makeSub({ area: { notified } }))

    expect(await store.pruneNotified(new Set(['TC-old-active']), new Date('2026-02-01'))).toBe(1)
    const kept = (await (await open()).list())[0].areas[0].notified
    expect(Object.keys(kept).sort()).toEqual(['TC-old-active', 'TC-recent-gone'])
  })
})

describe('json store', () => {
  it('refuses to open a corrupted file rather than overwriting it', async () => {
    await writeFile(join(dir, 'bad.json'), '{"subscriptions": [')
    await expect(openJsonStore(join(dir, 'bad.json'))).rejects.toThrow('is not valid JSON')
    expect(await readFile(join(dir, 'bad.json'), 'utf8')).toBe('{"subscriptions": [')
  })

  it('refuses a store from a newer version', async () => {
    await writeFile(join(dir, 'future.json'), '{"version": 3, "subscriptions": []}')
    await expect(openJsonStore(join(dir, 'future.json'))).rejects.toThrow('Unknown store version 3')
  })

  describe('migrating a v1 file', () => {
    it('turns each subscription into one push channel and one area, keeping its alert history', async () => {
      await writeFile(join(dir, 'v1.json'), JSON.stringify(v1))
      const sub = (await (await openJsonStore(join(dir, 'v1.json'))).get('old-sub'))!

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
})

describe('postgres store', () => {
  it('applies each migration once', async () => {
    expect(await migrate(db)).toEqual([])
    const { rows } = await db.query<{ name: string }>('select name from schema_migrations')
    expect(rows.map((r) => r.name)).toEqual(['001_init.sql'])
  })

  it('keeps an alert recorded while the user was editing', async () => {
    const store = await openPostgresStore(db)
    const before = makeSub({ id: 'a', area: { id: 'x' } })
    await store.upsert(before)
    await store.recordNotified('a', ['x'], 'TC-2', 'Orange') // the poller, mid-edit

    await store.upsert(makeSub({ id: 'a', area: { id: 'x', label: 'Renamed' } })) // edit based on the earlier read
    const area = (await store.get('a'))!.areas[0]
    expect(area.label).toBe('Renamed')
    expect(area.notified['TC-2'].level).toBe('Orange')
  })

  it('moves a push endpoint to the subscription that saved it last', async () => {
    const store = await openPostgresStore(db)
    await store.upsert(makeSub({ id: 'a', area: { id: 'x' } }))
    await store.upsert(makeSub({ id: 'b', area: { id: 'y' } }))
    expect((await store.findByEndpoint(endpoint(1)))?.id).toBe('b')
    expect((await store.get('a'))!.channels).toEqual([])
  })

  it('skips channel kinds it does not know', async () => {
    const store = await openPostgresStore(db)
    await store.upsert(makeSub({ id: 'a' }))
    await db.query(`insert into channels (subscription_id, kind, address) values ('a', 'carrier-pigeon', 'loft 3')`)
    expect((await store.get('a'))!.channels.map((c) => c.kind)).toEqual(['push'])
  })

  it('imports a JSON store file of any version, and can be re-run safely', async () => {
    const store = await openPostgresStore(db)
    await writeFile(join(dir, 'v1.json'), JSON.stringify(v1))

    expect(await importJsonFile(join(dir, 'v1.json'), store)).toBe(1)
    const first = (await store.get('old-sub'))!
    expect(await importJsonFile(join(dir, 'v1.json'), store)).toBe(1)
    expect(await store.count()).toBe(1)
    const sub = (await store.get('old-sub'))!
    expect(sub.createdAt).toBe('2025-06-01T00:00:00.000Z')
    expect(sub.areas.map((a) => a.id)).toEqual([first.areas[0].id]) // same area, so clients' saved ids still work
    expect(sub.areas[0].id).not.toContain('old-sub')
    expect(sub.areas[0].notified['TC-7'].level).toBe('Red')
  })
})
