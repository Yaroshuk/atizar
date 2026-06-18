import { randomUUID } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import { sql, eq } from 'drizzle-orm'
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import { agentQuestion, type Provider } from '@atizar/core'
import { db } from './db/client.js'
import { makeStateStore } from './stateStore.js'
import { type AgentRuntime } from './runObserver.js'
import { makePipelineService } from './pipelineService.js'
import { transition } from './transition.js'
import { questions, gates } from './db/schema.js'

// ── DB reachability ───────────────────────────────────────────────────────────

const reachable = await db
  .execute(sql`select 1`)
  .then(() => true)
  .catch(() => false)

// ── Helpers ───────────────────────────────────────────────────────────────────

const ev = (e: Record<string, unknown>): BaseEvent => e as unknown as BaseEvent

/** Asker provider: emits AGENT_QUESTION then terminates (mirrors claude-cli kill at ask).
 *  `answererBareId` is the bare (non-prefixed) agent id — the target the observer resolves
 *  via `resolveQuestionTarget` → deliverImpl builds the full `${wfId}__${answererBareId}` key. */
function askerProvider(answererBareId: string): Provider {
  return {
    async *run(_input: RunAgentInput) {
      yield ev({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm1', delta: 'asking…' })
      yield agentQuestion({
        questions: [
          {
            toolCallId: 'tc-ask',
            target: { agentId: answererBareId },
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

/** Poll `pred` every 20 ms until it returns true or `timeout` ms elapses. */
async function waitFor(pred: () => Promise<boolean>, timeout = 5000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await pred()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('waitFor timed out')
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe.skipIf(!reachable)('returnChannel e2e: full suspend→wake on the rails (PGlite)', () => {
  /**
   * HAPPY PATH — drives the REAL makePipelineService with BOTH agents registered.
   *
   * The production automatic chain under test:
   *   settle(answerer, 'finish') → finishWake(answererWiId) → observer.resume(askerWiId, {kind:'answer'})
   *
   * NO manual observer.resume call — the wake fires automatically from the production finishWake hook.
   *
   * Flow:
   *   1. service.dispatch(asker) → pool enqueues + activates → observer.run(asker)
   *   2. askerProvider emits AGENT_QUESTION → runObserver transitions asker→awaiting_agent,
   *      inserts question row, calls deliverImpl({dest:{kind:'agent',agentId:'answerer'}})
   *   3. deliverImpl builds instanceId(wfId, 'answerer') = `${wfId}__answerer`,
   *      dispatches via pool → observer.run(answerer)
   *   4. answererProvider emits renderCard → card set → finishes
   *   5. settle(answerer,'finish') calls finishWake → answerQuestion → observer.resume(asker,{kind:'answer'})
   *   6. asker resumes with buildResumeFromAnswer → emits "done: ..." text → terminal/done
   */
  it('happy path: asker suspends, answerer answers, asker wakes and finishes with answer', async () => {
    const wfId = `e2e-happy__${randomUUID().slice(0, 8)}`
    // Bare agent ids — the service builds full runtime keys as `${wfId}__asker` / `${wfId}__answerer`
    // via instanceId(wfId, bareId) inside deliverImpl / resolveDelivery.
    const askerBareId = 'asker'
    const answererBareId = 'answerer'
    const askerRuntimeId = `${wfId}__${askerBareId}`
    const answererRuntimeId = `${wfId}__${answererBareId}`
    const card = { text: 'the answer' }

    const store = makeStateStore(db)

    const service = makePipelineService({
      db,
      resolveAgent: (agentId) => {
        if (agentId === askerRuntimeId) {
          return makeRuntime(askerProvider(answererBareId), {
            buildResumeFromAnswer: (answers) => ({
              kind: 'message',
              text: `done: ${JSON.stringify(answers[0]?.answer)}`,
            }),
          })
        }
        if (agentId === answererRuntimeId) {
          return makeRuntime(answererProvider(card), { renderToolNames: ['renderCard'] })
        }
        return undefined
      },
      descriptors: [],
      instanceKeyOf: (agentId) => agentId,
      sourceOf: () => null,
      // resolveQuestionTarget: target carries { agentId: 'answerer' } (the bare id emitted by
      // askerProvider). Return it as-is; deliverImpl will build the full `${wfId}__answerer` key
      // via instanceId(wfId, 'answerer') inside resolveDelivery.
      resolveQuestionTarget: (target) => {
        const t = target as { agentId?: string }
        return typeof t.agentId === 'string' ? { agentId: t.agentId } : null
      },
    })

    // ── Phase 1: dispatch the asker and wait for it to suspend ────────────────
    const { id: askerWiId } = await service.dispatch({
      workflowId: wfId,
      agentId: askerRuntimeId,
      origin: 'human',
      payload: { task: 'test' },
    })

    // Wait until the asker has suspended AND the question row has the answerer linked.
    // The observer transitions active→awaiting_agent BEFORE calling deliver+setQuestionAnswerer,
    // so we must wait for the answererWorkItemId to be populated (not just for awaiting_agent phase)
    // to avoid a race between our read and setQuestionAnswerer.
    await waitFor(async () => {
      const [q] = await db.select().from(questions).where(eq(questions.askerWorkItemId, askerWiId))
      return q?.answererWorkItemId != null
    })

    // (a) Asker is now awaiting_agent.
    const askerAfterAsk = await store.getWorkItem(askerWiId)
    expect(askerAfterAsk?.phase).toBe('awaiting_agent')

    // (b) One open question row.
    const pendingBefore = await store.getPendingQuestionsForAsker(askerWiId)
    expect(pendingBefore).toHaveLength(1)
    expect(pendingBefore[0].status).toBe('open')
    expect(pendingBefore[0].toolCallId).toBe('tc-ask')
    expect(pendingBefore[0].payload).toEqual({ q: 'what is the answer?' })

    // (c) Answerer was dispatched automatically (deliverImpl called via runObserver → question path).
    const answererWorkItemId = pendingBefore[0].answererWorkItemId
    if (!answererWorkItemId) throw new Error('deliver was not called — answererWorkItemId is null')

    // (d) Answerer's parentId links to the asker — lineage depth 1.
    const answererWiSnap = await store.getWorkItem(answererWorkItemId)
    expect(answererWiSnap?.parentId).toBe(askerWiId)

    // (e) Question row already links the answerer.
    const [qRowAfterDispatch] = await db
      .select()
      .from(questions)
      .where(eq(questions.askerWorkItemId, askerWiId))
    expect(qRowAfterDispatch.answererWorkItemId).toBe(answererWorkItemId)

    // ── Phase 2: wait for the full automatic chain to complete ────────────────
    // The answerer was already enqueued by deliverImpl. The pool activates it and runs it
    // automatically. When it finishes, finishWake fires → answerQuestion → observer.resume(asker).
    // The asker then resumes via buildResumeFromAnswer and reaches terminal/done.
    // NO manual observer.resume call here — this is the production automatic chain under test.
    await waitFor(async () => {
      const wi = await store.getWorkItem(askerWiId)
      return wi?.phase === 'terminal'
    })

    // (f) Answerer is terminal/done.
    const answererFinal = await store.getWorkItem(answererWorkItemId)
    expect(answererFinal?.phase).toBe('terminal')
    expect(answererFinal?.outcome).toBe('done')

    // (g) Answerer's card was set from the render tool.
    expect(answererFinal?.card).toMatchObject({ tool: 'renderCard', props: card })

    // (h) Question is now answered (finishWake called answerQuestion).
    const [qRow] = await db.select().from(questions).where(eq(questions.askerWorkItemId, askerWiId))
    expect(qRow.status).toBe('answered')
    expect(qRow.answer).toMatchObject({ tool: 'renderCard', props: card })

    // (i) Asker is terminal/done — woke automatically via finishWake→observer.resume.
    const askerFinal = await store.getWorkItem(askerWiId)
    expect(askerFinal?.phase).toBe('terminal')
    expect(askerFinal?.outcome).toBe('done')

    // (j) Asker's trace carries the "done: ..." completion text (from buildResumeFromAnswer).
    const traceRows = await store.getTrace(askerWiId, 0)
    const textEvents = traceRows.filter(
      (r) => (r.event as { type?: string; delta?: string }).type === EventType.TEXT_MESSAGE_CHUNK
    )
    const allText = textEvents.map((r) => (r.event as { delta?: string }).delta ?? '').join('')
    expect(allText).toContain('done:')
    expect(allText).toContain('the answer')

    // (k) Lineage: answerer's parentId is the asker's work item id (depth not grown beyond 1).
    expect(answererFinal?.parentId).toBe(askerWiId)
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
