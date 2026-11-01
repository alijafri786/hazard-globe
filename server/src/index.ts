import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { config, pushEnabled } from './config.js'
import { createPoller } from './poller.js'
import { sendPush } from './push.js'
import { openStore } from './store/index.js'

// Opened before serving so a broken store stops startup instead of being overwritten later
const store = await openStore()
const poller = createPoller(store, sendPush)
const app = createApp({ store, poller, sendPush })

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`hazard-globe server on http://localhost:${info.port} (push ${pushEnabled ? 'on' : 'OFF — set VAPID keys'})`)
  poller.start()
})
