import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'
import { atizarEnv } from '../env.js'

// Postgres is THE backend (dev included). Precedence + default live in atizarEnv
// (ATIZAR_DATABASE_URL > DATABASE_URL > compose default), so a fresh
// `docker compose up -d postgres` still needs no env file. The app server itself NEVER runs in
// Docker (claude-cli needs the local binary + macOS keychain — docs/pipeline-updated-3.md §1.7).
export const databaseUrl = atizarEnv.databaseUrl()

const sql = postgres(databaseUrl)

export const db = drizzle(sql, { schema })
export type Db = typeof db

// Closes the underlying connection pool (tests / one-shot scripts; the long-lived server
// never calls this).
export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 })
}
