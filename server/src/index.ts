import { appendFile } from 'node:fs/promises'
import { serve } from '@hono/node-server'
import nodemailer from 'nodemailer'
import { createApp } from './app.js'
import { config, pushEnabled } from './config.js'
import { createDeliver, type Notifier, type Notifiers } from './delivery.js'
import { loadClimatology } from './climatology/index.js'
import { createEarthquakes } from './earthquakes.js'
import { createEmailNotifier, type EmailNotifier, type Mailer } from './email.js'
import { createHistory } from './history.js'
import { createPoller } from './poller.js'
import { pushNotifier } from './push.js'
import { createSatellites } from './satellites.js'
import { createDart } from './dart.js'
import { createReliefWeb } from './reliefweb.js'
import { createSourcePoller } from './sourceAlerts.js'
import { createTsunamiWatch } from './tsunami.js'
import { createShips } from './ships.js'
import { createSpaceWeather } from './spaceWeather.js'
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
const tsunami = createTsunamiWatch()
// Tsunami messages can't wait for GDACS's 15 minutes: their own poll, every 2
const tsunamiAlerts = createSourcePoller({ name: 'tsunami', intervalMs: 2 * 60_000, items: tsunami.items, store, deliver })
const app = createApp({
  store,
  poller,
  history: createHistory(),
  satellites: createSatellites(),
  flightTrack: createTracks(),
  wind: createWind(),
  earthquakes: createEarthquakes(),
  climatology: await loadClimatology(),
  spaceWeather: createSpaceWeather(),
  // Never in end-to-end runs: they mustn't reach tsunami.gov or NDBC
  tsunami: e2e ? undefined : tsunami,
  dart: e2e ? undefined : createDart(),
  // Never in end-to-end runs: they mustn't reach ReliefWeb
  reliefweb: config.reliefwebAppname && !e2e ? createReliefWeb({ appname: config.reliefwebAppname }) : undefined,
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
  if (!e2e) {
    poller.start()
    tsunamiAlerts.start()
  }
})
