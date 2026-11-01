// Usage: DATABASE_URL=postgres://… npm run store:import --workspace server [-- path/to/store.json]
import { config } from '../config.js'
import { pgDb } from './db.js'
import { importJsonFile } from './import.js'
import { openPostgresStore } from './postgres.js'

const file = process.argv[2] ?? config.dataFile
if (!config.databaseUrl) {
  console.error('Set DATABASE_URL to the Postgres database to import into.')
  process.exit(1)
}

const db = pgDb(config.databaseUrl)
try {
  const count = await importJsonFile(file, await openPostgresStore(db))
  console.log(`Imported ${count} subscriptions from ${file}.`)
} finally {
  await db.close()
}
