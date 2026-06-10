import type { BaseEvent } from '@ag-ui/client'
import type { GateResolution } from '@platform/core'
import type { Db } from './db/client.js'
import { makeStateStore } from './stateStore.js'
import { makeEventBus } from './eventBus.js'
import { makeWorkerPool } from './workerPool.js'
import { makeRunObserver, type AgentRuntime, type RunObserver } from './runObserver.js'
import {
  dispatch as dispatchChokepoint,
  type DispatchInput,
  type DispatchResult,
} from './dispatch.js'
import { transition, ACTIVE } from './transition.js'
import type { Gate, WorkItem, WorkItemStatus } from './db/schema.js'

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
}

export function makePipelineService(deps: PipelineServiceDeps) {
  const { db } = deps
  const store = makeStateStore(db)
  const bus = makeEventBus()

  // run() is the RunObserver — wired after the pool via a late binding (the pool only
  // invokes it asynchronously, well after construction).
  // eslint-disable-next-line prefer-const -- circular: pool.run closes over observer, set below
  let observer: RunObserver
  const pool = makeWorkerPool({
    run: (id) => {
      void observer.run(id).catch((e) => console.error('[pipeline] run failed', id, e))
    },
  })
  observer = makeRunObserver({ db, store, pool, bus, resolveAgent: deps.resolveAgent })

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
    pool.release(wi.agentId)
    const children = await store.getActiveChildren(workItemId)
    for (const child of children.sort((a, b) => a.id.localeCompare(b.id))) {
      await cancelItem(child.id)
    }
    publishBoard()
  }

  return {
    async dispatch(req: DispatchRequest): Promise<DispatchResult> {
      const runtime = deps.resolveAgent(req.agentId)
      const maxInstances = runtime?.maxInstances ?? 1
      return dispatchChokepoint(db, pool, { ...req, maxInstances })
    },

    async resolveGate(
      gateId: string,
      resolution: GateResolution & { formRev: number }
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
      const active = await store.getActiveByWorkflow(workflowId)
      for (const item of active.sort((a, b) => a.id.localeCompare(b.id))) {
        await cancelItem(item.id)
      }
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

    async getBoard(): Promise<{ items: WorkItem[]; gates: Gate[]; lastEventId: number }> {
      const snap = await store.getBoardSnapshot()
      return { ...snap, lastEventId: boardSeq }
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
  }
}

export type PipelineService = ReturnType<typeof makePipelineService>
