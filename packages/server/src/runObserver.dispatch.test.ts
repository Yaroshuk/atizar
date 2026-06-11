import { randomUUID } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import { type Provider } from '@platform/core'
import { db } from './db/client.js'
import { makeStateStore } from './stateStore.js'
import { makeRunObserver } from './runObserver.js'
import type { WorkerPool } from './workerPool.js'

const store = makeStateStore(db)
const reachable = await db
  .execute(sql`select 1`)
  .then(() => true)
  .catch(() => false)

const ev = (e: Record<string, unknown>): BaseEvent => e as unknown as BaseEvent

// A fake provider that emits a single dispatch tool call (e.g. `route_emails`).
function fakeDispatchProvider(toolName: string, args: Record<string, unknown>): Provider {
  return {
    async *run(_input: RunAgentInput) {
      yield ev({ type: EventType.TOOL_CALL_START, toolCallId: 'tc_d', toolCallName: toolName })
      yield ev({
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: 'tc_d',
        delta: JSON.stringify(args),
      })
      yield ev({ type: EventType.TOOL_CALL_END, toolCallId: 'tc_d' })
      yield ev({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm1', delta: 'dispatched' })
    },
  }
}

function fakePool() {
  const release = vi.fn<(agentId: string) => void>()
  const pool: WorkerPool = {
    enqueue: vi.fn(),
    dequeue: vi.fn(),
    release,
    resumeAcquire: vi.fn(),
    activeCount: () => 0,
    queuedCount: () => 0,
  }
  return { pool, release }
}

describe.skipIf(!reachable)('RunObserver dispatch (real Postgres, fake provider)', () => {
  it('dispatches a child when the sorter calls a dispatch tool with a valid target', async () => {
    const id = randomUUID()
    await store.insertWorkItem({
      id,
      workflowId: 'wf',
      agentId: 'wf__sorter',
      origin: 'human',
      payload: {},
    })

    const delivered: Parameters<Parameters<typeof makeRunObserver>[0]['deliver']>[0][] = []

    const { pool } = fakePool()
    const observer = makeRunObserver({
      db,
      store,
      pool,
      bus: { publish: vi.fn(), subscribe: () => () => {} },
      resolveAgent: () => ({
        provider: fakeDispatchProvider('route_emails', {
          to: 'reply',
          emails: [{ messageId: 'm1' }],
        }),
        renderToolNames: [],
        maxInstances: 1,
        effects: {},
        dispatchToolNames: ['route_emails'],
        handoffs: ['reply'],
      }),
      deliver: async (req) => {
        delivered.push(req)
        return { ok: true, id: 'child-id', deduped: false }
      },
    })

    await observer.run(id)

    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toMatchObject({
      origin: 'wf',
      dest: { kind: 'agent', agentId: 'reply' },
      parentId: id,
    })
    expect(delivered[0].payload).toMatchObject({ emails: [{ messageId: 'm1' }] })
    expect(delivered[0].payload).not.toHaveProperty('to')
  })

  it('records a trace warning and does not deliver when the dispatch target is not in handoffs', async () => {
    const id = randomUUID()
    await store.insertWorkItem({
      id,
      workflowId: 'wf',
      agentId: 'wf__sorter',
      origin: 'human',
      payload: {},
    })

    const delivered: unknown[] = []

    const busMsgs: unknown[] = []
    const { pool } = fakePool()
    const observer = makeRunObserver({
      db,
      store,
      pool,
      bus: {
        publish: (_topic, msg) => {
          busMsgs.push(msg)
        },
        subscribe: () => () => {},
      },
      resolveAgent: () => ({
        provider: fakeDispatchProvider('route_emails', {
          to: 'nope',
          emails: [{ messageId: 'm2' }],
        }),
        renderToolNames: [],
        maxInstances: 1,
        effects: {},
        dispatchToolNames: ['route_emails'],
        handoffs: ['reply'],
      }),
      deliver: async (req) => {
        delivered.push(req)
        return { ok: true, id: 'x', deduped: false }
      },
    })

    await observer.run(id)

    expect(delivered).toHaveLength(0)

    // A synthetic warning event should have been appended to the trace and published on the bus.
    const trace = await store.getTrace(id, 0)
    const warnEvent = trace.find(
      (r) =>
        (r.event as Record<string, unknown>).name === 'dispatch_rejected' ||
        (r.event as Record<string, unknown>).type === 'CUSTOM'
    )
    expect(warnEvent).toBeDefined()

    // The bus should also carry the warning.
    const busWarn = busMsgs.find((m) => {
      const msg = m as Record<string, unknown>
      const e = msg.event as Record<string, unknown> | undefined
      return e?.name === 'dispatch_rejected' || e?.type === 'CUSTOM'
    })
    expect(busWarn).toBeDefined()
  })
})
