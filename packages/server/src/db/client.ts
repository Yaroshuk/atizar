import * as schema from './schema.js'
import { atizarEnv, isDemo } from '../env.js'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

// Postgres is THE backend (dev included). Precedence + default live in atizarEnv
// (ATIZAR_DATABASE_URL > DATABASE_URL > compose default), so a fresh
// `docker compose up -d postgres` still needs no env file. The app server itself NEVER runs in
// Docker (claude-cli needs the local binary + macOS keychain — docs/pipeline-updated-3.md §1.7).
// DEMO=1 swaps Docker-Postgres for in-memory PGlite (Postgres-in-WASM, same dialect — the
// db/migrations/ SQL runs unchanged); the driver is lazy-loaded so PGlite stays an optional peer.
export const databaseUrl = atizarEnv.databaseUrl()

export type Db = PostgresJsDatabase<typeof schema>

let _db: Db
let _close: () => Promise<void>

if (isDemo()) {
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const client = new PGlite() // in-memory; fresh each boot
  _db = drizzle(client, { schema }) as unknown as Db
  _close = async () => {
    await client.close()
  }
} else {
  const { default: postgres } = await import('postgres')
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const sql = postgres(databaseUrl)
  _db = drizzle(sql, { schema })
  _close = async () => {
    await sql.end({ timeout: 5 })
  }
}

export const db: Db = _db

// Closes the underlying connection pool (tests / one-shot scripts; the long-lived server
// never calls this).
export async function closeDb(): Promise<void> {
  await _close()
}
