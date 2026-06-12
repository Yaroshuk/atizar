import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { db, closeDb } from './client.js'
import { schemaMeta } from './schema.js'
import { isDemo } from '../env.js'

// Resolved relative to THIS file so it is cwd-independent — the engine package can be
// consumed from any app dir, and boot/predev/test all share one path.
const MIGRATIONS_FOLDER = join(dirname(fileURLToPath(import.meta.url)), 'migrations')
const SCHEMA_VERSION = '1'

// Apply pending migrations, then upsert the app-readable schema_version row. Idempotent:
// safe to run on every `yarn dev` (predev) and at server boot (migrate-on-boot).
export async function runMigrations(): Promise<void> {
  const { migrate } = isDemo()
    ? await import('drizzle-orm/pglite/migrator')
    : await import('drizzle-orm/postgres-js/migrator')
  // `db as never`: the two migrators have different nominal db-param types, but both accept our
  // db + the same migrations folder at runtime (same Postgres dialect) — TS can't prove the union.
  await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER })
  await db
    .insert(schemaMeta)
    .values({ key: 'schema_version', value: SCHEMA_VERSION })
    .onConflictDoUpdate({ target: schemaMeta.key, set: { value: SCHEMA_VERSION } })
}

// Direct-run entry (`tsx packages/server/src/db/migrate.ts`).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => closeDb())
    .then(() => {
      console.log('[db] migrations applied')
      process.exit(0)
    })
    .catch((err) => {
      console.error('[db] migration failed:', err)
      process.exit(1)
    })
}
