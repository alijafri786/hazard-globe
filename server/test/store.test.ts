import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openJsonStore } from '../src/store/json.js'
import { makeSub } from './fixtures.js'

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

  it('persists subscriptions and notifications across reopen', async () => {
    const store = await openJsonStore(file)
    await store.upsert(makeSub({ id: 'a' }))
    await store.recordNotified('a', 'TC-1', 'Red')

    const reopened = await openJsonStore(file)
    expect((await reopened.get('a'))?.notified).toEqual({ 'TC-1': 'Red' })
  })

  it('refuses to open a corrupted file rather than overwriting it', async () => {
    await writeFile(join(dir, 'bad.json'), '{"subscriptions": [')
    await expect(openJsonStore(join(dir, 'bad.json'))).rejects.toThrow('is not valid JSON')
    expect(await readFile(join(dir, 'bad.json'), 'utf8')).toBe('{"subscriptions": [')
  })

  it('keeps every change when many writes happen at once', async () => {
    const store = await openJsonStore(file)
    await Promise.all(Array.from({ length: 25 }, (_, i) => store.upsert(makeSub({ id: `s${i}` }))))
    expect(await (await openJsonStore(file)).count()).toBe(25)
  })

  it('updates in place, finds by endpoint and removes', async () => {
    const store = await openJsonStore(file)
    await store.upsert(makeSub({ id: 'a', area: { label: 'Old' } }))
    await store.upsert(makeSub({ id: 'a', area: { label: 'New' } }))
    expect(await store.count()).toBe(1)
    expect((await store.findByEndpoint('https://push.example/1'))?.area.label).toBe('New')

    expect(await store.remove('a')).toBe(true)
    expect(await store.remove('a')).toBe(false)
    expect(await (await openJsonStore(file)).count()).toBe(0)
  })

  it('ignores notifications for a subscription that has gone', async () => {
    const store = await openJsonStore(file)
    await expect(store.recordNotified('missing', 'TC-1', 'Red')).resolves.toBeUndefined()
  })
})
