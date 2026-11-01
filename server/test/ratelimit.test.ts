import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { clientIp, rateLimit } from '../src/ratelimit.js'

function limitedApp(max: number, windowMs: number) {
  let t = 0
  const app = new Hono()
  app.use(rateLimit({ windowMs, max, key: (c) => c.req.header('x-user') ?? '', now: () => t }))
  app.get('/', (c) => c.text('ok'))
  const hit = (user = 'a') => app.request('/', { headers: { 'x-user': user } })
  return { hit, advance: (ms: number) => (t += ms) }
}

describe('rateLimit', () => {
  it('allows up to max requests per window, then answers 429 with Retry-After', async () => {
    const { hit, advance } = limitedApp(3, 60_000)
    for (let i = 0; i < 3; i++) expect((await hit()).status).toBe(200)
    advance(15_000)
    const blocked = await hit()
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBe('45')
    expect(await blocked.json()).toEqual({ error: 'Too many requests, try again later' })
  })

  it('starts a fresh window once the old one ends', async () => {
    const { hit, advance } = limitedApp(1, 60_000)
    expect((await hit()).status).toBe(200)
    expect((await hit()).status).toBe(429)
    advance(60_000)
    expect((await hit()).status).toBe(200)
  })

  it('counts each key separately', async () => {
    const { hit } = limitedApp(1, 60_000)
    expect((await hit('a')).status).toBe(200)
    expect((await hit('b')).status).toBe(200)
    expect((await hit('a')).status).toBe(429)
  })
})

describe('clientIp', () => {
  async function ipFor(trustProxy: number, forwardedFor?: string) {
    const app = new Hono()
    app.get('/', (c) => c.text(clientIp(c, trustProxy)))
    const headers: Record<string, string> = forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}
    return (await app.request('/', { headers })).text()
  }

  it('ignores X-Forwarded-For unless proxies are trusted', async () => {
    expect(await ipFor(0, '1.2.3.4')).toBe('unknown') // no socket under app.request()
  })

  it('takes the address the trusted proxy saw, not what the client claimed', async () => {
    expect(await ipFor(1, '6.6.6.6, 1.2.3.4')).toBe('1.2.3.4')
    expect(await ipFor(2, '6.6.6.6, 1.2.3.4, 10.0.0.1')).toBe('1.2.3.4')
  })

  it('falls back to the socket when the header is missing', async () => {
    expect(await ipFor(1)).toBe('unknown')
  })
})
