import { appendFile } from 'node:fs/promises'
import { serve } from '@hono/node-server'
import nodemailer from 'nodemailer'
import { createApp } from './app.js'
import { config, pushEnabled } from './config.js'
import { createDeliver, type Notifier, type Notifiers } from './delivery.js'
import { createEmailNotifier, type EmailNotifier, type Mailer } from './email.js'
import { createHistory } from './history.js'
import { createPoller } from './poller.js'
import { pushNotifier } from './push.js'
import { createSatellites } from './satellites.js'
import { createShips } from './ships.js'
import { openStore, storeKind } from './store/index.js'
import { createTracks } from './tracks.js'
import { createWind } from './weather/wind.js'
import { createBot, createTelegramNotifier, telegramApi } from './telegram.js'
import type { PushChannel } from './types.js'

// End-to-end test runs: no GDACS polling or Telegram, pushes are only logged, and email goes to a file
const e2e = process.env.E2E === '1'
const e2ePush: Notifier<PushChannel> = { send: async (_, p) => (console.log('[e2e push]', p.title), 'sent') }
const e2eMailer: Mailer = {
  sendMail: (message) => appendFile(`${config.dataFile}.outbox.jsonl`, `${JSON.stringify(message)}\n`),
}

// Opened before serving so a broken store stops startup instead of being overwritten later
const store = await openStore()

let email: EmailNotifier | undefined
if (e2e) email = createEmailNotifier(e2eMailer, { from: 'alerts@e2e.test', publicUrl: config.publicUrl })
else if (config.email.smtpUrl && config.email.from) {
  email = createEmailNotifier(nodemailer.createTransport(config.email.smtpUrl), {
    from: config.email.from,
    publicUrl: config.publicUrl,
  })
}

const notifiers: Notifiers = { push: e2e ? e2ePush : pushNotifier, email }
let telegramBot: string | undefined
if (config.telegram.botToken && !e2e) {
  const api = telegramApi(config.telegram.botToken)
  try {
    telegramBot = (await api.call<{ username: string }>('getMe')).username
    notifiers.telegram = createTelegramNotifier(api)
    createBot({ api, store }).start()
  } catch (err) {
    console.error('[telegram] disabled, could not reach the bot:', (err as Error).message)
  }
}

const deliver = createDeliver(notifiers)
const poller = createPoller(store, deliver)
const app = createApp({
  store,
  poller,
  history: createHistory(),
  satellites: createSatellites(),
  flightTrack: createTracks(),
  wind: createWind(),
  // Never in end-to-end runs: they mustn't open a real stream
  ships: config.aisstreamKey && !e2e ? createShips({ apiKey: config.aisstreamKey }) : undefined,
  deliver,
  email,
  telegramBot,
  pushEnabled: e2e || pushEnabled,
})

serve({ fetch: app.fetch, port: config.port }, (info) => {
  const channels = [
    `push ${pushEnabled ? 'on' : 'OFF — set VAPID keys'}`,
    `email ${email ? 'on' : 'off'}`,
    `telegram ${telegramBot ? `@${telegramBot}` : 'off'}`,
    `ships ${config.aisstreamKey ? 'on' : 'off'}`,
  ]
  const mode = e2e ? 'E2E mode, no polling' : `${channels.join(', ')}, ${storeKind} store`
  console.log(`hazard-globe server on http://localhost:${info.port} (${mode})`)
  if (!e2e) poller.start()
})
