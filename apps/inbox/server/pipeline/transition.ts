import { eq } from 'drizzle-orm'
import type { Db } from './db/client.js'
import { workItems, type WorkItemStatus } from './db/schema.js'

// Every `work_items.status` write goes through here. One transaction:
// SELECT … FOR UPDATE the row → check the edge is legal from the current status →
// UPDATE → COMMIT. The row lock serializes concurrent transitions (design §3.6).

export type Edge = 'start' | 'gate' | 'resume' | 'finish' | 'fail'

export class IllegalTransition extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IllegalTransition'
  }
}

// Step-3 wired subset (design §4). Cancel edges + the full all-inbound-edges guard table
// land in step 4; the guard *mechanism* (FOR UPDATE + legality check) is built here.
const EDGES: Record<Edge, { from: WorkItemStatus[]; to: WorkItemStatus }> = {
  start: { from: ['queued'], to: 'running' },
  gate: { from: ['running'], to: 'awaiting_approval' },
  resume: { from: ['awaiting_approval'], to: 'running' },
  finish: { from: ['running'], to: 'finished' },
  fail: { from: ['running', 'awaiting_approval'], to: 'error' },
}

// Statuses that count as an active child (block a parent's auto-finish).
const ACTIVE: WorkItemStatus[] = ['queued', 'running', 'awaiting_approval', 'awaiting_input']

export interface TransitionOpts {
  error?: string
}

export async function transition(
  db: Db,
  id: string,
  edge: Edge,
  opts: TransitionOpts = {}
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(workItems).where(eq(workItems.id, id)).for('update')
    if (!row) throw new IllegalTransition(`work item ${id} not found`)

    const spec = EDGES[edge]
    if (!spec.from.includes(row.status)) {
      throw new IllegalTransition(`cannot "${edge}" from "${row.status}" (work item ${id})`)
    }

    await tx
      .update(workItems)
      .set({
        status: spec.to,
        updatedAt: new Date(),
        ...(edge === 'fail' && opts.error ? { error: opts.error } : {}),
      })
      .where(eq(workItems.id, id))
  })
}

// Re-exported for Task 2.2 (the auto-finish walk reuses the active-child predicate).
export { ACTIVE }
