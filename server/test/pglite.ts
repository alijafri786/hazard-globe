import { PGlite, type Transaction } from '@electric-sql/pglite'
import type { Db, Queryable } from '../src/store/db.js'

/** Real Postgres compiled to WebAssembly, in memory: the same SQL as production with no server to run. */
export async function pgliteDb(): Promise<Db> {
  const lite = await PGlite.create()
  const wrap = (q: PGlite | Transaction): Queryable => ({
    query: async <T>(text: string, params?: unknown[]) => ({ rows: (await q.query<T>(text, params)).rows }),
    exec: async (script) => void (await q.exec(script)),
  })
  return {
    ...wrap(lite),
    transaction: (fn) => lite.transaction((tx) => fn(wrap(tx))),
    close: () => lite.close(),
  }
}
