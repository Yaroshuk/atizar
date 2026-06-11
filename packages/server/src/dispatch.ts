import { randomUUID } from 'node:crypto'
import { and, eq, ne, or, isNull } from 'drizzle-orm'
import type { Db } from './db/client.js'
import { workItems, type OriginKind } from './db/schema.js'
import type { WorkerPool } from './workerPool.js'

// The ONE chokepoint every dispatch goes through (spec §1.8): mint the id, one-time dedup
// by `source`, depth cap, insert `queued`, enqueue in the pool. `inbound` origin is reserved
// (machine dispatch) — no producer ships in the beta; machine *action* is forbidden.

export const DEPTH_CAP = 5

export class DepthExceeded extends Error {
  constructor(depth: number) {
    super(`dispatch depth ${depth} exceeds cap ${DEPTH_CAP}`)
    this.name = 'DepthExceeded'
  }
}

export interface DispatchInput {
  workflowId: string
  agentId: string
  origin: OriginKind
  payload: Record<string, unknown>
  source?: string | null
  parentId?: string | null
  maxInstances: number
}

export interface DispatchResult {
  id: string
  deduped: boolean
  /** Present only when a human START is rejected because the singleton cap is already full. */
  rejected?: 'already_running'
}

// Count ancestors of `parentId` (a root parent = 1, its parent = 2 …). Stops early once it
// reaches the cap (the caller throws anyway). null parent ⇒ 0.
async function countAncestors(db: Db, parentId: string | null): Promise<number> {
  let count = 0
  let cur = parentId
  while (cur && count < DEPTH_CAP) {
    count++
    const [row] = await db
      .select({ parentId: workItems.parentId })
      .from(workItems)
      .where(eq(workItems.id, cur))
      .limit(1)
    cur = row?.parentId ?? null
  }
  return count
}

export async function dispatch(
  db: Db,
  pool: WorkerPool,
  input: DispatchInput
): Promise<DispatchResult> {
  // 1. One-time dedup: a live/finished WorkItem with the same source already covers this
  //    source (a rejected or errored one does NOT — it offers an explicit re-run). Ledger/
  //    approved-only dedup is refined at step 4.
  if (input.source) {
    const [existing] = await db
      .select({ id: workItems.id })
      .from(workItems)
      .where(
        and(
          eq(workItems.source, input.source),
          ne(workItems.status, 'error'),
          or(isNull(workItems.resolution), ne(workItems.resolution, 'rejected'))
        )
      )
      .limit(1)
    if (existing) return { id: existing.id, deduped: true }
  }

  // 2. Depth cap.
  const ancestors = await countAncestors(db, input.parentId ?? null)
  if (ancestors >= DEPTH_CAP) throw new DepthExceeded(ancestors)

  // 3. Insert `queued`. If the parent auto-finished concurrently, reopen it FOR UPDATE —
  //    a parent with a fresh active child must not stay finished (finish-vs-dispatch race).
  const id = randomUUID()
  await db.transaction(async (tx) => {
    if (input.parentId) {
      const [parent] = await tx
        .select()
        .from(workItems)
        .where(eq(workItems.id, input.parentId))
        .for('update')
      if (parent && parent.status === 'finished' && parent.resolution === null) {
        await tx
          .update(workItems)
          .set({ status: 'running', updatedAt: new Date() })
          .where(eq(workItems.id, input.parentId))
      }
    }
    await tx.insert(workItems).values({
      id,
      workflowId: input.workflowId,
      agentId: input.agentId,
      origin: input.origin,
      payload: input.payload,
      source: input.source ?? null,
      parentId: input.parentId ?? null,
      status: 'queued',
    })
  })

  // 4. Enqueue (the pool starts it on a free slot).
  pool.enqueue(id, input.agentId, input.maxInstances)
  return { id, deduped: false }
}
