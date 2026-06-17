import { lifecycleNote, type Outcome } from '@atizar/core'
import type { BaseEvent } from '@ag-ui/client'
import type { Db } from './db/client.js'
import type { StateStore } from './stateStore.js'
import type { EventBus } from './eventBus.js'
import { applyEdge } from './transition.js'

// The ONE terminal writer (spec 2026-06-16). Every terminal edge becomes a thin settle() caller so
// they behave identically. ONE transaction holds all three writes — applyEdge (the shared
// edge-writer, NOT a duplicated raw update), the typed LifecycleNote trace event, and the audit
// row — so a rollback (illegal edge) undoes all of them. After commit: publish the note, THEN the
// terminal status (note-before-status kills the SSE backlog race), THEN reconcile the pool.
// (start/gate/resume/reopen are NOT terminal — they stay raw transition() calls.)
//
// No `approve`: a gate-approved finish IS edge 'finish' → done; the approval is recorded by the
// gate's resolved row + the `approved <tool>` audit summary (opts.summary) + this note.
export type TerminalEdge =
  | 'finish'
  | 'fail'
  | 'cancel'
  | 'reject'
  | 'supersede'
  | 'reset'
  | 'acknowledge'

const OUTCOME_OF: Record<TerminalEdge, Outcome> = {
  finish: 'done',
  fail: 'error',
  cancel: 'stopped',
  reject: 'rejected',
  supersede: 'superseded',
  reset: 'reset',
  acknowledge: 'dismissed',
}

const NOTE_KIND = 'lifecycle'

export interface SettleDeps {
  db: Db
  store: StateStore
  bus: EventBus
  // Re-derive the agent's pool occupancy from the DB after a terminal write (U5). A plain
  // callback so settle() stays decoupled from the pool internals.
  reconcile: (agentId: string) => void
}

export interface SettleOpts {
  error?: string
  // The audit summary, e.g. "approved saveDraft". Defaults to the outcome word.
  summary?: string
}

export async function settle(
  deps: SettleDeps,
  id: string,
  edge: TerminalEdge,
  actor: string | null,
  opts: SettleOpts = {}
): Promise<void> {
  const { db, store, bus, reconcile } = deps
  const wi = await store.getWorkItem(id)
  if (!wi) return
  const outcome = OUTCOME_OF[edge]
  const at = Date.now()

  let seq = 0
  let event: BaseEvent | undefined
  // One transaction: the guarded edge write (applyEdge) + the trace note + the audit row, ALL on
  // the tx executor — so an illegal edge throws inside applyEdge and rolls back note+audit too.
  await db.transaction(async (tx) => {
    await applyEdge(tx, id, edge, { error: opts.error }) // throws → whole settle rolls back
    seq = await store.countTrace(id, tx)
    event = lifecycleNote({ kind: NOTE_KIND, outcome, actor, at })
    await store.appendTrace(id, seq, event, true, tx)
    await store.appendAudit(
      {
        workItemId: id,
        gateId: null,
        workflowId: wi.workflowId,
        agentId: wi.agentId,
        kind: NOTE_KIND,
        summary: opts.summary ?? outcome,
        actor,
      },
      tx
    )
  })

  // After commit: publish the note first (a live thread shows it), THEN the terminal status, THEN
  // reconcile. Note-before-status is the SSE-race fix; both are post-commit so subscribers never
  // see an uncommitted note.
  if (event) bus.publish(`workitem:${id}`, { seq, event })
  bus.publish(`workitem:${id}`, { kind: 'status', status: 'terminal' })
  bus.publish('board', { kind: 'status', id, status: 'terminal' })
  reconcile(wi.agentId)
}
