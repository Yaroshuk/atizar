import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { BaseEvent } from '@ag-ui/client'
import type { Destination } from '@atizar/core'
import type { PipelineService } from './pipelineService.js'

// HTTP surface over the PipelineService — the ONLY transport (CopilotKit dropped at step 6).
// Read shapes (trace snapshot + SSE tail) originated in the step-2 spike. The production triggers
// are POST /api/dispatch (human START) + POST /api/deliver (human-gated card handoff); gate-keyed
// resolve + cancel are the step-4 production surface; GET /api/board + /api/board/stream feed the
// server-driven board.

const TERMINAL = new Set(['terminal'])

// Messages on the `workitem:<id>` topic are either a trace event or a status change.
type WorkItemMsg = { seq: number; event: BaseEvent } | { kind: 'status'; status: string }
const isStatusMsg = (m: WorkItemMsg): m is { kind: 'status'; status: string } => 'kind' in m

export function createPipelineRoutes(service: PipelineService): Hono {
  const app = new Hono()

  // DISPATCH — the human-initiated START gesture (an input agent card's START button). The
  // agent key is `wf__agent`; the workflow id is its prefix. An empty payload runs an input
  // agent (it reads the inbox itself); a payload is accepted for parity with delivery seeding.
  app.post('/api/dispatch', async (c) => {
    const { agent, payload } = await c.req.json<{
      agent: string
      payload?: Record<string, unknown>
    }>()
    if (!service.knows(agent)) return c.json({ error: `unknown agent: ${agent}` }, 404)
    const [workflowId] = agent.split('__')
    const result = await service.dispatch({
      workflowId: workflowId ?? agent,
      agentId: agent,
      origin: 'human',
      payload: payload ?? {},
    })
    return c.json({ id: result.id })
  })

  // DELIVER — a human-gated handoff from a rendered card (VerdictCard "Draft reply", TriageCard
  // route buttons). Resolves the Destination server-side and dispatches a CHILD work item
  // (parentId = the card's work item). A repeated click on the same source dedups (the
  // chokepoint returns { deduped: true }); a bad contract/payload → 400.
  app.post('/api/deliver', async (c) => {
    const body = await c.req.json<{
      origin: string
      dest: Destination
      payload: Record<string, unknown>
      parentId: string
    }>()
    const r = await service.deliver(body)
    return r.ok ? c.json({ id: r.id, deduped: r.deduped }) : c.json({ error: r.error }, 400)
  })

  // JSON history snapshot from `?from=seq`.
  app.get('/api/workitems/:id/trace', async (c) => {
    const from = Number(c.req.query('from') ?? 0)
    const snap = await service.getTrace(c.req.param('id'), from)
    if (!snap) return c.json({ error: 'not found' }, 404)
    return c.json(snap)
  })

  // SSE tail. Subscribe BEFORE flushing the backlog so no event slips through the gap; the
  // client dedupes/orders by `seq` (the SSE `id`). Close only AFTER the terminal status
  // write flushes — stream writes are FIFO, so awaiting it also flushes prior events (the
  // step-2 lesson: closing synchronously strands the UI on `running`).
  app.get('/api/workitems/:id/stream', async (c) => {
    const id = c.req.param('id')
    const head = await service.getTrace(id, 0)
    if (!head) return c.json({ error: 'not found' }, 404)

    const lastId = c.req.header('Last-Event-ID')
    const from =
      lastId !== undefined && lastId !== '' ? Number(lastId) + 1 : Number(c.req.query('from') ?? 0)

    return streamSSE(c, async (stream) => {
      await new Promise<void>((resolve) => {
        let closed = false
        let unsub = () => {}
        const cleanup = () => {
          if (closed) return
          closed = true
          unsub()
          resolve()
        }

        // The backlog replay (below) and a live terminal-status close can interleave: a terminal
        // status arriving BEFORE the backlog has flushed would close the stream and drop the tail
        // events (e.g. the final render tool call), which is invisible server-side but leaves the
        // client's thread incomplete. So gate every terminal close on the backlog being fully
        // written. `backlogFlushed` resolves once the trailing backlog status write resolves;
        // stream writes are FIFO, so that also flushes every backlog event queued before it.
        let resolveBacklog = (): void => {}
        const backlogFlushed = new Promise<void>((r) => {
          resolveBacklog = r
        })
        const closeAfterBacklog = (): void => void backlogFlushed.then(cleanup)

        const onMsg = (raw: unknown) => {
          const msg = raw as WorkItemMsg
          if (isStatusMsg(msg)) {
            const written = stream.writeSSE({ event: 'status', data: msg.status }).catch(() => {})
            if (TERMINAL.has(msg.status)) void written.then(closeAfterBacklog)
            return
          }
          if (msg.seq < from) return
          void stream
            .writeSSE({ id: String(msg.seq), data: JSON.stringify(msg.event) })
            .catch(() => {})
        }

        unsub = service.subscribeWorkItem(id, onMsg)
        stream.onAbort(cleanup)

        // Backlog (after subscribing — dupes are fine, the client orders by seq).
        void (async () => {
          const snap = await service.getTrace(id, from)
          if (!snap) {
            resolveBacklog()
            return cleanup()
          }
          for (const e of snap.events) {
            void stream
              .writeSSE({ id: String(e.seq), data: JSON.stringify(e.event) })
              .catch(() => {})
          }
          const initial = stream.writeSSE({ event: 'status', data: snap.status }).catch(() => {})
          void initial.then(resolveBacklog)
          // Already finished at attach → close only after the backlog flush.
          if (snap.done) void initial.then(cleanup)
        })()
      })
    })
  })

  // RESOLVE a gate (step 4): formRev + ledger + server-executed effect + resume.
  app.post('/api/gates/:id/resolve', async (c) => {
    const gateId = c.req.param('id')
    const body = await c.req.json<{
      formRev: number
      decision: 'approved' | 'rejected'
      form?: Record<string, unknown>
      comment?: string
    }>()
    const authz = c.req.header('Authorization') ?? ''
    const actor = authz.startsWith('Bearer ') ? 'shared-token' : null
    const result = await service.resolveGate(gateId, {
      gateId,
      formRev: body.formRev,
      decision: body.decision,
      form: body.form,
      comment: body.comment,
      actor,
    })
    return result.ok
      ? c.json({ ok: true })
      : c.json({ error: result.error }, result.status as 404 | 409 | 500 | 502)
  })

  // The open gate for a work item (id + form + formRev for the approve/edit UI).
  app.get('/api/workitems/:id/gate', async (c) => {
    const gate = await service.getOpenGate(c.req.param('id'))
    if (!gate) return c.json({ error: 'no open gate' }, 404)
    return c.json({
      id: gate.id,
      toolName: gate.toolName,
      form: gate.form,
      formRev: gate.formRev,
      proposedArtifact: gate.proposedArtifact,
    })
  })

  // The durable, attributed audit for a work item (approval/effect/resolution history).
  app.get('/api/workitems/:id/audit', async (c) => {
    return c.json(await service.getAudit(c.req.param('id')))
  })

  // STOP a work item (and its active descendants).
  app.post('/api/workitems/:id/cancel', async (c) => {
    await service.cancel(c.req.param('id'))
    return c.json({ ok: true })
  })

  // STOP every active work item of a workflow.
  app.post('/api/workflows/:id/cancel', async (c) => {
    await service.cancelWorkflow(c.req.param('id'))
    return c.json({ ok: true })
  })

  // STOP every active work item across ALL workflows ("Stop all").
  app.post('/api/cancel-all', async (c) => {
    await service.cancelAll()
    return c.json({ ok: true })
  })

  // STOP a whole instance — cancel every LIVE Run sharing (workflowId, agentId, key).
  app.post('/api/instances/cancel', async (c) => {
    const { workflowId, agentId, key } = await c.req.json<{
      workflowId: string
      agentId: string
      key: string
    }>()
    if (!workflowId || !agentId || !key) return c.json({ error: 'missing fields' }, 400)
    await service.cancelInstance(workflowId, agentId, key)
    return c.json({ ok: true })
  })

  // RESET a workflow — the wipe primitive: stop every active item, then retire every terminal
  // item from the live board (hidden, not deleted, I12). One server op (U7); returns how many
  // were retired.
  app.post('/api/workflows/:id/reset', async (c) => {
    const { reset } = await service.resetWorkflow(c.req.param('id'))
    return c.json({ ok: true, reset })
  })

  // RESET every workflow ("reset all"). Same wipe contract as the per-workflow reset.
  app.post('/api/reset-all', async (c) => {
    const { reset } = await service.resetAll()
    return c.json({ ok: true, reset })
  })

  // CREDENTIAL HEALTH — explicit on-demand refresh: re-runs every agent's credential/provider
  // checks (claude-cli's probe shells out via execSync). The UI badge reads the CHEAP cached map
  // on the board snapshot (board.agentHealth via GET /api/board), NOT this endpoint — do not wire
  // a polling client here.
  app.get('/api/health', async (c) => {
    return c.json(await service.refreshHealth())
  })

  // BOARD snapshot.
  app.get('/api/board', async (c) => {
    return c.json(await service.getBoard())
  })

  // BOARD SSE — coarse status changes only (resume via snapshot refetch).
  app.get('/api/board/stream', (c) => {
    return streamSSE(c, async (stream) => {
      await new Promise<void>((resolve) => {
        const unsub = service.subscribeBoard((msg) => {
          void stream.writeSSE({ event: 'board', data: JSON.stringify(msg) }).catch(() => {})
        })
        stream.onAbort(() => {
          unsub()
          resolve()
        })
      })
    })
  })

  // ACTIVITY — F4 activity feed.
  app.get('/api/activity', (c) => c.json(service.getActivity()))

  app.get('/api/activity/stream', (c) =>
    streamSSE(c, async (stream) => {
      await new Promise<void>((resolve) => {
        const unsub = service.subscribeActivity((m) => {
          void stream.writeSSE({ event: 'activity', data: JSON.stringify(m) }).catch(() => {})
        })
        stream.onAbort(() => {
          unsub()
          resolve()
        })
      })
    })
  )

  return app
}
