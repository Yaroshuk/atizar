import type { BaseEvent } from '@ag-ui/client'
import {
  resolveDelivery,
  deliveryKey,
  instanceId,
  lifecycle,
  hasLiveDescendant,
  type Destination,
  type GateResolution,
  type Phase,
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
import { transition, IllegalTransition } from './transition.js'
import { settle, type TerminalEdge } from './settle.js'
import type { Gate, WorkItem, WorkItemPhase, WorkItemOutcome } from './db/schema.js'
import { makeActivityLog, type ActivityEntry } from './activity.js'

// Wires StateStore + EventBus + WorkerPool + RunObserver into one façade the routes call.
// The provider lookup is injected (the same buildProvider the spike used), so the service
// has no knowledge of CopilotKit or the registry.

// The public dispatch contract: a caller (routes/tests/evals) supplies neither `maxInstances`
// (the service resolves it from the runtime) nor `key` (the service computes it via the app's
// instanceKeyOf at the chokepoint — the ONE place a key originates).
export type DispatchRequest = Omit<DispatchInput, 'maxInstances' | 'key'>

export interface TraceSnapshot {
  id: string
  status: WorkItemPhase
  outcome: WorkItemOutcome
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
  // The app's instance-key policy (spec 2026-06-16). REQUIRED — the framework never invents a key.
  // Same key → same instance. e.g. reply → payload.email.from; spam/sorter → the agent id.
  instanceKeyOf: (agentId: string, payload: Record<string, unknown>) => string
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
      key: deps.instanceKeyOf(r.instanceId, req.payload),
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
    activeCount: (agentId) => store.countActiveByAgent(agentId),
    // The pool OWNS the queued→active flip (U5): commit it before run() so the cap holds against a
    // same-tick burst. run() (the observer) no longer does transition('start').
    activate: (id) => transition(db, id, 'start'),
  })

  // settle() needs db+store+bus+reconcile — bind once and pass to the observer + reuse for the
  // human-driven terminal edges (cancel/reject/supersede/reset).
  const settleDeps = { db, store, bus, reconcile: (agentId: string) => pool.reconcile(agentId) }
  const settleEdge = (
    id: string,
    edge: TerminalEdge,
    actor: string | null,
    opts?: { error?: string; summary?: string }
  ) => settle(settleDeps, id, edge, actor, opts)

  observer = makeRunObserver({
    db,
    store,
    pool,
    bus,
    resolveAgent: deps.resolveAgent,
    deliver: deliverImpl,
    activity,
    settle: (id, edge, actor, opts) => settleEdge(id, edge, actor, opts),
    reconcile: (agentId) => pool.reconcile(agentId),
  })

  // Coarse board cursor (Last-Event-ID); reconnect = snapshot refetch (spec §1.6).
  let boardSeq = 0
  bus.subscribe('board', () => {
    boardSeq++
  })

  const publishBoard = (): void => bus.publish('board', { kind: 'refresh' })

  // Stop a work item + cascade to active descendants. The terminal edge goes through settle()
  // (the one terminal writer). The child cascade runs OUTSIDE the isLive guard — even an
  // already-terminal parent may have a live child mid-cascade; safe because a cancelled
  // (stopped) item COVERS, so a re-scan won't phantom-twin.
  async function cancelItem(workItemId: string, actor: string | null = null): Promise<void> {
    const wi = await store.getWorkItem(workItemId)
    if (!wi) return
    const live = lifecycle(wi.phase, wi.outcome, false, false).isLive
    if (live) {
      if (wi.phase === 'queued') pool.dequeue(workItemId, wi.agentId)
      if (wi.phase === 'active') observer.cancel(workItemId)
      const open = await store.getOpenGate(workItemId)
      if (open) await store.resolveGateRow(open.id, { comment: 'cancelled' })
      await settleEdge(workItemId, 'cancel', actor, { summary: 'cancelled' }).catch(() => {})
      activity.record({
        ts: Date.now(),
        workflowId: wi.workflowId,
        agentId: wi.agentId,
        workItemId,
        kind: 'cancelled',
        summary: 'cancelled',
      })
    }
    const children = await store.getActiveChildren(workItemId)
    for (const child of children.sort((a, b) => a.id.localeCompare(b.id))) {
      await cancelItem(child.id, actor)
    }
    publishBoard()
  }

  async function cancelWorkflowImpl(workflowId: string): Promise<void> {
    const active = await store.getActiveByWorkflow(workflowId)
    for (const item of active.sort((a, b) => a.id.localeCompare(b.id))) {
      await cancelItem(item.id)
    }
  }

  // Stop every LIVE work item across ALL workflows. Reuses the tested cascade by looping
  // cancelWorkflowImpl over the distinct workflowIds with a live item in the board snapshot.
  async function cancelAllImpl(): Promise<void> {
    const snap = await store.getBoardSnapshot()
    const liveWorkflowIds = [
      ...new Set(
        snap.items
          .filter((i) => lifecycle(i.phase, i.outcome, false, false).isLive)
          .map((i) => i.workflowId)
      ),
    ]
    for (const workflowId of liveWorkflowIds) await cancelWorkflowImpl(workflowId)
  }

  // Board RESET (Unit 4.4, I8/I12): retire every TERMINAL item of the scope into the preserved
  // Done bucket (outcome 'reset') via settle() — every status change still goes through the one
  // terminal writer; no row is deleted (hidden, reachable in Activity/history). The `wipe`
  // primitive cancels active items first, so resetImpl only handles already-terminal rows here.
  async function resetImpl(workflowId?: string): Promise<{ reset: number }> {
    const resettable = await store.getResettable(workflowId)
    let reset = 0
    for (const item of resettable.sort((a, b) => a.id.localeCompare(b.id))) {
      try {
        await settleEdge(item.id, 'reset', null, { summary: 'cleared from board' })
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
    if (reset > 0) publishBoard()
    return { reset }
  }

  // The ONE wipe primitive (cancel every active item, then retire every terminal one). Every caller
  // — the reset routes, the public wipe*/reset* methods, and the Start-over re-START path — goes
  // through this, so "cancel + reset" lives in exactly one place (no copy-paste).
  async function wipeWorkflowImpl(workflowId: string): Promise<{ reset: number }> {
    await cancelWorkflowImpl(workflowId)
    return resetImpl(workflowId)
  }

  async function wipeAllImpl(): Promise<{ reset: number }> {
    await cancelAllImpl()
    return resetImpl()
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

  return {
    async dispatch(req: DispatchRequest): Promise<DispatchResult> {
      const runtime = deps.resolveAgent(req.agentId)
      const maxInstances = runtime?.maxInstances ?? 1
      // START = safe re-scan (spec 2026-06-16, instance model). A human re-START of an input agent:
      //  1. if a scan is already LIVE, do NOT start a second — return the live scan (one-open gate).
      //  2. otherwise supersede the prior FINISHED scan ROOT(s) so only the latest scan shows
      //     (reuse-on-closed), then dispatch a fresh scan Run below. Worker children (drafts) are
      //     NEVER touched — they are independent Runs and dedup by source.
      // The view now groups Runs by (agentId, key) into ONE card; an input agent's key is a CONSTANT,
      // so the superseded prior scan Run and the new scan Run share the same key and COLLAPSE into one
      // card. The old "supersede left the prior scan's children visible (a Stopped reader beside the
      // fresh one)" criticism no longer applies under the instance model — that was a per-instance-card
      // artifact, gone now that one card aggregates a key's Runs. So we revert from wipe to
      // supersede-prior-finished-scan + one-live-gate. No wipe, no Start-over confirm. (wipeWorkflowImpl
      // STAYS — it backs the explicit Clear button.)
      if (req.origin === 'human' && isInputAgent(req.agentId)) {
        if (await store.hasLiveInputScan(req.workflowId, req.agentId)) {
          // The gate dedups only a live SCAN itself. `hasLiveInputScan` is Approach-B (also true when
          // a finished root has a live DESCENDANT), but the lookup matches only a self-live root — so
          // a `done` scan whose only live thing is a child draft yields `live === undefined`, falls
          // through, and is superseded + re-scanned. That is intended: the gate blocks two concurrent
          // scans, NOT a re-scan while child drafts run ("done → re-runnable; live → sequential").
          const live = (await store.getActiveByWorkflow(req.workflowId)).find(
            (w) => w.agentId === req.agentId && !w.parentId
          )
          if (live) return { id: live.id, deduped: true }
        }
        const prior = await store.getFinishedInputRoots(req.workflowId, req.agentId)
        if (prior.length) {
          const snap = await store.getBoardSnapshot()
          // The SAME core tree-walk stateStore/board use — one liveness source. Set of ids whose
          // tree still contains a live node.
          const liveAnc = hasLiveDescendant(
            snap.items.map((w) => ({ id: w.id, parentId: w.parentId, phase: w.phase as Phase }))
          )
          for (const root of prior) {
            // KEEP a finished scan that still has live descendants (e.g. reply drafts awaiting
            // approval): superseding it would orphan those children (the board filters superseded
            // roots, so the client's root-collapse can no longer reach them and the drafts vanish).
            // It collapses with the new scan by the input agent's CONSTANT key — one card, children
            // unioned, nothing duplicated. Only a TRULY finished scan (no live descendant — a stale
            // empty done scan) is superseded, which still prevents done-scan pile-up.
            if (liveAnc.has(root.id)) continue
            await settleEdge(root.id, 'supersede', null, {
              summary: 'superseded by re-scan',
            }).catch(() => {})
          }
        }
      }
      const result = await dispatchChokepoint(db, pool, {
        ...req,
        key: deps.instanceKeyOf(req.agentId, req.payload),
        maxInstances,
      })
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
        await settleEdge(wi.id, 'reject', resolution.actor ?? null, { summary: 'rejected' })
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
        await store.setError(wi.id, msg)
        await settleEdge(wi.id, 'fail', resolution.actor ?? null, { error: msg }).catch(() => {})
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
      // observer.resume() handles transition(resume) + reconcile + the run stream.
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

    // Stop a whole instance: cancel every LIVE Run sharing (workflowId, agentId, key). Each
    // cancelItem cascades to that Run's descendants, so stopping ANY spawning instance stops every
    // instance it spawned, transitively. Reuses the ONE cancel primitive (no duplicated cascade).
    // The target set is the snapshot at call time (same pattern as cancelAllImpl); a Run dispatched
    // concurrently AFTER the snapshot may not be caught — acceptable for a deliberate human Stop.
    async cancelInstance(workflowId: string, agentId: string, key: string): Promise<void> {
      const snap = await store.getBoardSnapshot()
      const live = snap.items.filter(
        (w) =>
          w.workflowId === workflowId &&
          w.agentId === agentId &&
          w.key === key &&
          lifecycle(w.phase, w.outcome, false, false).isLive
      )
      for (const w of live.sort((a, b) => a.id.localeCompare(b.id))) await cancelItem(w.id)
    },

    // Stop every active work item across ALL workflows. Public alias for cancelAllImpl.
    async cancelAll(): Promise<void> {
      await cancelAllImpl()
    },

    // Wipe = the full Start-over primitive: stop every active item in scope, then retire every
    // terminal item (hide, not delete — I12). One server op (wipeWorkflowImpl) behind the reset
    // routes (U7/U8) AND the Start-over re-START path — no duplicated cancel+reset.
    async wipeWorkflow(workflowId: string): Promise<{ reset: number }> {
      return wipeWorkflowImpl(workflowId)
    },

    async wipeAll(): Promise<{ reset: number }> {
      return wipeAllImpl()
    },

    // resetWorkflow/resetAll are thin aliases to the wipe primitive (the routes call these; the
    // route contract drops the `active` field — U7d).
    async resetWorkflow(workflowId: string): Promise<{ reset: number }> {
      return wipeWorkflowImpl(workflowId)
    },

    async resetAll(): Promise<{ reset: number }> {
      return wipeAllImpl()
    },

    async getStatus(
      id: string
    ): Promise<{ status: WorkItemPhase; outcome: WorkItemOutcome; done: boolean } | undefined> {
      const wi = await store.getWorkItem(id)
      return wi
        ? { status: wi.phase, outcome: wi.outcome, done: wi.phase === 'terminal' }
        : undefined
    },

    async getTrace(id: string, from: number): Promise<TraceSnapshot | undefined> {
      const wi = await store.getWorkItem(id)
      if (!wi) return undefined
      const rows = await store.getTrace(id, from)
      return {
        id,
        status: wi.phase,
        outcome: wi.outcome,
        done: wi.phase === 'terminal',
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
      // Ship everything that has NOT left the board (superseded/reset are retired → Activity only).
      // Do NOT filter on isVisible here — that is the client's card-rendering decision (U8). The
      // board must keep queued + no-card rows so the client can count queued and walk live
      // ancestors. This PRESERVES today's transport contract (the old 'closed' == the retired set).
      const items = snap.items.filter((w) => w.outcome !== 'superseded' && w.outcome !== 'reset')
      return {
        items,
        gates: snap.gates,
        lastEventId: boardSeq,
        agentHealth: deps.getAgentHealth?.() ?? {},
      }
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

    async stats(agentId: string): Promise<{ active: number; queued: number }> {
      return { active: await pool.activeCount(agentId), queued: pool.queuedCount(agentId) }
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
