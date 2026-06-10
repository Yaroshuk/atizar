import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { PostgresStore } from '@mastra/pg'

const MIGRATIONS_FOLDER = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

// Vitest globalSetup (runs once, before any worker). Creates the dedicated TEST database and
// applies migrations so pipeline tests run against a schema identical to dev — but isolated,
// so test rows never reach the dev server's startup sweep. If Postgres is unreachable the
// pipeline tests skip themselves (describe.skipIf), so a failure here is swallowed.
const ADMIN_URL =
  process.env.DATABASE_URL ?? 'postgres://aiworkflow:aiworkflow@localhost:5432/aiworkflow'
const TEST_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://aiworkflow:aiworkflow@localhost:5432/aiworkflow_test'
const TEST_DB = 'aiworkflow_test'

export default async function setup(): Promise<void> {
  try {
    const admin = postgres(ADMIN_URL)
    try {
      const exists = await admin`SELECT 1 FROM pg_database WHERE datname = ${TEST_DB}`
      if (exists.length === 0) await admin.unsafe(`CREATE DATABASE ${TEST_DB}`)
    } finally {
      await admin.end({ timeout: 5 })
    }

    const sql = postgres(TEST_URL)
    try {
      await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_FOLDER })
    } finally {
      await sql.end({ timeout: 5 })
    }

    // Init Mastra's OWN storage tables in the test DB too (kept OUT of our drizzle migration set
    // — caution c). PostgresStore.init() is idempotent; close() releases the pool so vitest exits
    // cleanly. No test runs real Mastra today, but a PROVIDER=mastra run against the test DB then
    // finds its tables present.
    const mastraStore = new PostgresStore({ id: 'mastra-test', connectionString: TEST_URL })
    try {
      await mastraStore.init()
    } finally {
      await mastraStore.close()
    }
  } catch (err) {
    console.warn('[test-global-setup] Postgres unreachable — pipeline tests will skip:', err)
  }
}
