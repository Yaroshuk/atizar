import { sql } from 'drizzle-orm'
import { db } from './client.js'

// Truncate every pipeline data table (leaves schema_meta AND the `credentials` table — a DB
// reset keeps you connected). For tests between cases. CASCADE handles the gate→work_item FK;
// RESTART IDENTITY is a no-op here (no serials).
export async function resetDb(): Promise<void> {
  await db.execute(sql`TRUNCATE work_items, gates, trace, action_ledger RESTART IDENTITY CASCADE`)
}

// Truncate ONLY the encrypted credential store — drops every stored connection (you must
// re-Connect). The equivalent of clicking Disconnect on every integration at once.
export async function resetCredentials(): Promise<void> {
  await db.execute(sql`TRUNCATE credentials`)
}

// Full data wipe: pipeline state PLUS the credential store (you must re-Connect afterwards).
export async function resetAll(): Promise<void> {
  await db.execute(
    sql`TRUNCATE work_items, gates, trace, action_ledger, credentials RESTART IDENTITY CASCADE`
  )
}
