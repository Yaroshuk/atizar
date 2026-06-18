import { randomUUID } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import {
  gateOpened,
  type Provider,
  type ResumeHandle,
  type ResumeOutcome,
  type ResumePayload,
  type AnswerResolution,
} from '@atizar/core'
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

// A fake provider: run() emits a render-tool call + text, then opens a gate, then ends
// (mimicking the claude-cli kill at the approval point). resume() emits two more events.
function fakeProvider(): Provider {
  return {
    async *run(_input: RunAgentInput) {
      yield ev({ type: EventType.TOOL_CALL_START, toolCallId: 'tc1', toolCallName: 'renderLead' })
      yield ev({ type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc1', delta: '{"name":"Acme"}' })
      yield ev({ type: EventType.TOOL_CALL_END, toolCallId: 'tc1' })
      yield ev({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm2', delta: 'drafting' })
      yield gateOpened({
        gateKind: 'approval',
        toolName: 'saveDraft',
        toolCallId: 'toolu_g',
        proposedArtifact: { to: 'a@b.c', body: 'hi' },
      })
    },
    async *resume(_handle: ResumeHandle, _resolution: ResumePayload) {
      yield ev({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm3', delta: 'saved' })
      yield ev({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm3', delta: '!' })
    },
  }
}

// A gate-opening provider with a spy on resume() — for message/null/prompt mode tests.
// run() opens a gate; resume() sets spy.resumed = true and yields one text chunk.
function fakeProviderWithResumeSpy(spy: { resumed: boolean }): Provider {
  return {
    async *run(_input: RunAgentInput) {
      yield gateOpened({
        gateKind: 'approval',
        toolName: 'saveDraft',
        toolCallId: 'toolu_g',
        proposedArtifact: { body: 'hi' },
      })
    },
    async *resume(_handle: ResumeHandle, _resolution: ResumePayload) {
      spy.resumed = true
      yield ev({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm3', delta: 'spawned' })
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

// Helper: insert a WorkItem, pre-flip to active, run to the gate, return { id, gate, observer }.
async function runToGate(
  provider: Provider,
  buildResume:
    | ((args: Record<string, unknown>, executedResult?: Record<string, unknown>) => ResumeOutcome)
    | undefined
) {
  const agentId = `ro-test__${randomUUID().slice(0, 8)}`
  const { id } = await store.insertWorkItem({
    id: randomUUID(),
    workflowId: 'ro-test',
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
      provider,
      renderToolNames: ['renderLead'],
      maxInstances: 2,
      effects: {},
      dispatchToolNames: [],
      handoffs: [],
      buildResume,
    }),
    deliver: vi.fn().mockResolvedValue({ ok: true, id: 'child', deduped: false }),
    settle: async (sid, edge, _actor, opts) => {
      await transition(db, sid, edge, opts)
    },
    reconcile,
  })
  await transition(db, id, 'start')
  await observer.run(id)
  const gate = await store.getOpenGate(id)
  return { id, gate, observer }
}

describe.skipIf(!reachable)('RunObserver (real Postgres, fake provider)', () => {
  it('runs to a gate, fills the card, then resumes to finished (prompt mode — regression)', async () => {
    const { id } = await store.insertWorkItem({
      id: randomUUID(),
      workflowId: 'lead-inbox',
      agentId: 'lead-inbox__reply',
      origin: 'human',
      payload: {},
      key: 'lead-inbox__reply',
    })
    const { pool, reconcile } = fakePool()
    const observer = makeRunObserver({
      db,
      store,
      pool,
      bus: { publish: vi.fn(), subscribe: () => () => {} },
      resolveAgent: () => ({
        provider: fakeProvider(),
        renderToolNames: ['renderLead'],
        maxInstances: 2,
        effects: {},
        dispatchToolNames: [],
        handoffs: [],
        // prompt mode: the observer must call provider.resume()
        buildResume: () => ({ kind: 'prompt', text: 'continue' }),
      }),
      deliver: vi.fn().mockResolvedValue({ ok: true, id: 'child', deduped: false }),
      settle: async (sid, edge, _actor, opts) => {
        await transition(db, sid, edge, opts)
      },
      reconcile,
    })

    // The pool OWNS the queued→active flip (U7) before run() — pre-flip the row here.
    await transition(db, id, 'start')
    await observer.run(id)

    const afterRun = await store.getWorkItem(id)
    expect(afterRun?.phase).toBe('awaiting_human')
    expect(afterRun?.card).toEqual({ tool: 'renderLead', props: { name: 'Acme' } })

    const trace = await store.getTrace(id, 0)
    expect(trace.length).toBe(5) // 3 tool-call events + 1 text + 1 gate
    expect(trace.map((r) => r.seq)).toEqual([0, 1, 2, 3, 4])

    const gate = await store.getOpenGate(id)
    expect(gate?.proposedArtifact).toEqual({ to: 'a@b.c', body: 'hi' })
    expect(reconcile).toHaveBeenCalledWith('lead-inbox__reply')

    // Resume across the gate.
    await observer.resume(id, { gateId: gate!.id, decision: 'approved' })

    const afterResume = await store.getWorkItem(id)
    expect(afterResume?.phase).toBe('terminal')
    expect(await store.getOpenGate(id)).toBeUndefined()

    const stitched = await store.getTrace(id, 0)
    expect(stitched.map((r) => r.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]) // seq continues
  })

  it('prompt mode: spawns the provider as today', async () => {
    const spy = { resumed: false }
    const { id, gate, observer } = await runToGate(fakeProviderWithResumeSpy(spy), () => ({
      kind: 'prompt',
      text: 'please continue',
    }))
    await observer.resume(id, { gateId: gate!.id, decision: 'approved' })
    expect(spy.resumed).toBe(true)
    expect((await store.getWorkItem(id))?.phase).toBe('terminal')
  })

  it('message mode: appends verbatim text + finishes, WITHOUT spawning the provider', async () => {
    const spy = { resumed: false }
    const { id, gate, observer } = await runToGate(fakeProviderWithResumeSpy(spy), () => ({
      kind: 'message',
      text: 'Draft saved ✓',
    }))
    // Record trace length before resume (after gate open)
    const beforeLen = (await store.getTrace(id, 0)).length

    await observer.resume(id, { gateId: gate!.id, decision: 'approved' })

    expect(spy.resumed).toBe(false) // provider.resume NOT called
    expect((await store.getWorkItem(id))?.phase).toBe('terminal')
    const trace = await store.getTrace(id, 0)
    expect(trace.length).toBe(beforeLen + 1) // exactly ONE new event appended
    const last = trace[trace.length - 1].event as Record<string, unknown>
    expect(last['type']).toBe(EventType.TEXT_MESSAGE_CHUNK)
    expect(last['delta']).toBe('Draft saved ✓')
  })

  it('null mode: silent finish, no extra trace event, no provider spawn', async () => {
    const spy = { resumed: false }
    const { id, gate, observer } = await runToGate(fakeProviderWithResumeSpy(spy), () => null)
    const beforeLen = (await store.getTrace(id, 0)).length

    await observer.resume(id, { gateId: gate!.id, decision: 'approved' })

    expect(spy.resumed).toBe(false)
    expect((await store.getWorkItem(id))?.phase).toBe('terminal')
    const afterTrace = await store.getTrace(id, 0)
    expect(afterTrace.length).toBe(beforeLen) // NO new event appended
    expect(
      afterTrace.some((r) =>
        String((r.event as Record<string, unknown>)['delta'] ?? '').includes('Resume failed')
      )
    ).toBe(false)
  })

  it('answer-resume (message mode): appends verbatim text + finishes, WITHOUT spawning the provider', async () => {
    // Build a work item that is directly in awaiting_agent (no gate). We do this by
    // dispatching a new item, transitioning it to active (start), then straight to
    // awaiting_agent so we can call observer.resume() with an AnswerResolution.
    const agentId = `ro-test__${randomUUID().slice(0, 8)}`
    const { id } = await store.insertWorkItem({
      id: randomUUID(),
      workflowId: 'ro-test',
      agentId,
      origin: 'human',
      payload: {},
      key: agentId,
    })
    await transition(db, id, 'start')
    await transition(db, id, 'ask')

    const spy = { resumed: false }
    const providerSpy: Provider = {
      async *run(_input: RunAgentInput) {
        yield ev({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm1', delta: 'asking' })
      },
      async *resume(_handle: ResumeHandle, _resolution: ResumePayload) {
        spy.resumed = true
        yield ev({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm2', delta: 'provider-answer' })
      },
    }

    const { pool, reconcile } = fakePool()
    const observer = makeRunObserver({
      db,
      store,
      pool,
      bus: { publish: vi.fn(), subscribe: () => () => {} },
      resolveAgent: () => ({
        provider: providerSpy,
        renderToolNames: [],
        maxInstances: 1,
        effects: {},
        dispatchToolNames: [],
        handoffs: [],
        buildResume: undefined,
        buildResumeFromAnswer: () => ({ kind: 'message', text: 'continuing with the answer' }),
      }),
      deliver: vi.fn().mockResolvedValue({ ok: true, id: 'child', deduped: false }),
      settle: async (sid, edge, _actor, opts) => {
        await transition(db, sid, edge, opts)
      },
      reconcile,
    })

    const beforeLen = (await store.getTrace(id, 0)).length

    const answerPayload: AnswerResolution = {
      kind: 'answer',
      answers: [{ target: {}, answer: { text: 'X' }, ok: true }],
      allOk: true,
    }
    await observer.resume(id, answerPayload)

    expect(spy.resumed).toBe(false) // provider.resume NOT called
    expect((await store.getWorkItem(id))?.phase).toBe('terminal')
    const trace = await store.getTrace(id, 0)
    expect(trace.length).toBe(beforeLen + 1) // exactly ONE new event appended
    const last = trace[trace.length - 1].event as Record<string, unknown>
    expect(last['type']).toBe(EventType.TEXT_MESSAGE_CHUNK)
    expect(last['delta']).toBe('continuing with the answer')
  })
})
