import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

// Postgres is THE backend (dev included). Defaults to the docker-compose creds so the
// standard setup (`docker compose up -d postgres`) needs no env file; override with
// DATABASE_URL. The app server itself NEVER runs in Docker (claude-cli needs the local
// binary + macOS keychain — docs/pipeline-updated-3.md §1.7).
export const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://aiworkflow:aiworkflow@localhost:5432/aiworkflow'

const sql = postgres(databaseUrl)

export const db = drizzle(sql, { schema })
export type Db = typeof db

// Closes the underlying connection pool (tests / one-shot scripts; the long-lived server
// never calls this).
export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 })
}
