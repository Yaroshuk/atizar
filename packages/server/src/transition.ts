import { eq } from 'drizzle-orm'
import type { Db } from './db/client.js'
import { workItems, type WorkItemStatus } from './db/schema.js'

// Every `work_items.status` write goes through here. One transaction:
// SELECT … FOR UPDATE the row → check the edge is legal from the current status →
// UPDATE → COMMIT. The row lock serializes concurrent transitions (design §3.6).
//
// Single-responsibility lifecycle (Approach B): every item finishes on its OWN run-end.
// A finish edge lands `finished` regardless of any live children, and a child reaching a
// terminal status NEVER touches its parent (no leaf→root auto-finish walk). A parent is shown
// "Working" purely by the pipeline's live-descendant derivation (pipelineModel.view's
// hasLiveDescendant), not by its DB status — so the DB status reflects only the item's own run.

export type Edge =
  | 'start'
  | 'gate'
  | 'resume'
  | 'finish'
  | 'fail'
  | 'cancel'
  | 'reject'
  | 'supersede'
  | 'reset'

export class IllegalTransition extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IllegalTransition'
  }
}

const EDGES: Record<Edge, { from: WorkItemStatus[]; to: WorkItemStatus }> = {
  start: { from: ['queued'], to: 'running' },
  gate: { from: ['running'], to: 'awaiting_approval' },
  resume: { from: ['awaiting_approval'], to: 'running' },
  finish: { from: ['running'], to: 'finished' },
  fail: { from: ['running', 'awaiting_approval'], to: 'error' },
  cancel: { from: ['queued', 'running', 'awaiting_approval', 'awaiting_input'], to: 'finished' },
  reject: { from: ['awaiting_approval'], to: 'finished' },
  // Re-run/refresh (WS1): retire a prior FINISHED scan root into the preserved Done bucket.
  // supersede/reset never cascade to children — per-item work items stay durable (I12); every
  // item already finishes on its own run-end, so there is no parent walk to trigger either.
  supersede: { from: ['finished', 'result'], to: 'closed' },
  // Board RESET (Unit 4.4): a human cleared the board — retire a TERMINAL item into the
  // preserved Done bucket so it leaves the live column. Legal ONLY from a terminal status
  // (finished/result/error); a running/awaiting item must be `cancel`led first (I12 — open
  // work is never silently lost). Like supersede: no children cascade — every work item row
  // stays durable (hidden, not deleted).
  reset: { from: ['finished', 'result', 'error'], to: 'closed' },
}

// Terminal-outcome marker set by explicit human commands (orthogonal to status).
const EDGE_RESOLUTION: Partial<Record<Edge, 'cancelled' | 'rejected' | 'superseded' | 'reset'>> = {
  cancel: 'cancelled',
  reject: 'rejected',
  supersede: 'superseded',
  reset: 'reset',
}

// Statuses that count as an active (non-terminal) work item. The store classifies live items
// against this set (board snapshot / active-children cancel cascade); it no longer gates any
// parent auto-finish here.
const ACTIVE: WorkItemStatus[] = ['queued', 'running', 'awaiting_approval', 'awaiting_input']

// Statuses the `reset` edge accepts, DERIVED from the edge table so the two can't drift. A
// board RESET only retires items already in one of these terminal statuses; active/awaiting
// work must be cancelled first (I12). Exported so the service/store classify resettable items
// in one place.
const RESETTABLE: WorkItemStatus[] = EDGES.reset.from

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

    // Single responsibility (Approach B): an item finishes on its OWN run-end. A finish lands
    // `finished` even with live children, and a terminal child never walks its parent — the
    // pipeline shows a parent "Working" via its live-descendant derivation, not its DB status.
    await tx
      .update(workItems)
      .set({
        status: spec.to,
        updatedAt: new Date(),
        ...(edge === 'fail' && opts.error ? { error: opts.error } : {}),
        ...(EDGE_RESOLUTION[edge] ? { resolution: EDGE_RESOLUTION[edge] } : {}),
      })
      .where(eq(workItems.id, id))
  })
}

// Re-exported: the store classifies live items against ACTIVE (board snapshot / cancel cascade)
// and resettable items against RESETTABLE (derived from EDGES.reset.from).
export { ACTIVE, RESETTABLE }
