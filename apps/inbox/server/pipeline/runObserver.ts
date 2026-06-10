import { randomUUID } from 'node:crypto'
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import { encodeHandoff, readGateOpened, type GateResolution, type Provider } from '@platform/core'
import type { Db } from './db/client.js'
import type { StateStore } from './stateStore.js'
import type { WorkerPool } from './workerPool.js'
import type { EventBus } from './eventBus.js'
import { transition } from './transition.js'
import type { WorkItem } from './db/schema.js'

// The server-side consumer of a provider run — runs for EVERY dispatch, browser or not
// (spec §1.5). Appends Trace, reacts to GATE_OPENED (insert Gate + transition + suspend),
// fills the card from a registered render tool, finalizes status, and republishes every
// event on the per-WorkItem bus topic for any attached SSE viewer.

export interface AgentRuntime {
  provider: Provider
  renderToolNames: string[]
  // The agent passport's maxInstances — the per-agent concurrency cap (defineAgent default 2).
  maxInstances: number
}

export interface RunObserverDeps {
  db: Db
  store: StateStore
  pool: WorkerPool
  bus: EventBus
  resolveAgent: (agentId: string) => AgentRuntime | undefined
}

export interface RunObserver {
  run(id: string): Promise<void>
  resume(id: string, resolution: GateResolution): Promise<void>
}

type ToolEvent = BaseEvent & {
  toolCallId?: string
  toolCallName?: string
  delta?: string
}

export function makeRunObserver(deps: RunObserverDeps): RunObserver {
  const { db, store, pool, bus } = deps

  const publishStatus = (id: string, status: string): void => {
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
    // Accumulate render-tool-call args to fill the card on TOOL_CALL_END.
    const openCalls = new Map<string, { name: string; args: string }>()

    try {
      for await (const event of iterable) {
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
          publishStatus(id, 'awaiting_approval')
          gateOpened = true
        }
      }

      if (gateOpened) {
        // Suspended at a gate — the provider process is dead (claude-cli kill), free the slot.
        pool.release(wi.agentId)
        return
      }
      await transition(db, id, 'finish')
      const final = (await store.getWorkItem(id))?.status ?? 'finished'
      publishStatus(id, final)
      pool.release(wi.agentId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await transition(db, id, 'fail', { error: message }).catch(() => {})
      await store.setError(id, message)
      publishStatus(id, 'error')
      pool.release(wi.agentId)
    }
  }

  return {
    async run(id) {
      const wi = await store.getWorkItem(id)
      if (!wi) return
      const runtime = deps.resolveAgent(wi.agentId)
      if (!runtime) {
        await transition(db, id, 'start').catch(() => {})
        await transition(db, id, 'fail', { error: `no runtime for agent ${wi.agentId}` }).catch(
          () => {}
        )
        await store.setError(id, `no runtime for agent ${wi.agentId}`)
        publishStatus(id, 'error')
        pool.release(wi.agentId)
        return
      }

      await transition(db, id, 'start')
      publishStatus(id, 'running')
      const input = buildInput(wi)
      await store.setRunId(id, input.runId)
      await consume(id, { ...wi, runId: input.runId }, runtime, runtime.provider.run(input))
    },

    async resume(id, resolution) {
      const wi = await store.getWorkItem(id)
      if (!wi) return
      const runtime = deps.resolveAgent(wi.agentId)
      if (!runtime?.provider.resume) {
        await store.setError(id, 'provider has no resume')
        return
      }

      const gate = await store.getOpenGate(id)
      if (gate) {
        // resolvedBy comes from the bearer-token identity at step 4; null in the dev path.
        await store.resolveGateRow(gate.id, { comment: resolution.comment, form: resolution.form })
      }

      await transition(db, id, 'resume')
      publishStatus(id, 'running')
      pool.resumeAcquire(id, wi.agentId)

      const input = buildInput(wi)
      const handle = { runId: wi.runId ?? input.runId, input }
      await consume(id, wi, runtime, runtime.provider.resume(handle, resolution))
    },
  }
}
