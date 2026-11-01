import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

/** The little the Postgres store needs from a driver. node-postgres in production, PGlite in tests. */
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>
  /** Runs a script of several statements, without parameters. */
  exec(script: string): Promise<void>
}

export interface Db extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export function pgDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 })
  const wrap = (c: pg.Pool | pg.PoolClient): Queryable => ({
    query: async <T>(text: string, params?: unknown[]) => ({ rows: (await c.query(text, params)).rows as T[] }),
    exec: async (script) => void (await c.query(script)), // no parameters: simple protocol, several statements
  })

  return {
    ...wrap(pool),
    async transaction(fn) {
      const client = await pool.connect()
      try {
        await client.query('begin')
        const result = await fn(wrap(client))
        await client.query('commit')
        return result
      } catch (err) {
        await client.query('rollback').catch(() => undefined)
        throw err
      } finally {
        client.release()
      }
    },
    close: () => pool.end(),
  }
}

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url))

/** Applies any migrations in server/migrations not yet recorded, in file-name order. Safe to run from several instances at once. */
export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  return db.transaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(727274)') // arbitrary app-wide lock id
    await tx.exec(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    )
    const done = new Set((await tx.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name))
    const applied: string[] = []
    for (const file of files) {
      if (done.has(file)) continue
      await tx.exec(await readFile(join(dir, file), 'utf8'))
      await tx.query('insert into schema_migrations (name) values ($1)', [file])
      applied.push(file)
    }
    return applied
  })
}
