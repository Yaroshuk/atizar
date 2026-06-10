import { eq } from 'drizzle-orm'
import type { Db } from './db/client.js'
import { workItems, type WorkItemStatus } from './db/schema.js'

// A live transaction handle (drizzle passes this to the .transaction() callback).
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

// Every `work_items.status` write goes through here. One transaction:
// SELECT … FOR UPDATE the row → check the edge is legal from the current status →
// UPDATE → COMMIT. The row lock serializes concurrent transitions (design §3.6).

export type Edge = 'start' | 'gate' | 'resume' | 'finish' | 'fail' | 'cancel' | 'reject'

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
}

// Terminal-outcome marker set by explicit human commands (orthogonal to status).
const EDGE_RESOLUTION: Partial<Record<Edge, 'cancelled' | 'rejected'>> = {
  cancel: 'cancelled',
  reject: 'rejected',
}

// Statuses that count as an active child (block a parent's auto-finish).
const ACTIVE: WorkItemStatus[] = ['queued', 'running', 'awaiting_approval', 'awaiting_input']

export interface TransitionOpts {
  error?: string
}

// True when `id` has at least one active (non-terminal) child.
async function hasActiveChild(tx: Tx, id: string): Promise<boolean> {
  const children = await tx
    .select({ status: workItems.status })
    .from(workItems)
    .where(eq(workItems.parentId, id))
  return children.some((c) => ACTIVE.includes(c.status))
}

// Leaf→root auto-finish walk. Lock the parent FOR UPDATE (consistent child-before-parent
// order — no lock cycle), and finish it iff it is `running` with no active children left;
// recurse to the root. The "no active children" check IS the finished entry guard, here
// in one place (design §4).
async function autoFinishParent(tx: Tx, parentId: string): Promise<void> {
  const [parent] = await tx.select().from(workItems).where(eq(workItems.id, parentId)).for('update')
  if (!parent || parent.status !== 'running') return
  if (await hasActiveChild(tx, parentId)) return

  await tx
    .update(workItems)
    .set({ status: 'finished', updatedAt: new Date() })
    .where(eq(workItems.id, parentId))
  if (parent.parentId) await autoFinishParent(tx, parent.parentId)
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

    // Finished entry guard: an item with active children does NOT finish — it stays
    // `running` (shown "Working"); the last child's finish triggers the parent walk.
    // This is the parent-stream-ended-before-children case; a deferred finish, not an error.
    if (edge === 'finish' && (await hasActiveChild(tx, id))) return

    await tx
      .update(workItems)
      .set({
        status: spec.to,
        updatedAt: new Date(),
        ...(edge === 'fail' && opts.error ? { error: opts.error } : {}),
        ...(EDGE_RESOLUTION[edge] ? { resolution: EDGE_RESOLUTION[edge] } : {}),
      })
      .where(eq(workItems.id, id))

    if (edge === 'finish' && row.parentId) await autoFinishParent(tx, row.parentId)
  })
}

// Re-exported (the auto-finish walk reuses the active-child predicate).
export { ACTIVE }
