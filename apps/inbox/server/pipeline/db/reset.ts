import { sql } from 'drizzle-orm'
import { db } from './client.js'

// Truncate every pipeline data table (leaves schema_meta). For tests between cases.
// CASCADE handles the gate→work_item FK; RESTART IDENTITY is a no-op here (no serials).
export async function resetDb(): Promise<void> {
  await db.execute(sql`TRUNCATE work_items, gates, trace, action_ledger RESTART IDENTITY CASCADE`)
}
