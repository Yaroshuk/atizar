import { randomUUID } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import { agentQuestion, type Provider } from '@atizar/core'
import { db } from './db/client.js'
import { makeStateStore } from './stateStore.js'
import { makeRunObserver } from './runObserver.js'
import type { WorkerPool } from './workerPool.js'
import { transition } from './transition.js'

const store = makeStateStore(db)
const reachable = await db
  .execute(sql`select 1`)
  .then(() => true)
  .catch(() => false)

const ev = (e: Record<string, unknown>): BaseEvent => e as unknown as BaseEvent

// A fake provider: emits an AGENT_QUESTION signal then returns (mirrors the provider killing itself
// at the ask-tool-call boundary, just as the gate provider kills itself at the approval boundary).
function fakeQuestionProvider(): Provider {
  return {
    async *run(_input: RunAgentInput) {
      yield ev({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm1', delta: 'thinking' })
      yield agentQuestion({
        questions: [
          {
            toolCallId: 't',
            target: { agentId: 'answerer' },
            payload: { q: '?' },
          },
        ],
      })
    },
  }
}

function fakePool() {
  const reconcile = vi.fn<(agentId: string) => void>()
  const pool: WorkerPool = {
    enqueue: vi.fn(),
    dequeue: vi.fn(),
    reconcile,
    activeCount: async () => 0,
    queuedCount: () => 0,
  }
  return { pool, reconcile }
}

describe.skipIf(!reachable)('RunObserver question-detect (real Postgres, fake provider)', () => {
  it('detects AGENT_QUESTION: asker → awaiting_agent, questions row open, deliver called', async () => {
    const agentId = `ro-q__${randomUUID().slice(0, 8)}`
    const { id } = await store.insertWorkItem({
      id: randomUUID(),
      workflowId: 'ro-q-test',
      agentId,
      origin: 'human',
      payload: {},
      key: agentId,
    })

    const deliverCalls: Parameters<Parameters<typeof makeRunObserver>[0]['deliver']>[0][] = []

    const { pool, reconcile } = fakePool()
    const observer = makeRunObserver({
      db,
      store,
      pool,
      bus: { publish: vi.fn(), subscribe: () => () => {} },
      resolveAgent: () => ({
        provider: fakeQuestionProvider(),
        renderToolNames: [],
        maxInstances: 1,
        effects: {},
        dispatchToolNames: [],
        handoffs: [],
      }),
      deliver: async (req) => {
        deliverCalls.push(req)
        return { ok: true, id: 'answerer-wi-1', deduped: false }
      },
      settle: async (sid, edge, _actor, opts) => {
        await transition(db, sid, edge, opts)
      },
      reconcile,
      resolveQuestionTarget: (target) => {
        // Inline the target (it already carries {agentId}) for this test
        const t = target as { agentId?: string }
        return typeof t.agentId === 'string' ? { agentId: t.agentId } : null
      },
    })

    // Pool owns the queued→active flip before run()
    await transition(db, id, 'start')
    await observer.run(id)

    // (a) Asker is now awaiting_agent
    const wi = await store.getWorkItem(id)
    expect(wi?.phase).toBe('awaiting_agent')

    // (b) Exactly one open questions row for the asker
    const pending = await store.getPendingQuestionsForAsker(id)
    expect(pending).toHaveLength(1)
    expect(pending[0].status).toBe('open')
    expect(pending[0].toolCallId).toBe('t')
    expect(pending[0].payload).toEqual({ q: '?' })

    // (c) deliver was called once with the resolved agent and the question payload
    expect(deliverCalls).toHaveLength(1)
    expect(deliverCalls[0]).toMatchObject({
      dest: { kind: 'agent', agentId: 'answerer' },
      parentId: id,
    })
    // The payload is the raw question payload; buildInput on the answerer's work item will
    // call encodeHandoff on it to produce the seed message at run time.
    expect(deliverCalls[0].payload).toEqual({ q: '?' })

    // reconcile was called (asker is suspended — slot released like the gate path)
    expect(reconcile).toHaveBeenCalledWith(agentId)
  })

  it('deliver failure (deliver rejects) fails the asker terminal/error instead of stranding in awaiting_agent', async () => {
    const agentId = `ro-q-deliver-fail__${randomUUID().slice(0, 8)}`
    const { id } = await store.insertWorkItem({
      id: randomUUID(),
      workflowId: 'ro-q-test',
      agentId,
      origin: 'human',
      payload: {},
      key: agentId,
    })

    const { pool, reconcile } = fakePool()
    const observer = makeRunObserver({
      db,
      store,
      pool,
      bus: { publish: vi.fn(), subscribe: () => () => {} },
      resolveAgent: () => ({
        provider: fakeQuestionProvider(),
        renderToolNames: [],
        maxInstances: 1,
        effects: {},
        dispatchToolNames: [],
        handoffs: [],
      }),
      deliver: async () => {
        throw new Error('deliver failed')
      },
      settle: async (sid, edge, _actor, opts) => {
        await transition(db, sid, edge, opts)
      },
      reconcile,
      resolveQuestionTarget: (target) => {
        const t = target as { agentId?: string }
        return typeof t.agentId === 'string' ? { agentId: t.agentId } : null
      },
    })

    await transition(db, id, 'start')
    await observer.run(id)

    // Asker must NOT be stuck in awaiting_agent — deliver failure must terminate it
    const wi = await store.getWorkItem(id)
    expect(wi?.phase).toBe('terminal')
    expect(wi?.outcome).toBe('error')
  })

  it('routing failure (resolveQuestionTarget returns null) throws and fails the asker loudly', async () => {
    const agentId = `ro-q-fail__${randomUUID().slice(0, 8)}`
    const { id } = await store.insertWorkItem({
      id: randomUUID(),
      workflowId: 'ro-q-test',
      agentId,
      origin: 'human',
      payload: {},
      key: agentId,
    })

    const { pool } = fakePool()
    const observer = makeRunObserver({
      db,
      store,
      pool,
      bus: { publish: vi.fn(), subscribe: () => () => {} },
      resolveAgent: () => ({
        provider: fakeQuestionProvider(),
        renderToolNames: [],
        maxInstances: 1,
        effects: {},
        dispatchToolNames: [],
        handoffs: [],
      }),
      deliver: vi.fn().mockResolvedValue({ ok: true, id: 'x', deduped: false }),
      settle: async (sid, edge, _actor, opts) => {
        await transition(db, sid, edge, opts)
      },
      reconcile: vi.fn(),
      // Returns null → routing failure
      resolveQuestionTarget: () => null,
    })

    await transition(db, id, 'start')
    await observer.run(id)

    // Asker must have ended up in the terminal (failed) phase — loud failure, not a silent drop
    const wi = await store.getWorkItem(id)
    expect(wi?.phase).toBe('terminal')
    expect(wi?.outcome).toBe('error')
  })
})
