import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context, MiddlewareHandler } from 'hono'

/**
 * The caller's IP. Behind `trustProxy` reverse proxies, each proxy appends the address it saw to
 * X-Forwarded-For, so the entry `trustProxy` from the end is the last one we can trust; anything
 * further left is whatever the client chose to send.
 */
export function clientIp(c: Context, trustProxy: number): string {
  if (trustProxy > 0) {
    const hops = (c.req.header('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const ip = hops[hops.length - trustProxy]
    if (ip) return ip
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown' // no socket, e.g. app.request() in tests
  }
}

interface RateLimitOptions {
  windowMs: number
  max: number
  key: (c: Context) => string
  now?: () => number
}

/**
 * Fixed-window limiter kept in memory. Good enough for a single server; with several instances,
 * each one counts separately, so the effective limit is `max` times the instance count.
 */
export function rateLimit({ windowMs, max, key, now = Date.now }: RateLimitOptions): MiddlewareHandler {
  const windows = new Map<string, { count: number; resetAt: number }>()
  let lastSweep = now()

  return async (c, next) => {
    const t = now()
    if (t - lastSweep > windowMs) {
      for (const [k, w] of windows) if (t >= w.resetAt) windows.delete(k)
      lastSweep = t
    }

    const k = key(c)
    let w = windows.get(k)
    if (!w || t >= w.resetAt) {
      w = { count: 0, resetAt: t + windowMs }
      windows.set(k, w)
    }
    if (++w.count > max) {
      c.header('Retry-After', String(Math.ceil((w.resetAt - t) / 1000)))
      return c.json({ error: 'Too many requests, try again later' }, 429)
    }
    await next()
  }
}
