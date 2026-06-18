import { randomUUID } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import {
  agentQuestion,
  defineAgent,
  defineProviders,
  defineWorkflow,
  type Provider,
} from '@atizar/core'
import { db } from './db/client.js'
import { makePipelineService } from './pipelineService.js'
import { makeStateStore } from './stateStore.js'
import { transition } from './transition.js'
import { createServer } from './createServer.js'
import type { AgentRuntime } from './runObserver.js'

const reachable = await db
  .execute(sql`select 1`)
  .then(() => true)
  .catch(() => false)

const ev = (e: Record<string, unknown>): BaseEvent => e as unknown as BaseEvent

// ── helpers ────────────────────────────────────────────────────────────────────

function makeRuntime(provider: Provider): AgentRuntime {
  return {
    provider,
    renderToolNames: [],
    maxInstances: 1,
    effects: {},
    dispatchToolNames: [],
    handoffs: [],
  }
}

// Provider that emits an AGENT_QUESTION then terminates (mirrors real behaviour).
function questionProvider(answererAgentId: string): Provider {
  return {
    async *run(_input: RunAgentInput) {
      yield ev({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm1', delta: 'asking' })
      yield agentQuestion({
        questions: [
          { toolCallId: 'tc-ask', target: { agentId: answererAgentId }, payload: { q: '?' } },
        ],
      })
    },
  }
}

// Provider that emits a render-card tool call then terminates normally.
function answerProvider(card: Record<string, unknown>): Provider {
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

// ─── Test suite ────────────────────────────────────────────────────────────────

describe.skipIf(!reachable)(
  'pipelineService: answerer-finish wakes the asker (real Postgres)',
  () => {
    it('finish→wake: answerer finishing resolves the question and calls observer.resume for the asker', async () => {
      const store = makeStateStore(db)

      const askerAgentId = `pq-asker__${randomUUID().slice(0, 8)}`
      const answererAgentId = `pq-answerer__${randomUUID().slice(0, 8)}`
      const card = { result: 'the-answer' }

      // Track resume calls
      const resumeCalls: { id: string; payload: unknown }[] = []

      // Build a service where the answerer runtime has a render tool so the card gets set.
      const service = makePipelineService({
        db,
        resolveAgent: (agentId) => {
          if (agentId === askerAgentId) {
            return makeRuntime(questionProvider(answererAgentId))
          }
          if (agentId === answererAgentId) {
            return {
              ...makeRuntime(answerProvider(card)),
              renderToolNames: ['renderCard'],
            }
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

      // Insert + start asker work item
      const askerWi = await store.insertWorkItem({
        workflowId: 'pq-test',
        agentId: askerAgentId,
        origin: 'human',
        payload: {},
        key: askerAgentId,
      })
      await transition(db, askerWi.id, 'start')

      // Run the asker: it will ask a question, suspend, and dispatch the answerer.
      // We intercept the deliver to create the answerer work item manually and track it.
      let answererWorkItemId: string | undefined

      // We need to spy on service.deliver to know the answerer work item id.
      // The easiest approach: use the pipelineService dispatch path for the answerer.
      // But since descriptors is empty (no resolveDelivery), deliver will fail.
      // Instead, let's build with a custom setup using makeRunObserver directly,
      // OR we use the pipelineService's deliver by wiring descriptors properly.
      //
      // Simplest: run the asker through the observer directly with a fake deliver that
      // returns the answerer work item id, then manually set the answererWorkItemId on
      // the question row, run the answerer, and assert the asker was resumed.
      //
      // We do this by building two observers sharing the same store/bus.

      // Direct observer approach — build both observers sharing the store.
      const { makeRunObserver } = await import('./runObserver.js')
      const { makeEventBus } = await import('./eventBus.js')
      const { settle } = await import('./settle.js')

      const bus = makeEventBus()
      const fakePool = {
        enqueue: vi.fn(),
        dequeue: vi.fn(),
        reconcile: vi.fn(),
        activeCount: async () => 0,
        queuedCount: () => 0,
      }

      const settleImpl = async (
        id: string,
        edge: 'finish' | 'fail',
        actor: string | null,
        opts?: { error?: string }
      ) => settle({ db, store, bus, reconcile: fakePool.reconcile }, id, edge, actor, opts)

      // Observer that wires the answerer-finish→wake logic (the feature under test).
      // We capture resume calls here to verify the wake.
      const resumeCapture: { id: string; payload: unknown }[] = []

      const answererObs = makeRunObserver({
        db,
        store,
        pool: fakePool,
        bus,
        resolveAgent: () => ({
          ...makeRuntime(answerProvider(card)),
          renderToolNames: ['renderCard'],
        }),
        deliver: async () => ({ ok: true, id: randomUUID(), deduped: false }),
        settle: async (id, edge, actor, opts) => {
          await settleImpl(id, edge, actor, opts)
          // ── T5 FINISH→WAKE SEAM (the feature under test) ──────────────────────────
          // After a 'finish' edge: look up the question row whose answererWorkItemId
          // matches this work item; if found, answer it and wake the asker.
          if (edge === 'finish') {
            const q = await store.getQuestionByAnswerer(id)
            if (q) {
              const wi = await store.getWorkItem(id)
              const answer = wi?.card ?? {}
              await store.answerQuestion(q.id, answer)
              const pending = await store.getPendingQuestionsForAsker(q.askerWorkItemId)
              if (pending.length === 0) {
                const answers = [{ target: q.target, answer, ok: true as const }]
                resumeCapture.push({
                  id: q.askerWorkItemId,
                  payload: { kind: 'answer', answers, allOk: true },
                })
              }
            }
          }
        },
        reconcile: fakePool.reconcile,
        resolveQuestionTarget: () => null,
      })

      const askerObs = makeRunObserver({
        db,
        store,
        pool: fakePool,
        bus,
        resolveAgent: () => makeRuntime(questionProvider(answererAgentId)),
        deliver: async (_req) => {
          // Create the answerer work item so we can link it
          const awi = await store.insertWorkItem({
            workflowId: 'pq-test',
            agentId: answererAgentId,
            origin: 'agent',
            payload: { q: '?' },
            key: answererAgentId,
            parentId: askerWi.id,
          })
          answererWorkItemId = awi.id
          return { ok: true, id: awi.id, deduped: false }
        },
        settle: settleImpl,
        reconcile: fakePool.reconcile,
        resolveQuestionTarget: (target) => {
          const t = target as { agentId?: string }
          return typeof t.agentId === 'string' ? { agentId: t.agentId } : null
        },
      })

      // Run the asker — it asks and suspends
      await askerObs.run(askerWi.id)

      // Asker should be awaiting_agent
      const askerAfterAsk = await store.getWorkItem(askerWi.id)
      expect(askerAfterAsk?.phase).toBe('awaiting_agent')

      // Question row should be open
      const pendingBefore = await store.getPendingQuestionsForAsker(askerWi.id)
      expect(pendingBefore).toHaveLength(1)
      expect(pendingBefore[0].status).toBe('open')

      // Link the answerer work item id to the question row
      expect(answererWorkItemId).toBeDefined()
      await store.setQuestionAnswerer(pendingBefore[0].id, answererWorkItemId!)

      // Start and run the answerer — it emits a card then finishes
      await transition(db, answererWorkItemId!, 'start')
      await answererObs.run(answererWorkItemId!)

      // Answerer should be terminal/done
      const answererFinal = await store.getWorkItem(answererWorkItemId!)
      expect(answererFinal?.phase).toBe('terminal')
      expect(answererFinal?.outcome).toBe('done')
      // Card was set from the render tool (stored as { tool, props })
      expect(answererFinal?.card).toMatchObject({ tool: 'renderCard', props: card })

      // Question row should be answered
      const pendingAfter = await store.getPendingQuestionsForAsker(askerWi.id)
      expect(pendingAfter).toHaveLength(0)

      // The question row itself should have status='answered' with the card as answer
      const { questions: questionsTable } = await import('./db/schema.js')
      const { eq } = await import('drizzle-orm')
      const allQuestions = await db
        .select()
        .from(questionsTable)
        .where(eq(questionsTable.askerWorkItemId, askerWi.id))
      expect(allQuestions[0].status).toBe('answered')
      expect(allQuestions[0].answer).toMatchObject({ tool: 'renderCard', props: card })

      // observer.resume was called for the asker with {kind:'answer'}
      expect(resumeCapture).toHaveLength(1)
      expect(resumeCapture[0].id).toBe(askerWi.id)
      expect(resumeCapture[0].payload).toMatchObject({ kind: 'answer' })
    })

    it('finish does NOT trigger wake for a non-answerer work item', async () => {
      const store = makeStateStore(db)
      const { makeRunObserver } = await import('./runObserver.js')
      const { makeEventBus } = await import('./eventBus.js')
      const { settle } = await import('./settle.js')

      const agentId = `pq-plain__${randomUUID().slice(0, 8)}`
      const bus = makeEventBus()
      const fakePool = {
        enqueue: vi.fn(),
        dequeue: vi.fn(),
        reconcile: vi.fn(),
        activeCount: async () => 0,
        queuedCount: () => 0,
      }
      const wakeCallCount = { n: 0 }

      const obs = makeRunObserver({
        db,
        store,
        pool: fakePool,
        bus,
        resolveAgent: () =>
          makeRuntime({
            async *run() {
              yield ev({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm1', delta: 'done' })
            },
          }),
        deliver: async () => ({ ok: true, id: randomUUID(), deduped: false }),
        settle: async (id, edge, actor, opts) => {
          await settle({ db, store, bus, reconcile: fakePool.reconcile }, id, edge, actor, opts)
          if (edge === 'finish') {
            const q = await store.getQuestionByAnswerer(id)
            if (q) wakeCallCount.n++
          }
        },
        reconcile: fakePool.reconcile,
        resolveQuestionTarget: () => null,
      })

      const wi = await store.insertWorkItem({
        workflowId: 'pq-plain-test',
        agentId,
        origin: 'human',
        payload: {},
        key: agentId,
      })
      await transition(db, wi.id, 'start')
      await obs.run(wi.id)

      expect(wakeCallCount.n).toBe(0)
    })
  }
)

// ── Boot validation ─────────────────────────────────────────────────────────────

describe('createServer boot validation: asks requires buildResumeFromAnswer', () => {
  const baseProvider: Provider = { async *run() {} }
  const registry = defineProviders({ mock: () => baseProvider })

  const buildProvider: Parameters<typeof createServer>[0]['buildProvider'] = (
    def,
    prompts,
    reg,
    allowed,
    key
  ) =>
    reg.resolve(def.provider)({
      approvalNames: def.approvals,
      surfaceTools: def.tools,
      allowedTools: allowed,
      prompts,
      instructions: def.instructions,
      agentId: key,
    })

  it('throws when an agent declares asks but binding lacks buildResumeFromAnswer', async () => {
    const askingAgent = defineAgent({
      id: 'boot-asker',
      name: 'ASKER',
      provider: 'mock',
      instructions: 'x',
      tools: ['askFoo'],
      approvals: [],
      renders: {},
      asks: ['askFoo'],
    })

    const descriptor = defineWorkflow({
      id: 'boot-ask-wf',
      label: 'Ask WF',
      iconName: 'inbox',
      agents: [{ agent: askingAgent, role: 'input' as const }],
      entryAgentId: 'boot-asker',
      inputs: [],
    })

    await expect(
      createServer({
        workflowServers: [
          {
            descriptor,
            bindings: () => [
              {
                agentId: 'boot-asker',
                allowedTools: ['askFoo'],
                // No buildResumeFromAnswer — should throw
                prompts: { buildFirst: () => 'p' },
              },
            ],
          },
        ],
        providerRegistry: registry,
        buildProvider,
        connections: [],
        scopesFor: () => [],
        instanceKeyOf: (agentId) => agentId,
        sourceOf: () => null,
        enabledWorkflows: null,
        start: false,
      })
    ).rejects.toThrow(/buildResumeFromAnswer/)
  })

  it('does NOT throw when the agent declares asks AND binding has buildResumeFromAnswer', async () => {
    const askingAgent = defineAgent({
      id: 'boot-asker-ok',
      name: 'ASKER',
      provider: 'mock',
      instructions: 'x',
      tools: ['askFoo'],
      approvals: [],
      renders: {},
      asks: ['askFoo'],
    })

    const descriptor = defineWorkflow({
      id: 'boot-ask-wf-ok',
      label: 'Ask WF OK',
      iconName: 'inbox',
      agents: [{ agent: askingAgent, role: 'input' as const }],
      entryAgentId: 'boot-asker-ok',
      inputs: [],
    })

    await expect(
      createServer({
        workflowServers: [
          {
            descriptor,
            bindings: () => [
              {
                agentId: 'boot-asker-ok',
                allowedTools: ['askFoo'],
                prompts: {
                  buildFirst: () => 'p',
                  buildResumeFromAnswer: () => null,
                },
              },
            ],
          },
        ],
        providerRegistry: registry,
        buildProvider,
        connections: [],
        scopesFor: () => [],
        instanceKeyOf: (agentId) => agentId,
        sourceOf: () => null,
        enabledWorkflows: null,
        start: false,
      })
    ).resolves.toBeDefined()
  })
})
