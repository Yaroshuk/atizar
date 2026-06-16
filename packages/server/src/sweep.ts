import { asc, eq } from 'drizzle-orm'
import type { Db } from './db/client.js'
import { workItems } from './db/schema.js'

// Startup reconciliation (spec §1.2): executor handles are process-local, so on boot NO 'active'
// row has a live executor — each is a zombie from a prior process and becomes terminal/error.
// 'queued' rows are re-fed to the pool in createdAt order. 'awaiting_human' is DURABLE (a gate
// waiting on a human) and is deliberately left untouched. Direct bulk UPDATE (not settle) is
// correct here: the sweep is the single actor at boot, before the server accepts requests.
export async function startupSweep(
  db: Db,
  reenqueue?: (item: { id: string; agentId: string }) => void
): Promise<void> {
  await db
    .update(workItems)
    .set({ phase: 'terminal', outcome: 'error', error: 'executor lost', updatedAt: new Date() })
    .where(eq(workItems.phase, 'active'))

  if (reenqueue) {
    const queued = await db
      .select({ id: workItems.id, agentId: workItems.agentId })
      .from(workItems)
      .where(eq(workItems.phase, 'queued'))
      .orderBy(asc(workItems.createdAt))
    for (const item of queued) reenqueue(item)
  }
}
