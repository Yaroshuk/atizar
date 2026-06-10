import { asc, eq } from 'drizzle-orm'
import type { Db } from './db/client.js'
import { workItems } from './db/schema.js'

// Startup reconciliation (spec §1.2): executor handles are process-local (an in-memory Map),
// so on boot NO `running` row has a live executor — each is a zombie from a prior process and
// becomes `error('executor lost')` (retryable later). `queued` rows are re-fed to the pool in
// createdAt order. `awaiting_approval` is a DURABLE state (a gate waiting on a human) and is
// deliberately left untouched — surviving a restart is the whole point of step 3.
//
// Direct bulk UPDATE (not transition()) is correct here: the sweep is the single actor at boot,
// before the server accepts requests.
export async function startupSweep(
  db: Db,
  reenqueue?: (item: { id: string; agentId: string }) => void
): Promise<void> {
  await db
    .update(workItems)
    .set({ status: 'error', error: 'executor lost', updatedAt: new Date() })
    .where(eq(workItems.status, 'running'))

  if (reenqueue) {
    const queued = await db
      .select({ id: workItems.id, agentId: workItems.agentId })
      .from(workItems)
      .where(eq(workItems.status, 'queued'))
      .orderBy(asc(workItems.createdAt))
    for (const item of queued) reenqueue(item)
  }
}
