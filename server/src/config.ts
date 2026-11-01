try {
  // Node >= 20.12 / 21.7 can load .env without a dependency
  process.loadEnvFile?.('.env')
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
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
    privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
    subject: process.env.VAPID_SUBJECT ?? 'mailto:maintainer@example.com',
  },
  opensky: {
    clientId: process.env.OPENSKY_CLIENT_ID ?? '',
    clientSecret: process.env.OPENSKY_CLIENT_SECRET ?? '',
    refreshSeconds: process.env.FLIGHTS_REFRESH_SECONDS ? num('FLIGHTS_REFRESH_SECONDS', 0) : undefined,
  },
}

export const pushEnabled = Boolean(config.vapid.publicKey && config.vapid.privateKey)
