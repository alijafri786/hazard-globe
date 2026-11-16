/**
 * Cloudflare Worker in front of the web app's static assets (see wrangler.jsonc).
 *
 * Requests to /api/* are forwarded to the Hazard Globe server at API_ORIGIN, so the app can keep
 * calling its API on its own origin: no VITE_API_BASE, no CORS, and the server's address is a
 * runtime setting rather than something baked into the build. Everything else is served from
 * web/dist by the assets binding; Cloudflare only runs this script for /api/* (run_worker_first).
 */

interface Env {
  /** Origin of the Hazard Globe server, e.g. https://api.example.org (no path, no trailing slash). */
  API_ORIGIN?: string
  /**
   * Shared secret sent to the server in X-Origin-Auth (a Worker secret, not a plain variable). The VM's Caddy
   * refuses requests without it, so nobody can reach the server except through this Worker.
   */
  ORIGIN_SECRET?: string
  ASSETS: { fetch(request: Request): Promise<Response> }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)

    if (!env.API_ORIGIN) {
      return Response.json({ error: 'API_ORIGIN is not set on this deployment' }, { status: 503 })
    }

    const target = new URL(url.pathname + url.search, env.API_ORIGIN)
    const headers = new Headers(request.headers)
    // One trusted hop: replace whatever X-Forwarded-For the browser sent with the address Cloudflare
    // saw, so the server's rate limits (TRUST_PROXY=1) can't be dodged with a forged header.
    const clientIp = request.headers.get('cf-connecting-ip')
    if (clientIp) headers.set('x-forwarded-for', clientIp)
    else headers.delete('x-forwarded-for')
    headers.set('x-forwarded-host', url.host)
    headers.delete('x-origin-auth')
    if (env.ORIGIN_SECRET) headers.set('x-origin-auth', env.ORIGIN_SECRET)
    headers.set('x-forwarded-proto', url.protocol.replace(':', ''))

    return fetch(
      new Request(target, {
        method: request.method,
        headers,
        body: request.body,
        redirect: 'manual',
      }),
    )
  },
}
