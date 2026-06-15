import type { BaseEvent } from '@ag-ui/client'
import {
  resolveDelivery,
  deliveryKey,
  instanceId,
  type Destination,
  type GateResolution,
  type WorkflowDescriptor,
  type HealthCheck,
} from '@atizar/core'
import type { Db } from './db/client.js'
import { makeStateStore, type StateStore } from './stateStore.js'
import { makeEventBus } from './eventBus.js'
import { makeWorkerPool } from './workerPool.js'
import { makeRunObserver, type AgentRuntime, type RunObserver } from './runObserver.js'
import {
  dispatch as dispatchChokepoint,
  type DispatchInput,
  type DispatchResult,
} from './dispatch.js'
import { transition, IllegalTransition, ACTIVE } from './transition.js'
import type { Gate, WorkItem, WorkItemStatus } from './db/schema.js'
import { makeActivityLog, type ActivityEntry } from './activity.js'

// Wires StateStore + EventBus + WorkerPool + RunObserver into one façade the routes call.
// The provider lookup is injected (the same buildProvider the spike used), so the service
// has no knowledge of CopilotKit or the registry.

const DONE: ReadonlySet<WorkItemStatus> = new Set(['finished', 'error', 'closed'])

export type DispatchRequest = Omit<DispatchInput, 'maxInstances'>

export interface TraceSnapshot {
  id: string
  status: WorkItemStatus
  done: boolean
  nextSeq: number
  events: { seq: number; event: BaseEvent }[]
}

export interface PipelineServiceDeps {
  db: Db
  resolveAgent: (agentId: string) => AgentRuntime | undefined
  // Workflow descriptors — the server resolves a handoff Destination against these
  // (resolveDelivery) when a card emits a delivery.
  descriptors: WorkflowDescriptor[]
  // F3 credential-health surface: sync cache read for board snapshots, async re-compute for
  // the health endpoint and boot sweep. Both are optional so tests that don't need health
  // can omit them without any wiring overhead.
  getAgentHealth?: () => Record<string, HealthCheck>
  refreshHealth?: () => Promise<Record<string, HealthCheck>>
}

export function makePipelineService(deps: PipelineServiceDeps) {
  const { db } = deps
  const store = makeStateStore(db)
  const bus = makeEventBus()
  const activity = makeActivityLog({ bus })

  // deliverImpl is extracted so it can be shared between:
  //   (a) the RunObserver (machine dispatch — F2), and
  //   (b) the public `deliver` method (human-gated handoff from a rendered card).
  // Behavior is identical to the original inline implementation.
  // NOTE: async function declaration — hoisted, but only ever called after construction
  // completes (via the RunObserver and the public `deliver` method), so the forward
  // references to `pool` and `publishBoard` are safe.
  async function deliverImpl(req: {
    origin: string
    dest: Destination
    payload: Record<string, unknown>
    parentId: string
  }): Promise<{ ok: true; id: string; deduped: boolean } | { ok: false; error: string }> {
    const r = resolveDelivery(deps.descriptors, req.origin, req.dest, req.payload)
    if (!r.ok) return { ok: false, error: r.error }
    const [workflowId] = r.instanceId.split('__')
    const runtime = deps.resolveAgent(r.instanceId)
    const maxInstances = runtime?.maxInstances ?? 1
    const result = await dispatchChokepoint(db, pool, {
      workflowId: workflowId ?? r.instanceId,
      agentId: r.instanceId,
      origin: 'agent',
      payload: req.payload,
      source: deliveryKey(req.payload) ?? null,
      parentId: req.parentId,
      maxInstances,
    })
    activity.record({
      ts: Date.now(),
      workflowId: workflowId ?? r.instanceId,
      agentId: r.instanceId,
      workItemId: result.id,
      kind: 'delivered',
      summary: `→ ${r.instanceId}`,
    })
    publishBoard()
    return { ok: true, ...result }
  }

  // run() is the RunObserver — wired after the pool via a late binding (the pool only
  // invokes it asynchronously, well after construction).
  // eslint-disable-next-line prefer-const -- circular: pool.run closes over observer, set below
  let observer: RunObserver
  const pool = makeWorkerPool({
    run: (id) => {
      void observer.run(id).catch((e) => console.error('[pipeline] run failed', id, e))
    },
  })
  observer = makeRunObserver({
    db,
    store,
    pool,
    bus,
    resolveAgent: deps.resolveAgent,
    deliver: deliverImpl,
    activity,
  })

  // Coarse board cursor (Last-Event-ID); reconnect = snapshot refetch (spec §1.6).
  let boardSeq = 0
  bus.subscribe('board', () => {
    boardSeq++
  })

  const publishBoard = (): void => bus.publish('board', { kind: 'refresh' })

  // Stop a work item + cascade to active descendants. Parent first (it leaves `running`,
  // so a child's terminal edge can't auto-finish it), then descendants ascending-id.
  async function cancelItem(workItemId: string): Promise<void> {
    const wi = await store.getWorkItem(workItemId)
    if (!wi) return
    if (!ACTIVE.includes(wi.status)) return // already terminal — nothing to cancel
    if (wi.status === 'queued') pool.dequeue(workItemId, wi.agentId)
    if (wi.status === 'running') observer.cancel(workItemId)
    const open = await store.getOpenGate(workItemId)
    if (open) await store.resolveGateRow(open.id, { comment: 'cancelled' })
    await transition(db, workItemId, 'cancel').catch(() => {})
    // No pool.release here: a queued item never held a slot (dequeue is enough); a running
    // item's slot is released by its own consume loop when iterator.return() ends the stream;
    // an awaiting_approval item's slot was already released at the gate. Releasing here would
    // double-free → over-admit queued work past the cap.
    activity.record({
      ts: Date.now(),
      workflowId: wi.workflowId,
      agentId: wi.agentId,
      workItemId,
      kind: 'cancelled',
      summary: 'cancelled',
    })
    const children = await store.getActiveChildren(workItemId)
    for (const child of children.sort((a, b) => a.id.localeCompare(b.id))) {
      await cancelItem(child.id)
    }
    publishBoard()
  }

  async function cancelWorkflowImpl(workflowId: string): Promise<void> {
    const active = await store.getActiveByWorkflow(workflowId)
    for (const item of active.sort((a, b) => a.id.localeCompare(b.id))) {
      await cancelItem(item.id)
    }
  }

  // Board RESET (Unit 4.4, I8/I12): retire every TERMINAL item (finished/result/error) of the
  // scope into the preserved Done bucket (status 'closed', resolution 'reset') via transition()
  // — every status change still goes through the one guarded edge; no row is deleted (hidden,
  // reachable in Activity/history). ACTIVE / awaiting-approval items are NOT touched here: they
  // require an explicit human confirm + cancel first (the route returns their count so the client
  // can confirm), so open work is never silently lost. Returns how many were reset and how many
  // active items were left untouched.
  async function resetImpl(workflowId?: string): Promise<{ reset: number; active: number }> {
    const resettable = await store.getResettable(workflowId)
    let reset = 0
    for (const item of resettable.sort((a, b) => a.id.localeCompare(b.id))) {
      try {
        await transition(db, item.id, 'reset')
      } catch (e) {
        // Tolerate a lost race (a concurrent edge moved the item out of a resettable status
        // between the read and here). Re-throw a genuine DB error.
        if (e instanceof IllegalTransition) continue
        throw e
      }
      reset++
      activity.record({
        ts: Date.now(),
        workflowId: item.workflowId,
        agentId: item.agentId,
        workItemId: item.id,
        kind: 'reset',
        summary: 'cleared from board',
      })
    }
    const activeItems = workflowId
      ? await store.getActiveByWorkflow(workflowId)
      : (await store.getBoardSnapshot()).items.filter((i) => ACTIVE.includes(i.status))
    if (reset > 0) publishBoard()
    return { reset, active: activeItems.length }
  }

  // True when `agentId` (= wf__agent) is the runtime key of a role:'input' agent in some loaded
  // descriptor. The set of input runtime keys is derived once from deps.descriptors; refresh
  // applies ONLY to input roots (a worker re-START is an ordinary new dispatch, never a refresh).
  const inputAgentKeys = new Set<string>(
    deps.descriptors.flatMap((wf) =>
      wf.agents.filter((a) => a.role === 'input').map((a) => instanceId(wf.id, a.agent.id))
    )
  )
  const isInputAgent = (agentId: string): boolean => inputAgentKeys.has(agentId)

  // Workflows that opt into clear-on-START (resetOnStart, config-as-data I7) — derived once.
  const resetOnStartWorkflows = new Set<string>(
    deps.descriptors.filter((wf) => wf.resetOnStart).map((wf) => wf.id)
  )

  // 'refresh' re-run (WS1, I1/I8/I12): on a human START of an input agent, retire each prior
  // FINISHED root of the same workflow × input-agent into the preserved Done bucket (status
  // 'closed', resolution 'superseded') via transition() — children are NOT touched (durable).
  // BRANCH POINT for rerun:'history' (reserved, NOT wired in the beta): when a workflow declares
  // rerun:'history', skip this supersede entirely — every finished scan stays current and the
  // human chooses. Look up the descriptor's `rerun` here and early-return before superseding.
  async function supersedePriorRoots(workflowId: string, agentId: string): Promise<void> {
    const roots = await store.getFinishedInputRoots(workflowId, agentId)
    for (const root of roots) {
      try {
        await transition(db, root.id, 'supersede')
      } catch (e) {
        // Tolerate a lost race: a concurrent finish/cancel could move the root out of
        // 'finished' between the read above and here (IllegalTransition) — skip it. Re-throw
        // anything else (e.g. a real DB error) rather than silently leaving two current roots.
        if (e instanceof IllegalTransition) continue
        throw e
      }
      activity.record({
        ts: Date.now(),
        workflowId: root.workflowId,
        agentId: root.agentId,
        workItemId: root.id,
        kind: 'superseded',
        summary: 'superseded by re-run',
      })
    }
  }

  return {
    async dispatch(req: DispatchRequest): Promise<DispatchResult> {
      const runtime = deps.resolveAgent(req.agentId)
      const maxInstances = runtime?.maxInstances ?? 1
      // F6: a second human START of a singleton agent (maxInstances=1) is rejected (not queued).
      // Applies only to singletons — agents with maxInstances > 1 continue to queue overflow.
      // Machine dispatch (origin 'agent') is unaffected — the chokepoint handles its own cap/queue.
      if (req.origin === 'human' && maxInstances === 1 && pool.activeCount(req.agentId) >= 1) {
        return { id: '', deduped: false, rejected: 'already_running' }
      }
      // WS1 'refresh': a human START of an input agent supersedes its prior finished root(s)
      // BEFORE minting the new one — I1 (the START always does something visible: a fresh root
      // appears AND the prior moves to history). Concurrency is unchanged: the 409 guard above
      // already short-circuited a concurrent START, so we only ever reach here for a sequential
      // re-run (prior root already finished, slot free).
      if (req.origin === 'human' && isInputAgent(req.agentId)) {
        await supersedePriorRoots(req.workflowId, req.agentId)
        // resetOnStart (I7): clear this workflow's terminal items so the board starts clean for
        // the new scan. Only TERMINAL items move (transition('reset')); active/awaiting work is
        // left untouched, and rows are hidden, never deleted (I12). Runs after the supersede so a
        // just-superseded prior root ('closed') is excluded by resetImpl's RESETTABLE filter.
        if (resetOnStartWorkflows.has(req.workflowId)) await resetImpl(req.workflowId)
      }
      const result = await dispatchChokepoint(db, pool, { ...req, maxInstances })
      activity.record({
        ts: Date.now(),
        workflowId: req.workflowId,
        agentId: req.agentId,
        workItemId: result.id,
        kind: 'queued',
        summary: req.origin === 'human' ? `START ${req.agentId}` : `dispatched ${req.agentId}`,
      })
      publishBoard() // a newly-queued item should appear on the board even before its run starts
      return result
    },

    // A human-gated handoff from a rendered card: resolve the Destination server-side
    // (same validation the client used) and dispatch a CHILD work item (parentId = the
    // card's work item). Dedup-by-source is the chokepoint's job — a repeated click on
    // the same source returns { deduped: true }, no second child.
    // NOTE: delegates to deliverImpl (shared with the RunObserver's machine-dispatch path).
    deliver: deliverImpl,

    async resolveGate(
      gateId: string,
      resolution: GateResolution & { formRev: number; actor?: string | null }
    ): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
      const gate = await store.getGate(gateId)

      // Idempotent approved path: if the gate was already resolved, check the ledger.
      // A second approve call after the first succeeded should return ok (not 404).
      if (!gate) return { ok: false, status: 404, error: 'no open gate' }
      if (gate.status !== 'open') {
        if (resolution.decision === 'approved') {
          const wi = await store.getWorkItem(gate.workItemId)
          if (!wi) return { ok: false, status: 404, error: 'work item gone' }
          const key = `${wi.id}:${gate.id}`
          const claim = await store.claimLedger({ key, workItemId: wi.id, gateId: gate.id })
          if (claim.alreadyClaimed) return { ok: true }
        }
        return { ok: false, status: 404, error: 'no open gate' }
      }

      const wi = await store.getWorkItem(gate.workItemId)
      if (!wi) return { ok: false, status: 404, error: 'work item gone' }

      if (resolution.decision === 'rejected') {
        await store.resolveGateRow(gate.id, { comment: resolution.comment })
        await transition(db, wi.id, 'reject') // sets resolution='rejected', status → finished
        activity.record({
          ts: Date.now(),
          workflowId: wi.workflowId,
          agentId: wi.agentId,
          workItemId: wi.id,
          kind: 'resolved',
          summary: 'rejected',
        })
        await store.appendAudit({
          workItemId: wi.id,
          gateId: gate.id,
          workflowId: wi.workflowId,
          agentId: wi.agentId,
          kind: 'resolved',
          summary: 'rejected',
          actor: resolution.actor ?? null,
        })
        publishBoard()
        return { ok: true }
      }

      // approved
      if (gate.formRev !== resolution.formRev) {
        return { ok: false, status: 409, error: 'formRev mismatch — re-render the gate' }
      }
      const form = resolution.form ?? (gate.form as Record<string, unknown>)
      const key = `${wi.id}:${gate.id}`
      const claim = await store.claimLedger({ key, workItemId: wi.id, gateId: gate.id })

      let executedResult: Record<string, unknown>
      if (claim.alreadyClaimed) {
        executedResult = claim.result ?? {}
      } else {
        const runtime = deps.resolveAgent(wi.agentId)
        const effect = runtime?.effects?.[gate.toolName]
        if (!effect)
          return { ok: false, status: 500, error: `no effect bound for "${gate.toolName}"` }
        // Stamp the approved form on the gate row (audit). observer.resume() will find no open
        // gate (already resolved) and skip its own resolveGateRow call — clean handoff.
        await store.resolveGateRow(gate.id, { form })
        executedResult = await effect(form, { workItemId: wi.id, gateId: gate.id })
        await store.setLedgerResult(key, executedResult)
      }

      if (executedResult.error) {
        const msg = String(executedResult.error)
        activity.record({
          ts: Date.now(),
          workflowId: wi.workflowId,
          agentId: wi.agentId,
          workItemId: wi.id,
          kind: 'error',
          summary: msg.slice(0, 80),
        })
        await store.appendAudit({
          workItemId: wi.id,
          gateId: gate.id,
          workflowId: wi.workflowId,
          agentId: wi.agentId,
          kind: 'error',
          summary: msg.slice(0, 80),
          actor: resolution.actor ?? null,
        })
        await transition(db, wi.id, 'fail', { error: msg }).catch(() => {})
        await store.setError(wi.id, msg)
        publishBoard()
        return { ok: false, status: 502, error: msg }
      }

      activity.record({
        ts: Date.now(),
        workflowId: wi.workflowId,
        agentId: wi.agentId,
        workItemId: wi.id,
        kind: 'resolved',
        summary: `approved ${gate.toolName}`,
      })
      await store.appendAudit({
        workItemId: wi.id,
        gateId: gate.id,
        workflowId: wi.workflowId,
        agentId: wi.agentId,
        kind: 'resolved',
        summary: `approved ${gate.toolName}`,
        actor: resolution.actor ?? null,
      })

      if (!claim.alreadyClaimed) {
        activity.record({
          ts: Date.now(),
          workflowId: wi.workflowId,
          agentId: wi.agentId,
          workItemId: wi.id,
          kind: 'effect',
          summary: `executed ${gate.toolName}`,
        })
        await store.appendAudit({
          workItemId: wi.id,
          gateId: gate.id,
          workflowId: wi.workflowId,
          agentId: wi.agentId,
          kind: 'effect',
          summary: `executed ${gate.toolName}`,
          actor: resolution.actor ?? null,
        })
      }

      publishBoard()
      // observer.resume() handles transition(resume) + pool.resumeAcquire + the run stream.
      void observer
        .resume(wi.id, { ...resolution, gateId: gate.id, form, executedResult })
        .catch((e) => console.error('[pipeline] resume(approve)', wi.id, e))
      return { ok: true }
    },

    async getOpenGate(workItemId: string): Promise<Gate | undefined> {
      return store.getOpenGate(workItemId)
    },

    async cancel(workItemId: string): Promise<void> {
      await cancelItem(workItemId)
    },

    async cancelWorkflow(workflowId: string): Promise<void> {
      await cancelWorkflowImpl(workflowId)
    },

    // Stop every active work item across ALL workflows. Reuses the tested cascade by
    // looping cancelWorkflowImpl over the distinct workflowIds present in the board snapshot.
    async cancelAll(): Promise<void> {
      const snap = await store.getBoardSnapshot()
      const activeWorkflowIds = [
        ...new Set(snap.items.filter((i) => ACTIVE.includes(i.status)).map((i) => i.workflowId)),
      ]
      for (const workflowId of activeWorkflowIds) await cancelWorkflowImpl(workflowId)
    },

    // Clear a workflow's TERMINAL items from the live board (hidden, not deleted — I12). Active /
    // awaiting items are left untouched; the returned `active` count lets the client confirm +
    // cancel them first.
    async resetWorkflow(workflowId: string): Promise<{ reset: number; active: number }> {
      return resetImpl(workflowId)
    },

    // Clear TERMINAL items across ALL workflows ("reset all"). Same contract as resetWorkflow.
    async resetAll(): Promise<{ reset: number; active: number }> {
      return resetImpl()
    },

    async getStatus(id: string): Promise<{ status: WorkItemStatus; done: boolean } | undefined> {
      const wi = await store.getWorkItem(id)
      return wi ? { status: wi.status, done: DONE.has(wi.status) } : undefined
    },

    async getTrace(id: string, from: number): Promise<TraceSnapshot | undefined> {
      const wi = await store.getWorkItem(id)
      if (!wi) return undefined
      const rows = await store.getTrace(id, from)
      return {
        id,
        status: wi.status,
        done: DONE.has(wi.status),
        nextSeq: await store.countTrace(id),
        events: rows.map((r) => ({ seq: r.seq, event: r.event })),
      }
    },

    async getBoard(): Promise<{
      items: WorkItem[]
      gates: Gate[]
      lastEventId: number
      agentHealth: Record<string, HealthCheck>
    }> {
      const snap = await store.getBoardSnapshot()
      return { ...snap, lastEventId: boardSeq, agentHealth: deps.getAgentHealth?.() ?? {} }
    },

    async refreshHealth(): Promise<Record<string, HealthCheck>> {
      // Empty-object fallback is only the test/unwired path; app always wires deps.refreshHealth.
      return deps.refreshHealth?.() ?? Promise.resolve({})
    },

    subscribeWorkItem(id: string, fn: (msg: unknown) => void): () => void {
      return bus.subscribe(`workitem:${id}`, fn)
    },

    subscribeBoard(fn: (msg: unknown) => void): () => void {
      return bus.subscribe('board', fn)
    },

    stats(agentId: string): { active: number; queued: number } {
      return { active: pool.activeCount(agentId), queued: pool.queuedCount(agentId) }
    },

    knows(agentId: string): boolean {
      return deps.resolveAgent(agentId) !== undefined
    },

    // Re-feed a queued WorkItem to the pool (the startup sweep's recovery path).
    reenqueue(item: { id: string; agentId: string }): void {
      const cap = deps.resolveAgent(item.agentId)?.maxInstances ?? 1
      pool.enqueue(item.id, item.agentId, cap)
    },

    getActivity(): ReturnType<typeof activity.snapshot> {
      return activity.snapshot()
    },

    subscribeActivity(fn: (entry: ActivityEntry) => void): () => void {
      return bus.subscribe('activity', fn as (msg: unknown) => void)
    },

    getAudit(workItemId: string): ReturnType<StateStore['getAuditByWorkItem']> {
      return store.getAuditByWorkItem(workItemId)
    },
  }
}

export type PipelineService = ReturnType<typeof makePipelineService>
