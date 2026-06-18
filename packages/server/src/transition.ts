import { eq } from 'drizzle-orm'
import type { Phase, Outcome } from '@atizar/core'
import type { Db, Tx } from './db/client.js'
import { workItems } from './db/schema.js'

// Every `work_items.phase`/`outcome` write goes through ONE edge-writer — applyEdge():
// SELECT … FOR UPDATE → check the edge is legal from the current phase/outcome → UPDATE.
// The row lock serializes concurrent transitions (I8). applyEdge runs on ANY executor (db or an
// open tx), so settle() (U4) composes it into its OWN transaction to keep note+status+audit atomic
// — one writer, never a duplicated raw update. transition() is the standalone wrapper.
//
// Single-responsibility lifecycle (Approach B): every item finishes on its OWN run-end. A finish
// edge lands terminal regardless of any live children, and a child reaching terminal NEVER touches
// its parent. A parent is shown "Working" purely by the pipeline's live-descendant derivation.

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
  | 'reopen'
  | 'acknowledge'
  | 'ask'
  | 'answered'

export class IllegalTransition extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IllegalTransition'
  }
}

// Each edge declares the phases it is legal FROM (matched against the current `phase`), the phase
// it moves TO, and the outcome it stamps. `running` keeps the item live; a terminal phase pairs
// with a terminal outcome. NO `approve` edge — a gate-approved finish IS a `finish` → done; the
// approval lives in the gate row + audit + LifecycleNote, never in the outcome.
interface EdgeSpec {
  from: Phase[]
  to: Phase
  outcome: Outcome
}

const EDGES: Record<Edge, EdgeSpec> = {
  start: { from: ['queued'], to: 'active', outcome: 'running' },
  gate: { from: ['active'], to: 'awaiting_human', outcome: 'running' },
  resume: { from: ['awaiting_human'], to: 'active', outcome: 'running' },
  finish: { from: ['active'], to: 'terminal', outcome: 'done' },
  fail: { from: ['active', 'awaiting_human'], to: 'terminal', outcome: 'error' },
  cancel: {
    from: ['queued', 'active', 'awaiting_human', 'awaiting_agent'],
    to: 'terminal',
    outcome: 'stopped',
  },
  reject: { from: ['awaiting_human'], to: 'terminal', outcome: 'rejected' },
  // supersede: retire a prior FINISHED scan root into the preserved Done bucket on a re-START.
  supersede: { from: ['terminal'], to: 'terminal', outcome: 'superseded' },
  // reset: a human cleared the board — retire a terminal item so it leaves the live column.
  reset: { from: ['terminal'], to: 'terminal', outcome: 'reset' },
  // reopen: a finished parent gained a fresh active child (finish-vs-dispatch race). Legal ONLY
  // from a clean done (outcome must be 'done') — a stopped/rejected/error item never reopens.
  reopen: { from: ['terminal'], to: 'active', outcome: 'running' },
  // acknowledge: a human dismissed an errored run ("OK / Got it"). Moves the outcome OFF error
  // to `dismissed` so the run leaves the live UI (symmetric with approve→done / reject→rejected).
  // Legal ONLY from terminal/error (guarded below, like reopen's done-only guard).
  acknowledge: { from: ['terminal'], to: 'terminal', outcome: 'dismissed' },
  // ask: the active agent suspends waiting for a peer agent to respond.
  ask: { from: ['active'], to: 'awaiting_agent', outcome: 'running' },
  // answered: the peer responded; the suspended agent resumes.
  answered: { from: ['awaiting_agent'], to: 'active', outcome: 'running' },
}

export interface TransitionOpts {
  error?: string
}

// The ONE edge-writer. Runs on any executor (db or an open tx) so settle() can enlist it in its own
// transaction. Throws IllegalTransition on an illegal edge → the surrounding tx rolls back.
export async function applyEdge(
  executor: Db | Tx,
  id: string,
  edge: Edge,
  opts: TransitionOpts = {}
): Promise<void> {
  const [row] = await executor.select().from(workItems).where(eq(workItems.id, id)).for('update')
  if (!row) throw new IllegalTransition(`work item ${id} not found`)

  const spec = EDGES[edge]
  if (!spec.from.includes(row.phase)) {
    throw new IllegalTransition(`cannot "${edge}" from "${row.phase}" (work item ${id})`)
  }
  // reopen only lifts a CLEAN done (not a human-terminal outcome) — a stopped/rejected/error
  // tree must stay frozen (Option A).
  if (edge === 'reopen' && row.outcome !== 'done') {
    throw new IllegalTransition(`cannot "reopen" a "${row.outcome}" item (work item ${id})`)
  }
  // acknowledge is only valid from terminal/error — a done/stopped/rejected/superseded/reset item
  // never acknowledges (it has no error to dismiss).
  if (edge === 'acknowledge' && row.outcome !== 'error') {
    throw new IllegalTransition(`cannot "acknowledge" a "${row.outcome}" item (work item ${id})`)
  }

  await executor
    .update(workItems)
    .set({
      phase: spec.to,
      outcome: spec.outcome,
      updatedAt: new Date(),
      ...(edge === 'fail' && opts.error ? { error: opts.error } : {}),
    })
    .where(eq(workItems.id, id))
}

// Standalone transition: applyEdge in its OWN transaction (the row lock serializes concurrent
// callers). settle() does NOT call this — it calls applyEdge inside its own tx for atomicity.
export async function transition(
  db: Db,
  id: string,
  edge: Edge,
  opts: TransitionOpts = {}
): Promise<void> {
  await db.transaction(async (tx) => {
    await applyEdge(tx, id, edge, opts)
  })
}
