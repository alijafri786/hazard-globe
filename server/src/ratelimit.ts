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

interface LimiterOptions {
  windowMs: number
  max: number
  now?: () => number
}

/**
 * Fixed-window counter kept in memory. Good enough for a single server; with several instances,
 * each one counts separately, so the effective limit is `max` times the instance count.
 * Returns 0 when `key` is within its limit, otherwise the seconds until it can try again.
 */
export function createLimiter({ windowMs, max, now = Date.now }: LimiterOptions): (key: string) => number {
  const windows = new Map<string, { count: number; resetAt: number }>()
  let lastSweep = now()

  return (key) => {
    const t = now()
    if (t - lastSweep > windowMs) {
      for (const [k, w] of windows) if (t >= w.resetAt) windows.delete(k)
      lastSweep = t
    }

    let w = windows.get(key)
    if (!w || t >= w.resetAt) {
      w = { count: 0, resetAt: t + windowMs }
      windows.set(key, w)
    }
    return ++w.count > max ? Math.ceil((w.resetAt - t) / 1000) : 0
  }
}

export function rateLimit({ key, ...options }: LimiterOptions & { key: (c: Context) => string }): MiddlewareHandler {
  const limit = createLimiter(options)
  return async (c, next) => {
    const retryAfter = limit(key(c))
    if (retryAfter) {
      c.header('Retry-After', String(retryAfter))
      return c.json({ error: 'Too many requests, try again later' }, 429)
    }
    await next()
  }
}
