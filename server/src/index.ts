import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { config, pushEnabled } from './config.js'
import { createPoller } from './poller.js'
import { sendPush, type SendResult } from './push.js'
import { openStore } from './store/index.js'
import type { AlertPayload } from './types.js'

// End-to-end test runs: no GDACS polling, and alerts are logged instead of pushed
const e2e = process.env.E2E === '1'
const send = e2e
  ? async (_sub: unknown, payload: AlertPayload): Promise<SendResult> => (console.log('[e2e push]', payload.title), 'sent')
  : sendPush

// Opened before serving so a broken store stops startup instead of being overwritten later
const store = await openStore()
const poller = createPoller(store, send)
const app = createApp({ store, poller, sendPush: send })

serve({ fetch: app.fetch, port: config.port }, (info) => {
  const mode = e2e ? 'E2E mode, no polling' : `push ${pushEnabled ? 'on' : 'OFF — set VAPID keys'}`
  console.log(`hazard-globe server on http://localhost:${info.port} (${mode})`)
  if (!e2e) poller.start()
})
