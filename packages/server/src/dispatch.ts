import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { lifecycle } from '@atizar/core'
import type { Db } from './db/client.js'
import { workItems, type OriginKind } from './db/schema.js'
import { transition } from './transition.js'
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
  key: string
  parentId?: string | null
  maxInstances: number
}

export interface DispatchResult {
  id: string
  deduped: boolean
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
  // 1. One-time dedup via the SINGLE classifier (Option A): a same-source item that COVERS shadows
  //    this dispatch (live OR a freeze-and-keep terminal — done/stopped). An un-actioned terminal
  //    (rejected/superseded/reset/error) does NOT cover, so a re-scan re-surfaces the source. This
  //    is the exhaustive replacement for the old SQL ne/notInArray block (which silently omitted
  //    'reset' — the latent bug this closes). The card-keeps-it dimension is irrelevant to dedup,
  //    so hasCard/hasLiveDescendant are passed false here.
  if (input.source) {
    const rows = await db
      .select({ id: workItems.id, phase: workItems.phase, outcome: workItems.outcome })
      .from(workItems)
      .where(eq(workItems.source, input.source))
    const covering = rows.find((r) => lifecycle(r.phase, r.outcome, false, false).covers)
    if (covering) return { id: covering.id, deduped: true }
  }

  // 2. Depth cap.
  const ancestors = await countAncestors(db, input.parentId ?? null)
  if (ancestors >= DEPTH_CAP) throw new DepthExceeded(ancestors)

  // Episode boundary (server-authoritative): inherit the current episode if a sibling of this
  // (workflowId, agentId, key) is still live, else start a fresh episode (max+1). A keyed instance
  // that fully receded and reactivates thus starts a new episode — its prior done runs do not
  // resurrect in the open thread.
  const siblings = await db
    .select({
      episodeSeq: workItems.episodeSeq,
      phase: workItems.phase,
      outcome: workItems.outcome,
    })
    .from(workItems)
    .where(
      and(
        eq(workItems.workflowId, input.workflowId),
        eq(workItems.agentId, input.agentId),
        eq(workItems.key, input.key)
      )
    )
  const maxSeq = siblings.reduce((m, s) => Math.max(m, s.episodeSeq), 0)
  const anyLive = siblings.some((s) => lifecycle(s.phase, s.outcome, false, false).isLive)
  const episodeSeq = siblings.length === 0 || !anyLive ? maxSeq + 1 : maxSeq

  // 3. Insert `queued`, then reopen the parent if it auto-finished concurrently (see below).
  const id = randomUUID()
  await db.transaction(async (tx) => {
    await tx.insert(workItems).values({
      id,
      workflowId: input.workflowId,
      agentId: input.agentId,
      origin: input.origin,
      payload: input.payload,
      source: input.source ?? null,
      key: input.key,
      episodeSeq,
      parentId: input.parentId ?? null,
      phase: 'queued',
      outcome: 'running',
    })
  })
  // A parent that finished concurrently must reopen — a fresh active child can't hang off a
  // terminal parent (finish-vs-dispatch race). transition('reopen') throws IllegalTransition if the
  // parent isn't a clean done (already active, or stopped/rejected) — swallow it.
  if (input.parentId) {
    await transition(db, input.parentId, 'reopen').catch(() => {})
  }

  // 4. Enqueue (the pool starts it on a free slot).
  pool.enqueue(id, input.agentId, input.maxInstances)
  return { id, deduped: false }
}
