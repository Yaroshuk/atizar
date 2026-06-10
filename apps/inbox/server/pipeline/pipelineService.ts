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

  return {
    async dispatch(req: DispatchRequest): Promise<DispatchResult> {
      const runtime = deps.resolveAgent(req.agentId)
      const maxInstances = runtime?.maxInstances ?? 1
      return dispatchChokepoint(db, pool, { ...req, maxInstances })
    },

    // Dev-grade resolve (step 3): resolve the gate + resume. Step 4 replaces this with the
    // gate-keyed route that checks formRev, writes the ledger, and executes the effect.
    async resolveGate(
      id: string,
      resolution: GateResolution
    ): Promise<{ ok: true } | { ok: false; error: string }> {
      const gate = await store.getOpenGate(id)
      if (!gate) return { ok: false, error: 'no open gate' }
      void observer.resume(id, resolution).catch((e) => console.error('[pipeline] resume', id, e))
      return { ok: true }
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
  }
}

export type PipelineService = ReturnType<typeof makePipelineService>
