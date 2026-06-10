import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import { readGateOpened, type GateOpenedValue } from './gate.js'
import type { Provider, ResumeHandle, GateResolution } from './providers.js'

// The fixture a provider supplies so the generic checks can drive it. `turn1Input` must be a
// fresh run that reaches the agent's approval tool; `approved`/`rejected` are the resume calls.
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
      assert(s.approvalNames.includes(gates[0].toolName), `gate toolName "${gates[0].toolName}" is not an approval`)
      const startIds = events
        .filter((e) => e.type === EventType.TOOL_CALL_START)
        .map((e) => (e as unknown as { toolCallId: string }).toolCallId)
      assert(startIds.includes(gates[0].toolCallId), 'gate toolCallId has no matching TOOL_CALL_START')
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
    },
  },
  {
    name: 'only surfaced tools appear as tool calls on turn 1',
    async run(makeProvider, s) {
      const events = await collect(makeProvider().run(s.turn1Input))
      const names = events
        .filter((e) => e.type === EventType.TOOL_CALL_START)
        .map((e) => (e as unknown as { toolCallName: string }).toolCallName)
      for (const n of names) assert(s.surfaceTools.includes(n), `surfaced an undeclared tool: "${n}"`)
    },
  },
]
