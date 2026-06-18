import { randomUUID } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import { sql, eq } from 'drizzle-orm'
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import { agentQuestion, type Provider } from '@atizar/core'
import { db } from './db/client.js'
import { makeStateStore } from './stateStore.js'
import { makeRunObserver, type AgentRuntime } from './runObserver.js'
import { makeEventBus } from './eventBus.js'
import { makePipelineService } from './pipelineService.js'
import { settle } from './settle.js'
import { transition } from './transition.js'
import { questions, gates } from './db/schema.js'
import type { WorkerPool } from './workerPool.js'

// ── DB reachability ───────────────────────────────────────────────────────────

const reachable = await db
  .execute(sql`select 1`)
  .then(() => true)
  .catch(() => false)

// ── Helpers ───────────────────────────────────────────────────────────────────

const ev = (e: Record<string, unknown>): BaseEvent => e as unknown as BaseEvent

/** Asker provider: emits AGENT_QUESTION then terminates (mirrors claude-cli kill at ask). */
function askerProvider(answererAgentId: string): Provider {
  return {
    async *run(_input: RunAgentInput) {
      yield ev({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm1', delta: 'asking…' })
      yield agentQuestion({
        questions: [
          {
            toolCallId: 'tc-ask',
            target: { agentId: answererAgentId },
            payload: { q: 'what is the answer?' },
          },
        ],
      })
    },
  }
}

/** Answerer provider: emits a render-card tool call (so the card gets set) then terminates. */
function answererProvider(card: Record<string, unknown>): Provider {
  return {
    async *run(_input: RunAgentInput) {
      yield ev({
        type: EventType.TOOL_CALL_START,
        toolCallId: 'tc-card',
        toolCallName: 'renderCard',
      })
      yield ev({
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: 'tc-card',
        delta: JSON.stringify(card),
      })
      yield ev({ type: EventType.TOOL_CALL_END, toolCallId: 'tc-card' })
    },
  }
}

function makeRuntime(provider: Provider, overrides: Partial<AgentRuntime> = {}): AgentRuntime {
  return {
    provider,
    renderToolNames: [],
    maxInstances: 1,
    effects: {},
    dispatchToolNames: [],
    handoffs: [],
    maxQuestionRounds: 5,
    questionTimeoutMs: 120_000,
    maxQuestionRetries: 2,
    ...overrides,
  }
}

function fakePool(): WorkerPool {
  return {
    enqueue: vi.fn(),
    dequeue: vi.fn(),
    reconcile: vi.fn(),
    activeCount: async () => 0,
    queuedCount: () => 0,
  }
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe.skipIf(!reachable)('returnChannel e2e: full suspend→wake on the rails (PGlite)', () => {
  /**
   * HAPPY PATH
   * asker emits AGENT_QUESTION → awaiting_agent + question row open + answerer dispatched
   * answerer emits card + finishes → question answered → asker wakes → finishes with answer in trace
   */
  it('happy path: asker suspends, answerer answers, asker wakes and finishes with answer', async () => {
    const wfId = `e2e-happy__${randomUUID().slice(0, 8)}`
    const askerAgentId = `${wfId}__asker`
    const answererAgentId = `${wfId}__answerer`
    const card = { text: 'the answer' }

    const store = makeStateStore(db)
    const bus = makeEventBus()
    const pool = fakePool()

    const settleImpl = async (
      id: string,
      edge: 'finish' | 'fail',
      actor: string | null,
      opts?: { error?: string }
    ) => settle({ db, store, bus, reconcile: pool.reconcile }, id, edge, actor, opts)

    // Track resume calls to verify the asker wakes correctly.
    const resumeCalls: { id: string; payload: unknown }[] = []

    // Answerer observer: runs the answer provider, sets the card, then wakes the asker.
    const answererObs = makeRunObserver({
      db,
      store,
      pool,
      bus,
      resolveAgent: (agentId) => {
        if (agentId === answererAgentId) {
          return makeRuntime(answererProvider(card), { renderToolNames: ['renderCard'] })
        }
        return undefined
      },
      deliver: async () => ({ ok: true, id: randomUUID(), deduped: false }),
      settle: async (id, edge, actor, opts) => {
        await settleImpl(id, edge, actor, opts)
        if (edge === 'finish') {
          const q = await store.getQuestionByAnswerer(id)
          if (!q) return
          const wi = await store.getWorkItem(id)
          const answer: Record<string, unknown> = wi?.card ?? {}
          await store.answerQuestion(q.id, answer)
          const pending = await store.getPendingQuestionsForAsker(q.askerWorkItemId)
          if (pending.length === 0) {
            const answers = [{ target: q.target, answer, ok: true as const }]
            resumeCalls.push({
              id: q.askerWorkItemId,
              payload: { kind: 'answer', answers, allOk: true },
            })
          }
        }
      },
      reconcile: pool.reconcile,
      resolveQuestionTarget: () => null,
    })

    // Asker observer: runs the question provider, suspends, and tracks deliver for the answerer.
    let answererWorkItemId: string | undefined
    const askerObs = makeRunObserver({
      db,
      store,
      pool,
      bus,
      resolveAgent: (agentId) => {
        if (agentId === askerAgentId) {
          return makeRuntime(askerProvider(answererAgentId), {
            buildResumeFromAnswer: (answers) => ({
              kind: 'message',
              text: `done: ${JSON.stringify(answers[0]?.answer)}`,
            }),
          })
        }
        return undefined
      },
      deliver: async (_req) => {
        // Create the answerer work item so we can link it via setQuestionAnswerer.
        const awi = await store.insertWorkItem({
          workflowId: wfId,
          agentId: answererAgentId,
          origin: 'agent',
          payload: { q: 'what is the answer?' },
          key: answererAgentId,
          parentId: askerWi.id,
        })
        answererWorkItemId = awi.id
        return { ok: true, id: awi.id, deduped: false }
      },
      settle: settleImpl,
      reconcile: pool.reconcile,
      resolveQuestionTarget: (target) => {
        const t = target as { agentId?: string }
        return typeof t.agentId === 'string' ? { agentId: t.agentId } : null
      },
    })

    // Insert + start the asker work item.
    const askerWi = await store.insertWorkItem({
      workflowId: wfId,
      agentId: askerAgentId,
      origin: 'human',
      payload: { task: 'test' },
      key: askerAgentId,
    })
    await transition(db, askerWi.id, 'start')

    // ── Phase 1: run the asker ────────────────────────────────────────────────
    await askerObs.run(askerWi.id)

    // (a) Asker is now awaiting_agent.
    const askerAfterAsk = await store.getWorkItem(askerWi.id)
    expect(askerAfterAsk?.phase).toBe('awaiting_agent')

    // (b) One open question row.
    const pendingBefore = await store.getPendingQuestionsForAsker(askerWi.id)
    expect(pendingBefore).toHaveLength(1)
    expect(pendingBefore[0].status).toBe('open')
    expect(pendingBefore[0].toolCallId).toBe('tc-ask')
    expect(pendingBefore[0].payload).toEqual({ q: 'what is the answer?' })

    // (c) Answerer was dispatched (deliver was called once).
    expect(answererWorkItemId).toBeDefined()

    // (d) Answerer's parentId links to the asker — lineage depth is 1 (question row is the link).
    const answererWi = await store.getWorkItem(answererWorkItemId!)
    expect(answererWi?.parentId).toBe(askerWi.id)

    // Link the answerer work item id to the question row (normally done by the observer via
    // setQuestionAnswerer inside deliver success — here it's already done in the deliver mock above
    // via RunObserver.consume which calls setQuestionAnswerer after deliver returns ok).
    // The link is already set by the askerObs.run path (RunObserver calls setQuestionAnswerer).
    const pendingAfterLink = await db
      .select()
      .from(questions)
      .where(eq(questions.askerWorkItemId, askerWi.id))
    expect(pendingAfterLink[0].answererWorkItemId).toBe(answererWorkItemId)

    // ── Phase 2: run the answerer ─────────────────────────────────────────────
    await transition(db, answererWorkItemId!, 'start')
    await answererObs.run(answererWorkItemId!)

    // (e) Answerer is terminal/done.
    const answererFinal = await store.getWorkItem(answererWorkItemId!)
    expect(answererFinal?.phase).toBe('terminal')
    expect(answererFinal?.outcome).toBe('done')

    // (f) Answerer's card was set from the render tool.
    expect(answererFinal?.card).toMatchObject({ tool: 'renderCard', props: card })

    // (g) Question is now answered.
    const [qRow] = await db
      .select()
      .from(questions)
      .where(eq(questions.askerWorkItemId, askerWi.id))
    expect(qRow.status).toBe('answered')
    expect(qRow.answer).toMatchObject({ tool: 'renderCard', props: card })

    // (h) Resume was called for the asker with {kind:'answer'}.
    expect(resumeCalls).toHaveLength(1)
    expect(resumeCalls[0].id).toBe(askerWi.id)
    expect(resumeCalls[0].payload).toMatchObject({ kind: 'answer' })

    // ── Phase 3: wake the asker (observer.resume) ─────────────────────────────
    await askerObs.resume(
      askerWi.id,
      resumeCalls[0].payload as Parameters<typeof askerObs.resume>[1]
    )

    // (i) Asker is terminal/done.
    const askerFinal = await store.getWorkItem(askerWi.id)
    expect(askerFinal?.phase).toBe('terminal')
    expect(askerFinal?.outcome).toBe('done')

    // (j) Asker's trace carries the "done: ..." completion text.
    const trace = await store.getTrace(askerWi.id, 0)
    const textEvents = trace.filter(
      (r) => (r.event as { type?: string; delta?: string }).type === EventType.TEXT_MESSAGE_CHUNK
    )
    const allText = textEvents.map((r) => (r.event as { delta?: string }).delta ?? '').join('')
    expect(allText).toContain('done:')
    expect(allText).toContain('the answer')
  })

  /**
   * CANCEL PATH
   * asker suspended in awaiting_agent + answerer dispatched → cancel the asker
   * → question failed, answerer cancelled
   */
  it('cancel path: cancelling an awaiting_agent asker fails its question and cancels the answerer', async () => {
    const wfId = `e2e-cancel__${randomUUID().slice(0, 8)}`
    const askerAgentId = `${wfId}__asker`
    const answererAgentId = `${wfId}__answerer`

    const service = makePipelineService({
      db,
      resolveAgent: (agentId) => {
        if (agentId === askerAgentId) {
          return makeRuntime(askerProvider(answererAgentId))
        }
        if (agentId === answererAgentId) {
          return makeRuntime({ async *run() {} })
        }
        return undefined
      },
      descriptors: [],
      instanceKeyOf: (agentId) => agentId,
      sourceOf: () => null,
      resolveQuestionTarget: (target) => {
        const t = target as { agentId?: string }
        return typeof t.agentId === 'string' ? { agentId: t.agentId } : null
      },
    })

    const store = makeStateStore(db)

    // Create asker WI in awaiting_agent phase.
    const askerWi = await store.insertWorkItem({
      workflowId: wfId,
      agentId: askerAgentId,
      origin: 'human',
      payload: {},
      key: askerAgentId,
    })
    await transition(db, askerWi.id, 'start')
    await transition(db, askerWi.id, 'ask')

    // Insert an open question and an answerer work item (simulate what RunObserver would do).
    const qRow = await store.insertQuestion({
      askerWorkItemId: askerWi.id,
      target: { agentId: answererAgentId },
      toolCallId: 'tc-cancel',
      payload: { q: 'cancel me' },
    })

    const answererWi = await store.insertWorkItem({
      workflowId: wfId,
      agentId: answererAgentId,
      origin: 'agent',
      payload: {},
      key: answererAgentId,
      parentId: askerWi.id,
    })
    await transition(db, answererWi.id, 'start') // answerer is active
    await store.setQuestionAnswerer(qRow.id, answererWi.id)

    // Cancel the asker.
    await service.cancel(askerWi.id)

    // (a) Question is failed.
    const [qAfter] = await db.select().from(questions).where(eq(questions.id, qRow.id))
    expect(qAfter.status).toBe('failed')
    expect(qAfter.reason).toContain('cancelled')

    // (b) Asker is terminal/stopped.
    const askerAfter = await store.getWorkItem(askerWi.id)
    expect(askerAfter?.phase).toBe('terminal')
    expect(askerAfter?.outcome).toBe('stopped')

    // (c) Answerer is also cancelled (child cascade).
    const answererAfter = await store.getWorkItem(answererWi.id)
    expect(answererAfter?.phase).toBe('terminal')
    expect(answererAfter?.outcome).toBe('stopped')
  })

  /**
   * TIMEOUT-ESCALATION PATH
   * asker with an expired question at max retries → reapExpiredQuestions()
   * → question failed, asker escalated to awaiting_human with an open gate
   */
  it('timeout-escalation path: expired question past max retries escalates to human gate', async () => {
    const wfId = `e2e-timeout__${randomUUID().slice(0, 8)}`
    const askerAgentId = `${wfId}__asker`
    const answererAgentId = `${wfId}__answerer`

    const service = makePipelineService({
      db,
      resolveAgent: (agentId) => {
        if (agentId === askerAgentId) {
          return makeRuntime(
            { async *run() {} },
            {
              maxQuestionRetries: 0, // immediate escalation on first expiry
              questionTimeoutMs: 60_000,
              maxQuestionRounds: 3,
            }
          )
        }
        if (agentId === answererAgentId) {
          return makeRuntime({ async *run() {} })
        }
        return undefined
      },
      descriptors: [],
      instanceKeyOf: (agentId) => agentId,
      sourceOf: () => null,
      resolveQuestionTarget: (target) => {
        const t = target as { agentId?: string }
        return typeof t.agentId === 'string' ? { agentId: t.agentId } : null
      },
    })

    const store = makeStateStore(db)

    // Create asker WI in awaiting_agent.
    const askerWi = await store.insertWorkItem({
      workflowId: wfId,
      agentId: askerAgentId,
      origin: 'human',
      payload: {},
      key: askerAgentId,
    })
    await transition(db, askerWi.id, 'start')
    await transition(db, askerWi.id, 'ask')

    // Insert expired question (deadline in the past, retries=0 = at limit already for maxRetries=0).
    const expiredDeadline = new Date(Date.now() - 1000)
    const qRow = await store.insertQuestion({
      askerWorkItemId: askerWi.id,
      answererWorkItemId: null,
      target: { agentId: answererAgentId },
      toolCallId: 'tc-timeout',
      payload: { q: 'timeout me' },
      deadline: expiredDeadline,
    })

    // Suppress expected console.warn from escalateQuestion.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Reap.
    await service.reapExpiredQuestions()

    warnSpy.mockRestore()

    // (a) Question is failed (escalated).
    const [qAfter] = await db.select().from(questions).where(eq(questions.id, qRow.id))
    expect(qAfter.status).toBe('failed')

    // (b) Asker is awaiting_human (escalated).
    const askerAfter = await store.getWorkItem(askerWi.id)
    expect(askerAfter?.phase).toBe('awaiting_human')

    // (c) An open gate exists on the asker.
    const openGates = await db.select().from(gates).where(eq(gates.workItemId, askerWi.id))
    expect(openGates.length).toBeGreaterThan(0)
    expect(openGates[0].status).toBe('open')
    expect(openGates[0].toolName).toBe('escalated_question')
  })
})
