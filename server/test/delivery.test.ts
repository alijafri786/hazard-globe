import { describe, expect, it, vi } from 'vitest'
import { anySent, createDeliver, sameChannel } from '../src/delivery.js'
import { emailChannel, makeSub, pushChannel, telegramChannel } from './fixtures.js'

const payload = { title: 'T', body: 'B' }

describe('createDeliver', () => {
  it('sends to push, confirmed email and linked Telegram, and nothing that is not ready yet', async () => {
    const push = { send: vi.fn(async () => 'sent' as const) }
    const email = { send: vi.fn(async () => 'sent' as const) }
    const telegram = { send: vi.fn(async () => 'sent' as const) }
    const deliver = createDeliver({ push, email, telegram })

    const ready = makeSub({ channels: [pushChannel(), emailChannel(), telegramChannel()] })
    expect((await deliver(ready, payload)).results).toEqual({ push: 'sent', email: 'sent', telegram: 'sent' })

    const pending = makeSub({
      channels: [emailChannel({ verified: false }), telegramChannel({ chatId: undefined, linkExpiresAt: '2030-01-01' })],
    })
    expect(await deliver(pending, payload)).toEqual({ results: {}, gone: [] })
    expect(email.send).toHaveBeenCalledTimes(1)
    expect(telegram.send).toHaveBeenCalledTimes(1)
  })

  it('reports channels that are gone, and counts a channel with no notifier as failed', async () => {
    const deliver = createDeliver({ push: { send: async () => 'gone' } })
    const sub = makeSub({ channels: [pushChannel(), emailChannel()] })
    const delivery = await deliver(sub, payload)
    expect(delivery).toEqual({ results: { push: 'gone', email: 'failed' }, gone: [sub.channels[0]] })
    expect(anySent(delivery)).toBe(false)
  })
})

describe('sameChannel', () => {
  it('compares kind and address only', () => {
    expect(sameChannel(emailChannel({ token: 'a' }), emailChannel({ token: 'b', verified: false }))).toBe(true)
    expect(sameChannel(emailChannel(), emailChannel({ address: 'other@example.com' }))).toBe(false)
    expect(sameChannel(pushChannel(1), pushChannel(2))).toBe(false)
  })
})
