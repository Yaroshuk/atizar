import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { BaseEvent } from '@ag-ui/client'
import type { Destination } from '@platform/core'
import type { PipelineService } from './pipelineService.js'

// HTTP surface over the PipelineService — the ONLY transport (CopilotKit dropped at step 6).
// Read shapes (trace snapshot + SSE tail) originated in the step-2 spike. The production triggers
// are POST /api/dispatch (human START) + POST /api/deliver (human-gated card handoff); gate-keyed
// resolve + cancel are the step-4 production surface; GET /api/board + /api/board/stream feed the
// server-driven board.

const TERMINAL = new Set(['finished', 'error', 'closed'])

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
    const { id } = await service.dispatch({
      workflowId: workflowId ?? agent,
      agentId: agent,
      origin: 'human',
      payload: payload ?? {},
    })
    return c.json({ id })
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

        const onMsg = (raw: unknown) => {
          const msg = raw as WorkItemMsg
          if (isStatusMsg(msg)) {
            const written = stream.writeSSE({ event: 'status', data: msg.status }).catch(() => {})
            if (TERMINAL.has(msg.status)) void written.then(cleanup)
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
          if (!snap) return cleanup()
          for (const e of snap.events) {
            void stream
              .writeSSE({ id: String(e.seq), data: JSON.stringify(e.event) })
              .catch(() => {})
          }
          const initial = stream.writeSSE({ event: 'status', data: snap.status }).catch(() => {})
          // Already finished at attach → close only after the status write flushes.
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
    const result = await service.resolveGate(gateId, {
      gateId,
      formRev: body.formRev,
      decision: body.decision,
      form: body.form,
      comment: body.comment,
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

  // CREDENTIAL HEALTH — re-runs all provider + binding checks and returns the per-agent map.
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

  return app
}
