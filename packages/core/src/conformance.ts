import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import { readGateOpened, type GateOpenedValue } from './gate.js'
import type { Provider, ResumeHandle, GateResolution } from './providers.js'

// The fixture a provider supplies so the generic checks can drive it. `turn1Input` must be a
// fresh run that reaches the agent's approval tool; `approved`/`rejected` are the resume calls.
// Note: `approved.handle`/`rejected.handle` are pre-built fixtures — their `runId`/`input` stand
// in for what a real turn-1 run would have produced (the checks don't thread turn-1's output
// into resume). A provider that ignores the handle on resume (e.g. claude-cli re-primes from the
// resolution) needs only a well-formed handle here, not one correlated to a live run.
export interface ConformanceScenario {
  approvalNames: readonly string[]
  surfaceTools: readonly string[]
  turn1Input: RunAgentInput
  approved: { handle: ResumeHandle; resolution: GateResolution }
  rejected: { handle: ResumeHandle; resolution: GateResolution }
}

// A single named invariant. `run` throws on failure (so vitest reports it as that test failing).
export interface ConformanceCheck {
  name: string
  run(makeProvider: () => Provider, scenario: ConformanceScenario): Promise<void>
}

async function collect(it: AsyncIterable<BaseEvent>): Promise<BaseEvent[]> {
  const out: BaseEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

function gatesOf(events: readonly BaseEvent[]): GateOpenedValue[] {
  const out: GateOpenedValue[] = []
  for (const e of events) {
    const g = readGateOpened(e)
    if (g) out.push(g)
  }
  return out
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`conformance: ${msg}`)
}

// The provider-agnostic invariants of the v2 contract. Note: the "contiguous text shares one
// messageId" guard is NOT here — it is a claude-stream-specific concern (the mock emits one
// chunk per message), covered by claude-stream's own unit tests.
export const providerConformanceChecks: ConformanceCheck[] = [
  {
    name: 'turn 1 opens exactly one approval gate matching an approval tool',
    async run(makeProvider, s) {
      const events = await collect(makeProvider().run(s.turn1Input))
      const gates = gatesOf(events)
      assert(gates.length === 1, `expected 1 GATE_OPENED, got ${gates.length}`)
      assert(
        s.approvalNames.includes(gates[0].toolName),
        `gate toolName "${gates[0].toolName}" is not an approval`
      )
      const startIds = events
        .filter((e) => e.type === EventType.TOOL_CALL_START)
        .map((e) => (e as unknown as { toolCallId: string }).toolCallId)
      assert(
        startIds.includes(gates[0].toolCallId),
        'gate toolCallId has no matching TOOL_CALL_START'
      )
    },
  },
  {
    name: 'resume(approved) completes and re-opens no gate',
    async run(makeProvider, s) {
      const p = makeProvider()
      assert(typeof p.resume === 'function', 'provider does not implement resume()')
      const events = await collect(p.resume!(s.approved.handle, s.approved.resolution))
      assert(gatesOf(events).length === 0, 'resume(approved) re-opened a gate')
      assert(events.length > 0, 'resume(approved) produced no events')
    },
  },
  {
    name: 'resume(rejected) terminates and re-opens no gate',
    async run(makeProvider, s) {
      const p = makeProvider()
      assert(typeof p.resume === 'function', 'provider does not implement resume()')
      const events = await collect(p.resume!(s.rejected.handle, s.rejected.resolution))
      assert(gatesOf(events).length === 0, 'resume(rejected) re-opened a gate')
      // Rejection must still terminate with at least a closing event (a note/RUN_FINISHED) —
      // a silent empty stream is indistinguishable from "resume did nothing". Symmetric with
      // the approved check; both real providers emit a closing chunk on reject.
      assert(events.length > 0, 'resume(rejected) produced no events')
      // No effect-shaped continuation (spec §3.3 #3): a rejected resume must not call tools.
      // TOOL_CALL_START is the provider-agnostic proxy for "an effect was attempted" — a future
      // provider that fired an action on reject would emit one and fail here.
      const toolCalls = events.filter((e) => e.type === EventType.TOOL_CALL_START)
      assert(toolCalls.length === 0, 'resume(rejected) emitted a tool call (possible effect)')
    },
  },
  {
    name: 'only surfaced tools appear as tool calls on turn 1',
    async run(makeProvider, s) {
      const events = await collect(makeProvider().run(s.turn1Input))
      const names = events
        .filter((e) => e.type === EventType.TOOL_CALL_START)
        .map((e) => (e as unknown as { toolCallName: string }).toolCallName)
      for (const n of names)
        assert(s.surfaceTools.includes(n), `surfaced an undeclared tool: "${n}"`)
    },
  },
  {
    name: 'every TOOL_CALL_START on turn 1 has a matching TOOL_CALL_END with the same toolCallId',
    async run(makeProvider, s) {
      const events = await collect(makeProvider().run(s.turn1Input))
      const startIds = events
        .filter((e) => e.type === EventType.TOOL_CALL_START)
        .map((e) => (e as unknown as { toolCallId: string }).toolCallId)
      const endIds = new Set(
        events
          .filter((e) => e.type === EventType.TOOL_CALL_END)
          .map((e) => (e as unknown as { toolCallId: string }).toolCallId)
      )
      for (const id of startIds)
        assert(endIds.has(id), `TOOL_CALL_START id "${id}" has no matching TOOL_CALL_END`)
    },
  },
]
