import { randomUUID } from 'node:crypto'
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import {
  encodeHandoff,
  handoffNote,
  readGateOpened,
  readAgentQuestion,
  type EffectFn,
  type GateResolution,
  type PromptStrategy,
  type Provider,
  type ResumeOutcome,
  type ResumePayload,
} from '@atizar/core'
import type { Db } from './db/client.js'
import type { StateStore } from './stateStore.js'
import type { WorkerPool } from './workerPool.js'
import type { EventBus } from './eventBus.js'
import { transition } from './transition.js'
import type { WorkItem } from './db/schema.js'
import type { ActivityLog } from './activity.js'

// The server-side consumer of a provider run — runs for EVERY dispatch, browser or not
// (spec §1.5). Appends Trace, reacts to GATE_OPENED (insert Gate + transition + suspend),
// fills the card from a registered render tool, finalizes status, and republishes every
// event on the per-WorkItem bus topic for any attached SSE viewer.

export interface AgentRuntime {
  provider: Provider
  renderToolNames: string[]
  // The agent passport's maxInstances — the per-agent concurrency cap (defineAgent default 1).
  maxInstances: number
  // Server-executed effects, keyed by approval tool name (step 4). Empty for read-only agents.
  effects: Record<string, EffectFn>
  // F2 machine dispatch: tool names the model calls to route work to a child agent.
  dispatchToolNames: string[]
  // F2 machine dispatch: the allowed child agent ids (from defineAgent.handoffs).
  handoffs: string[]
  // F3 resume branching: the PromptStrategy's buildResume, bound at wiring time (buildAgent).
  // When present, the observer calls it to get the ResumeOutcome and branches accordingly:
  //   prompt  → consume(provider.resume(…))       — unchanged path
  //   message → append one TEXT_MESSAGE_CHUNK, then settle('finish')
  //   null    → settle('finish') silently, no event, no provider call
  // Absent (legacy/no-approval agents) defaults to null mode (silent settle).
  buildResume?: PromptStrategy['buildResume']
  // F3 answer-resume: the PromptStrategy's buildResumeFromAnswer, bound at wiring time.
  // Parallel to buildResume but called when an agent answer (kind:'answer') arrives instead
  // of a human gate resolution. The same null/message/prompt outcome branching applies.
  buildResumeFromAnswer?: PromptStrategy['buildResumeFromAnswer']
}

export interface RunObserverDeps {
  db: Db
  store: StateStore
  pool: WorkerPool
  bus: EventBus
  resolveAgent: (agentId: string) => AgentRuntime | undefined
  // F2 machine dispatch: create a child work item. Called by RunObserver when a dispatch
  // tool call resolves to a valid handoff target. Errors are caught internally — never
  // bubble into the stream.
  deliver: (req: {
    origin: string
    dest: { kind: 'agent'; agentId: string }
    payload: Record<string, unknown>
    parentId: string
  }) => Promise<
    { ok: true; id: string; deduped: boolean } | { ok: false; error: string } | undefined
  >
  // F4 activity feed — optional so tests that omit it stay zero-overhead.
  activity?: ActivityLog
  // The one terminal writer (U7). RunObserver calls it for its own finish/fail so the trace note
  // + audit + pool reconcile happen identically to the human-driven terminal edges.
  settle: (
    id: string,
    edge: 'finish' | 'fail',
    actor: string | null,
    opts?: { error?: string }
  ) => Promise<void>
  // Re-derive pool occupancy after a gate suspend (replaces pool.release(agentId)).
  reconcile: (agentId: string) => void
  // F5 agent-to-agent questions: resolve an opaque question `target` to a concrete agentId.
  // App policy — the framework never knows which agent is the answerer (I5). Returns null if
  // routing is impossible; the observer throws loudly (routing failure is never silently dropped — I12).
  // `askerAgentId` is the instance key (wf__agentId) so the app can dispatch to the right binding.
  resolveQuestionTarget?: (
    target: unknown,
    ctx: { workflowId: string; askerWorkItemId: string; askerAgentId: string }
  ) => { agentId: string } | null
}

export interface RunObserver {
  run(id: string): Promise<void>
  resume(id: string, payload: ResumePayload): Promise<void>
  cancel(id: string): void
}

type ToolEvent = BaseEvent & {
  toolCallId?: string
  toolCallName?: string
  delta?: string
}

export function makeRunObserver(deps: RunObserverDeps): RunObserver {
  const { db, store, bus } = deps

  // Live executor iterators, so Stop can interrupt a running stream: iterator.return()
  // runs the provider generator's finally → child.kill(). Keyed by workItemId.
  const live = new Map<string, AsyncIterator<BaseEvent>>()

  const publishStatus = (id: string, status: string): void => {
    // Per-WorkItem topic carries status alongside trace events (the thread SSE tail);
    // the board topic carries it for the coarse board SSE.
    bus.publish(`workitem:${id}`, { kind: 'status', status })
    bus.publish('board', { kind: 'status', id, status })
  }

  // Reconstruct the RunAgentInput from the durable WorkItem (same shape run + resume use).
  // A non-empty payload is seeded as the handoff message; an empty one (dev start) yields
  // no seed — the cassette replay keys on the resolved-approval count, not the prompt.
  const buildInput = (wi: WorkItem): RunAgentInput => {
    const hasPayload = wi.payload && Object.keys(wi.payload).length > 0
    return {
      threadId: wi.id,
      runId: wi.runId ?? randomUUID(),
      state: {},
      messages: hasPayload ? [encodeHandoff(wi.payload)] : [],
      tools: [],
      context: [],
      forwardedProps: {},
    } as RunAgentInput
  }

  // Consume one provider stream (run or resume) into the SAME trace, continuing seq.
  async function consume(
    id: string,
    wi: WorkItem,
    runtime: AgentRuntime,
    iterable: AsyncIterable<BaseEvent>
  ): Promise<void> {
    let seq = (await store.getTrace(id, 0)).length
    let gateOpened = false
    let questionAsked = false
    // Accumulate render-tool-call args to fill the card on TOOL_CALL_END.
    const openCalls = new Map<string, { name: string; args: string }>()
    const iterator = iterable[Symbol.asyncIterator]()
    live.set(id, iterator)

    try {
      while (true) {
        const next = await iterator.next()
        if (next.done) break
        const event = next.value

        await store.appendTrace(id, seq, event)
        bus.publish(`workitem:${id}`, { seq, event })
        seq++

        const te = event as ToolEvent
        if (te.type === EventType.TOOL_CALL_START && te.toolCallId) {
          openCalls.set(te.toolCallId, { name: te.toolCallName ?? '', args: '' })
        } else if (te.type === EventType.TOOL_CALL_ARGS && te.toolCallId) {
          const call = openCalls.get(te.toolCallId)
          if (call) call.args += te.delta ?? ''
        } else if (te.type === EventType.TOOL_CALL_END && te.toolCallId) {
          const call = openCalls.get(te.toolCallId)
          if (call && runtime.renderToolNames.includes(call.name)) {
            try {
              const props = JSON.parse(call.args || '{}') as Record<string, unknown>
              await store.setCard(id, { tool: call.name, props })
            } catch {
              // Malformed/partial args — skip the card; the trace is still lossless.
            }
          }
          // F2 machine dispatch: if the model called a dispatch tool, create a child work item.
          // A bad target is a model error — record a trace warning, do NOT throw (I2: machine
          // dispatch produces a work item only, never an action; bad target is non-fatal).
          if (call && runtime.dispatchToolNames.includes(call.name)) {
            try {
              const parsed = JSON.parse(call.args || '{}') as { to?: string } & Record<
                string,
                unknown
              >
              const to = typeof parsed.to === 'string' ? parsed.to : ''
              if (runtime.handoffs.includes(to)) {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured to strip `to` from the payload
                const { to: _to, ...payload } = parsed
                const res = await deps
                  .deliver({
                    origin: wi.workflowId,
                    dest: { kind: 'agent', agentId: to },
                    payload,
                    parentId: id,
                  })
                  .catch((e) => {
                    console.error('[runObserver] dispatch deliver failed', id, e)
                    return undefined
                  })
                if (res?.ok === true) {
                  const ho = handoffNote({
                    kind: 'handoff',
                    targetAgentId: to,
                    childWorkItemId: res.id,
                    deduped: res.deduped,
                    at: Date.now(),
                  })
                  await store.appendTrace(id, seq, ho)
                  bus.publish(`workitem:${id}`, { seq, event: ho })
                  seq++
                }
              } else {
                // Invalid target: append a synthetic warning to the trace and publish it.
                // The stream continues — this is a model-side routing mistake, not a system fault.
                const warn = {
                  type: 'CUSTOM',
                  name: 'dispatch_rejected',
                  value: { to, reason: 'not in handoffs' },
                } as unknown as BaseEvent
                await store.appendTrace(id, seq, warn)
                bus.publish(`workitem:${id}`, { seq, event: warn })
                seq++
              }
            } catch {
              // Malformed dispatch args — skip. The trace is still lossless.
            }
          }
        }

        const gate = readGateOpened(event)
        if (gate) {
          await store.insertGate({
            workItemId: id,
            toolName: gate.toolName,
            toolCallId: gate.toolCallId,
            proposedArtifact: gate.proposedArtifact,
          })
          await transition(db, id, 'gate')
          publishStatus(id, 'awaiting_human')
          deps.activity?.record({
            ts: Date.now(),
            workflowId: wi.workflowId,
            agentId: wi.agentId,
            workItemId: id,
            kind: 'gate',
            summary: gate.toolName,
          })
          gateOpened = true
        }

        // F5 agent-to-agent questions: mirrors the gate block above.
        // The provider emits AGENT_QUESTION then returns (the asker process is dead, just like the
        // claude-cli kill at a gate). We insert the question row(s), transition active→awaiting_agent,
        // publish status, then route and dispatch the answerer via deps.deliver.
        const q = readAgentQuestion(event)
        if (q) {
          for (const question of q.questions) {
            // Resolve the opaque target via the injected router (app policy, I5).
            // A null result is a ROUTING FAILURE — never silently drop (I12): throw loudly so the
            // asker's run ends in error rather than silently hanging in awaiting_agent forever.
            const resolved = deps.resolveQuestionTarget?.(question.target, {
              workflowId: wi.workflowId,
              askerWorkItemId: id,
              askerAgentId: wi.agentId,
            })
            if (!resolved) {
              throw new Error(
                `[runObserver] routing failure: no answerer resolved for target ${JSON.stringify(question.target)} (workItemId=${id})`
              )
            }

            await store.insertQuestion({
              askerWorkItemId: id,
              target: question.target as Record<string, unknown>,
              toolCallId: question.toolCallId,
              payload: question.payload,
            })
            await transition(db, id, 'ask')
            publishStatus(id, 'awaiting_agent')

            // Dispatch the answerer, seeded with the question payload.
            // The payload is stored as-is on the work item; buildInput will call encodeHandoff on
            // wi.payload to produce the seed message when the answerer's run starts.
            // answererWorkItemId is left null on the question row for Pass 1 (deliver return value
            // carries the id but there is no setQuestionAnswerer yet — add when the answer-back path
            // needs to wake the asker by question id rather than by pool-scan).
            await deps
              .deliver({
                origin: wi.workflowId,
                dest: { kind: 'agent', agentId: resolved.agentId },
                payload: question.payload,
                parentId: id,
              })
              .catch((e) => {
                console.error('[runObserver] question deliver failed', id, e)
                return undefined
              })

            deps.activity?.record({
              ts: Date.now(),
              workflowId: wi.workflowId,
              agentId: wi.agentId,
              workItemId: id,
              kind: 'question',
              summary: `→ ${resolved.agentId}`,
            })
          }
          questionAsked = true
        }
      }

      if (gateOpened) {
        // Suspended at a gate — provider process is dead (claude-cli kill); re-derive occupancy.
        deps.reconcile(wi.agentId)
        return
      }
      if (questionAsked) {
        // Suspended waiting for an agent answer — provider process is dead; re-derive occupancy.
        deps.reconcile(wi.agentId)
        return
      }
      const current = await store.getWorkItem(id)
      if (current && current.phase === 'terminal') {
        // A concurrent cancel/settle already finalized this item — do not override it.
        deps.reconcile(wi.agentId)
        return
      }
      await deps.settle(id, 'finish', null)
      deps.activity?.record({
        ts: Date.now(),
        workflowId: wi.workflowId,
        agentId: wi.agentId,
        workItemId: id,
        kind: 'finished',
        summary: 'finished',
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await store.setError(id, message)
      await deps.settle(id, 'fail', null, { error: message }).catch(() => {})
      deps.activity?.record({
        ts: Date.now(),
        workflowId: wi.workflowId,
        agentId: wi.agentId,
        workItemId: id,
        kind: 'error',
        summary: message.slice(0, 80),
      })
    } finally {
      live.delete(id)
    }
  }

  return {
    async run(id) {
      const wi = await store.getWorkItem(id)
      if (!wi) return
      const runtime = deps.resolveAgent(wi.agentId)
      if (!runtime) {
        // The row is already `active` (the pool flipped it via activate before run()); settle
        // does the fail transition + publish + reconcile.
        await store.setError(id, `no runtime for agent ${wi.agentId}`)
        await deps
          .settle(id, 'fail', null, { error: `no runtime for agent ${wi.agentId}` })
          .catch(() => {})
        return
      }

      // The pool OWNS the queued→active flip (via injected activate) BEFORE run() — the row is
      // already `active`. Do NOT transition('start') again (illegal from active). A defensive
      // re-publish of the live phase is fine.
      publishStatus(id, 'active')
      deps.activity?.record({
        ts: Date.now(),
        workflowId: wi.workflowId,
        agentId: wi.agentId,
        workItemId: id,
        kind: 'running',
        summary: `running ${wi.agentId}`,
      })
      const input = buildInput(wi)
      await store.setRunId(id, input.runId)
      await consume(id, { ...wi, runId: input.runId }, runtime, runtime.provider.run(input))
    },

    async resume(id, payload) {
      const wi = await store.getWorkItem(id)
      if (!wi) return
      const runtime = deps.resolveAgent(wi.agentId)
      if (!runtime) {
        await store.setError(id, `no runtime for agent ${wi.agentId}`)
        return
      }

      // Shared outcome handler: given a ResumeOutcome, append a message event (message mode),
      // settle silently (null mode), or spawn the provider (prompt mode). Both the gate arm and
      // the answer arm converge here — the three-way logic lives in exactly one place.
      const applyOutcome = async (outcome: ResumeOutcome): Promise<void> => {
        if (!outcome) {
          // null mode — clean silent finish: no turn, no event, no provider call.
          await deps.settle(id, 'finish', null)
          return
        }

        if (outcome.kind === 'message') {
          // Server appends the verbatim canned line — NO provider spawn, no LLM round-trip.
          // Uses the exact same appendTrace/bus.publish seam that consume() uses,
          // so foldEventsToMessages renders it as a normal assistant text bubble.
          const seq = await store.countTrace(id)
          const event = {
            type: EventType.TEXT_MESSAGE_CHUNK,
            role: 'assistant',
            messageId: randomUUID(),
            delta: outcome.text,
          } as unknown as BaseEvent
          await store.appendTrace(id, seq, event)
          bus.publish(`workitem:${id}`, { seq, event })
          await deps.settle(id, 'finish', null)
          return
        }

        // prompt mode — consume the provider's resume stream.
        if (!runtime.provider.resume) {
          await store.setError(id, 'provider has no resume')
          return
        }
        const input = buildInput(wi)
        const handle = { runId: wi.runId ?? input.runId, input }
        await consume(id, wi, runtime, runtime.provider.resume(handle, payload))
      }

      if (payload.kind === 'answer') {
        // Answer-resume: no gate to resolve, no gate transition. The asker was suspended in
        // awaiting_agent; answered (awaiting_agent→active) is the correct edge.
        await transition(db, id, 'answered')
        publishStatus(id, 'active')
        deps.reconcile(wi.agentId)

        const outcome: ResumeOutcome = runtime.buildResumeFromAnswer?.(payload.answers) ?? null
        await applyOutcome(outcome)
        return
      }

      // Gate-resume path (payload.kind === 'gate' or omitted — backward-compat).
      const resolution = payload
      const gate = await store.getOpenGate(id)
      if (gate) {
        // resolvedBy stays null: the bearer token (7c-C) authorises but is a single SHARED
        // secret with no per-user identity. Per-identity attribution needs real auth (post-beta).
        await store.resolveGateRow(gate.id, { comment: resolution.comment, form: resolution.form })
      }

      // Resume (awaiting_human→active) is its OWN edge, distinct from pool admission. Keep the
      // raw transition here, then re-derive pool occupancy (no resumeAcquire counter anymore).
      await transition(db, id, 'resume')
      publishStatus(id, 'active')
      deps.reconcile(wi.agentId)

      // Branch on the ResumeOutcome so the SERVER (not the provider) decides how to resume.
      // buildResume is carried on the runtime (wired at buildAgent time).
      // Absent → null (no-approval agents silently settle; they should never reach resume).
      const args = resolution.form ?? {}
      const outcome: ResumeOutcome = runtime.buildResume?.(args, resolution.executedResult) ?? null
      await applyOutcome(outcome)
    },

    cancel(id) {
      // Interrupt a live stream: return() the iterator → provider generator finally → kill.
      // Status transition + slot release are the caller's (PipelineService.cancel) job;
      // here we only stop the executor. No-op if not currently running.
      const iterator = live.get(id)
      if (iterator?.return) void iterator.return(undefined).catch(() => {})
    },
  }
}
