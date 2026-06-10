import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { BaseEvent, RunAgentInput } from '@ag-ui/client'
import {
  readGateOpened,
  type GateOpenedValue,
  type GateResolution,
  type Provider,
  type ResumeHandle,
} from '@platform/core'

// ───────────────────────────────────────────────────────────────────────────
// STEP-2 SPIKE — THROWAWAY. Replaced at step 3 by Postgres-backed Trace + the
// dispatch chokepoint. The READ endpoint shapes (trace snapshot + SSE tail) and
// the per-WorkItem seq cursor are the parts that must survive.
// ───────────────────────────────────────────────────────────────────────────

type RunStatus = 'running' | 'awaiting_approval' | 'done' | 'error'

interface TraceEntry {
  seq: number
  event: BaseEvent
}

interface WorkItemRun {
  id: string
  agentKey: string
  status: RunStatus
  trace: TraceEntry[]
  emitter: EventEmitter
  done: boolean
  gate?: GateOpenedValue
  input: RunAgentInput
}

const runs = new Map<string, WorkItemRun>()

function setStatus(run: WorkItemRun, status: RunStatus): void {
  run.status = status
  run.done = status === 'done' || status === 'error'
  run.emitter.emit('status', status)
}

// Append one event to the trace (seq = current length), publish it, and react to a
// GATE_OPENED signal by flipping the run to awaiting_approval and capturing the gate.
function pushEvent(run: WorkItemRun, event: BaseEvent): void {
  const entry: TraceEntry = { seq: run.trace.length, event }
  run.trace.push(entry)
  run.emitter.emit('event', entry)
  const gate = readGateOpened(event)
  if (gate) {
    run.gate = gate
    setStatus(run, 'awaiting_approval')
  }
}

async function consume(run: WorkItemRun, iterable: AsyncIterable<BaseEvent>): Promise<void> {
  for await (const event of iterable) pushEvent(run, event)
}

// Minimal valid RunAgentInput. In DEV_RECORD_REPLAY mode the prompt is irrelevant —
// the cassette step keys on resolvedApprovalCount (0 here) → replays the agent's step 0.
function minimalInput(): RunAgentInput {
  return {
    threadId: randomUUID(),
    runId: randomUUID(),
    state: {},
    messages: [],
    tools: [],
    context: [],
    forwardedProps: {},
  } as RunAgentInput
}

// `getProvider(agentKey)` returns the SAME wrapped Provider the CopilotKit agents use
// (built via buildProvider in index.ts).
export function createDevRunsRoutes(getProvider: (agentKey: string) => Provider | undefined): Hono {
  const app = new Hono()

  // START a run (dev throwaway — step 3 starts via the dispatch chokepoint).
  app.post('/api/dev/runs', async (c) => {
    const { agent } = await c.req.json<{ agent: string }>()
    const provider = getProvider(agent)
    if (!provider) return c.json({ error: `unknown agent: ${agent}` }, 404)

    const run: WorkItemRun = {
      id: randomUUID(),
      agentKey: agent,
      status: 'running',
      trace: [],
      emitter: new EventEmitter(),
      done: false,
      input: minimalInput(),
    }
    run.emitter.setMaxListeners(0) // many SSE tails may attach
    runs.set(run.id, run)

    // Fire-and-forget so the client can attach mid-run.
    void (async () => {
      try {
        await consume(run, provider.run(run.input))
        if (run.status === 'running') setStatus(run, 'done')
      } catch {
        setStatus(run, 'error')
      }
    })()

    return c.json({ id: run.id })
  })

  // JSON history snapshot from `?from=seq` (durable shape).
  app.get('/api/workitems/:id/trace', (c) => {
    const run = runs.get(c.req.param('id'))
    if (!run) return c.json({ error: 'not found' }, 404)
    const from = Number(c.req.query('from') ?? 0)
    return c.json({
      id: run.id,
      status: run.status,
      done: run.done,
      nextSeq: run.trace.length,
      events: run.trace.slice(from),
    })
  })

  // SSE tail (durable shape). Attaches listeners BEFORE flushing the backlog so no
  // event slips through the gap; the client dedupes/orders by `seq` (the SSE `id`),
  // so duplicate or out-of-order delivery on reconnect is harmless.
  app.get('/api/workitems/:id/stream', (c) => {
    const run = runs.get(c.req.param('id'))
    if (!run) return c.json({ error: 'not found' }, 404)
    const lastId = c.req.header('Last-Event-ID')
    const from =
      lastId !== undefined && lastId !== '' ? Number(lastId) + 1 : Number(c.req.query('from') ?? 0)

    return streamSSE(c, async (stream) => {
      await new Promise<void>((resolve) => {
        const writeEvent = (entry: TraceEntry) => {
          if (entry.seq < from) return
          void stream
            .writeSSE({ id: String(entry.seq), data: JSON.stringify(entry.event) })
            .catch(() => {})
        }
        const onStatus = (status: RunStatus) => {
          void stream.writeSSE({ event: 'status', data: status }).catch(() => {})
          if (status === 'done' || status === 'error') cleanup()
        }
        const cleanup = () => {
          run.emitter.off('event', writeEvent)
          run.emitter.off('status', onStatus)
          resolve()
        }
        run.emitter.on('event', writeEvent)
        run.emitter.on('status', onStatus)
        stream.onAbort(cleanup)

        // Backlog (after attaching — dupes are fine, client orders by seq).
        for (const entry of run.trace) writeEvent(entry)
        void stream.writeSSE({ event: 'status', data: run.status }).catch(() => {})
        if (run.done) cleanup()
      })
    })
  })

  // RESOLVE a gate (dev throwaway — step 4 = gate-keyed /api/gates/:id/resolve with
  // transition() + ledger). Here it only flips the in-memory flag and resumes.
  app.post('/api/dev/workitems/:id/resolve', async (c) => {
    const run = runs.get(c.req.param('id'))
    if (!run) return c.json({ error: 'not found' }, 404)
    if (!run.gate) return c.json({ error: 'no open gate' }, 409)
    const provider = getProvider(run.agentKey)
    if (!provider?.resume) return c.json({ error: 'provider has no resume' }, 400)

    const body = await c.req.json<{
      decision: 'approved' | 'rejected'
      form?: Record<string, unknown>
    }>()
    const handle: ResumeHandle = { runId: run.id, input: run.input }
    const resolution: GateResolution = {
      gateId: run.gate.toolCallId,
      decision: body.decision,
      form: body.form,
    }
    const resume = provider.resume.bind(provider)

    run.gate = undefined // consume the gate so a repeat /resolve can't re-resume it
    setStatus(run, 'running')
    void (async () => {
      try {
        await consume(run, resume(handle, resolution))
        setStatus(run, 'done')
      } catch {
        setStatus(run, 'error')
      }
    })()

    return c.json({ ok: true })
  })

  return app
}
