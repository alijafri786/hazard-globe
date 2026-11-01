import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubscriptionStore } from '../src/store/index.js'
import { openJsonStore } from '../src/store/json.js'
import { createBot, createTelegramNotifier, telegramApi, TelegramError, type TelegramApi } from '../src/telegram.js'
import { makeArea, makeSub, pushChannel, telegramChannel } from './fixtures.js'

describe('telegramApi', () => {
  it('posts JSON to the bot method and unwraps the result', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { username: 'hg_bot' } })))
    const api = telegramApi('123:abc', fetch as unknown as typeof globalThis.fetch)
    expect(await api.call('getMe')).toEqual({ username: 'hg_bot' })
    expect(fetch).toHaveBeenCalledWith('https://api.telegram.org/bot123:abc/getMe', expect.objectContaining({ method: 'POST' }))
  })

  it('throws the status and description when Telegram says no', async () => {
    const fetch = async () => new Response(JSON.stringify({ ok: false, description: 'Forbidden: bot was blocked by the user' }), { status: 403 })
    const err = await telegramApi('t', fetch as typeof globalThis.fetch).call('sendMessage').catch((e) => e)
    expect(err).toBeInstanceOf(TelegramError)
    expect(err).toMatchObject({ status: 403, description: 'Forbidden: bot was blocked by the user' })
  })
})

describe('Telegram alerts', () => {
  const payload = { title: 'RED <Flood> alert', body: 'River & sea\nNear: Home', url: 'https://gdacs.example/r' }

  it('sends escaped HTML with a stop hint', async () => {
    const api = { call: vi.fn(async () => ({})) }
    expect(await createTelegramNotifier(api as unknown as TelegramApi).send(telegramChannel(), payload)).toBe('sent')
    const [method, body] = api.call.mock.calls[0] as unknown as [string, { chat_id: string; text: string; parse_mode: string }]
    expect(method).toBe('sendMessage')
    expect(body).toMatchObject({ chat_id: '4242', parse_mode: 'HTML' })
    expect(body.text).toContain('<b>RED &lt;Flood&gt; alert</b>\nRiver &amp; sea\nNear: Home')
    expect(body.text).toContain('<a href="https://gdacs.example/r">')
    expect(body.text).toContain('/stop')
  })

  it.each([
    [new TelegramError(403, 'Forbidden: bot was blocked by the user'), 'gone'],
    [new TelegramError(400, 'Bad Request: chat not found'), 'gone'],
    [new TelegramError(429, 'Too Many Requests: retry after 5'), 'failed'],
    [new Error('network down'), 'failed'],
  ])('maps %s to %s', async (error, expected) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const api: TelegramApi = { call: async () => Promise.reject(error) }
    expect(await createTelegramNotifier(api).send(telegramChannel(), payload)).toBe(expected)
  })
})

describe('bot', () => {
  let dir: string
  let store: SubscriptionStore
  const replies: string[] = []
  const api: TelegramApi = {
    call: (async (method: string, body?: object) => {
      if (method === 'sendMessage') replies.push((body as { text: string }).text)
      return {}
    }) as TelegramApi['call'],
  }
  const NOW = Date.parse('2026-06-01T12:00:00Z')
  const bot = () => createBot({ api, store, now: () => NOW })
  const message = (text: string, chatId = 777) => ({ update_id: 1, message: { text, chat: { id: chatId } } })
  const pending = (minutesLeft: number) =>
    telegramChannel({ chatId: undefined, token: 'link-tok', linkExpiresAt: new Date(NOW + minutesLeft * 60_000).toISOString() })

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hazard-bot-'))
    store = await openJsonStore(join(dir, 'store.json'))
    replies.length = 0
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('links the chat that opens a valid link', async () => {
    await store.upsert(makeSub({ id: 'a', channels: [pushChannel(), pending(10)], areas: [makeArea({ label: 'Home' })] }))
    await bot().handle(message('/start link-tok'))

    expect((await store.get('a'))!.channels[1]).toEqual({ kind: 'telegram', chatId: '777', token: 'link-tok' })
    expect(replies[0]).toMatch(/^Connected\. You'll get alerts here for: Home\./)
  })

  it('refuses an expired link, an unknown one, and a link already used by another chat', async () => {
    await store.upsert(makeSub({ id: 'a', channels: [pending(-1)] }))
    await bot().handle(message('/start link-tok'))
    await bot().handle(message('/start nope'))
    expect((await store.get('a'))!.channels[0]).toMatchObject({ chatId: undefined })

    await store.upsert(makeSub({ id: 'b', channels: [telegramChannel({ chatId: '111', token: 'used' })] }))
    await bot().handle(message('/start used'))
    expect((await store.get('b'))!.channels[0]).toMatchObject({ chatId: '111' })

    expect(replies).toEqual([
      expect.stringContaining('This link has expired'),
      expect.stringContaining('This link is no longer valid'),
      expect.stringContaining('This link has expired'),
    ])
  })

  it('unlinks the chat from every subscription on /stop, leaving other channels alone', async () => {
    await store.upsert(makeSub({ id: 'a', channels: [pushChannel(1), telegramChannel({ chatId: '777', token: 't1' })] }))
    await store.upsert(makeSub({ id: 'b', channels: [pushChannel(2), telegramChannel({ chatId: '777', token: 't2' })] }))
    await store.upsert(makeSub({ id: 'c', channels: [pushChannel(3), telegramChannel({ chatId: '999', token: 't3' })] }))
    await bot().handle(message('/stop'))

    expect((await store.get('a'))!.channels).toEqual([pushChannel(1)])
    expect((await store.get('b'))!.channels).toEqual([pushChannel(2)])
    expect((await store.get('c'))!.channels).toHaveLength(2)
    expect(replies[0]).toContain('Disconnected')

    await bot().handle(message('/stop'))
    expect(replies[1]).toContain("isn't connected")
  })

  it('explains itself for anything else', async () => {
    await bot().handle(message('hello'))
    await bot().handle(message('/start'))
    expect(replies).toEqual([expect.stringContaining('press Connect Telegram'), expect.stringContaining('press Connect Telegram')])
  })
})
