try {
  // Node >= 20.12 / 21.7 can load .env without a dependency. Tests stay hermetic: never real keys or files.
  if (!process.env.VITEST) process.loadEnvFile?.('.env')
} catch {
  /* no .env file — rely on real environment variables */
}

function num(name: string, fallback: number): number {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

export const config = {
  port: num('PORT', 8787),
  pollIntervalMinutes: Math.max(10, num('POLL_INTERVAL_MINUTES', 15)),
  lookbackDays: num('LOOKBACK_DAYS', 10),
  dataFile: process.env.DATA_FILE ?? './data/store.json',
  /** When set, subscriptions live in Postgres instead of DATA_FILE */
  databaseUrl: process.env.DATABASE_URL ?? '',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  /** Reverse proxies in front of the server; their X-Forwarded-For entries are trusted for client IPs. */
  trustProxy: Number.parseInt(process.env.TRUST_PROXY ?? '0', 10) || 0,
  maxSubscribers: num('MAX_SUBSCRIBERS', 1000),
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
    privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
    subject: process.env.VAPID_SUBJECT ?? 'mailto:maintainer@example.com',
  },
  /** Where people reach the app; links in emails start here. Defaults to WEB_ORIGIN, which proxies /api in dev. */
  publicUrl: (process.env.PUBLIC_URL || process.env.WEB_ORIGIN || 'http://localhost:5173').replace(/\/+$/, ''),
  email: {
    smtpUrl: process.env.SMTP_URL ?? '',
    from: process.env.MAIL_FROM ?? '',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  },
  /** Ships from AISStream.io (free key); off without one */
  aisstreamKey: process.env.AISSTREAM_API_KEY ?? '',
  opensky: {
    clientId: process.env.OPENSKY_CLIENT_ID ?? '',
    clientSecret: process.env.OPENSKY_CLIENT_SECRET ?? '',
    refreshSeconds: process.env.FLIGHTS_REFRESH_SECONDS ? num('FLIGHTS_REFRESH_SECONDS', 0) : undefined,
  },
}

export const pushEnabled = Boolean(config.vapid.publicKey && config.vapid.privateKey)
