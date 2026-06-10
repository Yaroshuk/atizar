# Provider Contract v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit `resume?()` capability and a provider-agnostic `GATE_OPENED` signal to the `Provider` contract, plus a conformance suite, in `@platform/core` + `@platform/providers` — additively, without disturbing the live `@copilotkit` client.

**Architecture:** `run(input)` stays back-compatible (still detects resume from message history). We add (1) `resume?(handle, resolution)` to the `Provider` interface; (2) a `GATE_OPENED` AG-UI `CUSTOM` event emitted by `claude-stream` at the approval suspend point; (3) a `runProviderConformance` check-set in core, exercised against the mock and `claude-cli` (fake spawn). `resume()` has no production caller yet — the conformance suite is its contract test (this is beta build order step 1, intentionally ahead of the server spine). Record/replay, the server, the client, and Mastra are untouched.

**Tech Stack:** TypeScript, AG-UI (`@ag-ui/client` events), zod v3, vitest, yarn-classic workspaces.

**Spec:** `docs/superpowers/specs/2026-06-10-provider-contract-v2-design.md`

---

## File Structure

- **Create** `packages/core/src/gate.ts` — `GATE_OPENED` const, `GateOpenedValueSchema`/`GateOpenedValue`, `gateOpened()` builder, `readGateOpened()` reader.
- **Create** `packages/core/src/gate.test.ts` — round-trip + zod rejection tests.
- **Modify** `packages/core/src/providers.ts` — add `ResumeHandle`, `GateResolution`, optional `Provider.resume?`.
- **Create** `packages/core/src/conformance.ts` — `ConformanceScenario`, `ConformanceCheck`, `providerConformanceChecks`.
- **Modify** `packages/core/src/index.ts` — export `./gate.js` and `./conformance.js`.
- **Modify** `packages/providers/src/claude-stream.ts` — emit `GATE_OPENED` at both approval return points; accumulate approval-tool args for `proposedArtifact`.
- **Modify** `packages/providers/src/claude-stream.test.ts` — assert `GATE_OPENED` emission (both paths).
- **Modify** `packages/providers/src/claude-cli-provider.ts` — extract `primeAndStream` helper; implement `resume()`.
- **Modify** `packages/providers/src/claude-cli-provider.test.ts` — `resume()` tests + conformance run.
- **Modify** `packages/providers/src/mock-provider.ts` — emit `GATE_OPENED` on turn 1; implement `resume()`.
- **Modify** `packages/providers/src/mock-provider.test.ts` — conformance run + `resume()` test.

---

## Task 0: Branch

- [ ] **Step 1: Create the feature branch**

We are on `master` (the default branch); per project rules, branch before any work.

Run:
```bash
git checkout -b feat/provider-contract-v2
git rev-parse --abbrev-ref HEAD
```
Expected: prints `feat/provider-contract-v2`.

---

## Task 1: Core — `GATE_OPENED` gate signal

**Files:**
- Create: `packages/core/src/gate.ts`
- Test: `packages/core/src/gate.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/gate.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { EventType, type BaseEvent } from '@ag-ui/client'
import { GATE_OPENED, gateOpened, readGateOpened, type GateOpenedValue } from './gate.js'

const value: GateOpenedValue = {
  gateKind: 'approval',
  toolName: 'saveDraft',
  toolCallId: 'tc_1',
  proposedArtifact: { threadId: 't_1', body: 'Hello' },
}

describe('gateOpened / readGateOpened', () => {
  it('builds a CUSTOM event named GATE_OPENED carrying the value', () => {
    const ev = gateOpened(value) as unknown as { type: string; name: string; value: unknown }
    expect(ev.type).toBe(EventType.CUSTOM)
    expect(ev.name).toBe(GATE_OPENED)
    expect(ev.value).toEqual(value)
  })

  it('round-trips through readGateOpened', () => {
    expect(readGateOpened(gateOpened(value))).toEqual(value)
  })

  it('returns null for a non-gate event', () => {
    const other = { type: EventType.TEXT_MESSAGE_CHUNK, role: 'assistant', messageId: 'm', delta: 'hi' }
    expect(readGateOpened(other as unknown as BaseEvent)).toBeNull()
  })

  it('returns null for a CUSTOM event with a different name', () => {
    const ev = { type: EventType.CUSTOM, name: 'SOMETHING_ELSE', value: {} }
    expect(readGateOpened(ev as unknown as BaseEvent)).toBeNull()
  })

  it('returns null when the value fails schema validation', () => {
    const bad = { type: EventType.CUSTOM, name: GATE_OPENED, value: { gateKind: 'approval' } }
    expect(readGateOpened(bad as unknown as BaseEvent)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn vitest run packages/core/src/gate.test.ts`
Expected: FAIL — cannot resolve `./gate.js` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/gate.ts`:
```ts
import { EventType, type BaseEvent } from '@ag-ui/client'
import { z } from 'zod'

// A provider-agnostic "a human gate just opened" signal, carried as an AG-UI CUSTOM
// event so it stays inside the AG-UI vocabulary, survives record/replay as an ordinary
// BaseEvent, and is ignored by consumers that don't know it. The provider emits it at
// the suspend point; the server (later) turns it into a Gate record.
export const GATE_OPENED = 'GATE_OPENED' as const

// CUSTOM.value is `any` on the wire; we own and validate this shape. It carries only
// what the consumer does NOT otherwise have — NOT the resume handle (the orchestrator
// builds that from the { runId, input } it already holds).
export const GateOpenedValueSchema = z.object({
  gateKind: z.literal('approval'), // only 'approval' in the beta; the field reserves the axis
  toolName: z.string(), // the approval tool that opened the gate
  toolCallId: z.string(), // correlates with the TOOL_CALL_* events of the same call
  proposedArtifact: z.record(z.unknown()), // the approval tool's args = the agent's proposal
})
export type GateOpenedValue = z.infer<typeof GateOpenedValueSchema>

// Build the BaseEvent so providers don't hand-roll the CUSTOM envelope.
export function gateOpened(value: GateOpenedValue): BaseEvent {
  return { type: EventType.CUSTOM, name: GATE_OPENED, value } as BaseEvent
}

// Recognize + parse a gate signal from any BaseEvent. Returns null for non-gate events
// AND for a malformed payload (so a bad value never reaches a consumer as a "valid" gate).
export function readGateOpened(event: BaseEvent): GateOpenedValue | null {
  const e = event as { type?: string; name?: string; value?: unknown }
  if (e.type !== EventType.CUSTOM || e.name !== GATE_OPENED) return null
  const parsed = GateOpenedValueSchema.safeParse(e.value)
  return parsed.success ? parsed.data : null
}
```

- [ ] **Step 4: Export from the package index**

Modify `packages/core/src/index.ts` — add the gate export after the providers export:
```ts
export * from './messages.js'
export * from './defineAgent.js'
export * from './providers.js'
export * from './gate.js'
export * from './handoff.js'
export * from './defineWorkflow.js'
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn vitest run packages/core/src/gate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/gate.ts packages/core/src/gate.test.ts packages/core/src/index.ts
git commit -m "feat(core): GATE_OPENED signal (AG-UI CUSTOM event) + helpers"
```

---

## Task 2: Core — `resume?` contract types

**Files:**
- Modify: `packages/core/src/providers.ts`
- Test: `packages/core/src/providers.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/providers.test.ts` (append inside the file, after the existing `describe`):
```ts
import type { Provider, ResumeHandle, GateResolution } from './providers.js'

describe('Provider v2 contract types', () => {
  it('allows a provider that implements optional resume()', async () => {
    const handle: ResumeHandle = { runId: 'r1', input: { messages: [] } as never }
    const resolution: GateResolution = { gateId: 'g1', decision: 'approved', form: { body: 'x' } }
    const provider: Provider = {
      // eslint-disable-next-line require-yield
      async *run() {
        return
      },
      async *resume(h: ResumeHandle, r: GateResolution) {
        expect(h.runId).toBe('r1')
        expect(r.decision).toBe('approved')
      },
    }
    // resume is optional but present here — drain it to prove the shape compiles + runs
    for await (const _ of provider.resume!(handle, resolution)) void _
    expect(typeof provider.resume).toBe('function')
  })

  it('allows a provider WITHOUT resume() (back-compat)', () => {
    const provider: Provider = {
      // eslint-disable-next-line require-yield
      async *run() {
        return
      },
    }
    expect(provider.resume).toBeUndefined()
  })
})
```
Note: the existing `import { defineProviders, type ProviderFactory } from './providers.js'` line at the top of the file stays; add the `Provider, ResumeHandle, GateResolution` type import alongside it (merge into the existing import or add a new `import type` line).

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn vitest run packages/core/src/providers.test.ts`
Expected: FAIL — `ResumeHandle` / `GateResolution` are not exported; `resume` not on `Provider`.

- [ ] **Step 3: Write the implementation**

Modify `packages/core/src/providers.ts` — replace the `Provider` interface (lines 3-6) and add the two new types directly below it:
```ts
import type { RunAgentInput, BaseEvent } from '@ag-ui/client'

// A provider is the model/runtime seam: given the run input it yields AG-UI events.
export interface Provider {
  run(input: RunAgentInput): AsyncIterable<BaseEvent>
  // Optional v2 capability: resume a run that suspended at a gate. The provider OWNS the
  // resume mechanics (the orchestrator never hard-codes re-prime): claude-cli implements it
  // as kill-and-re-prime from the transcript + the verbatim approved artifact; Mastra (later)
  // resumes natively by runId against its own snapshot store. Absent ⇒ no resume capability.
  resume?(handle: ResumeHandle, resolution: GateResolution): AsyncIterable<BaseEvent>
}

// What the orchestrator hands back to resume a suspended run. Both fields are always present;
// each provider reads the slice it needs. claude-cli re-primes from `input` + the resolution;
// Mastra resumes by `runId` and ignores `input`. A transparent struct (not an opaque token) so
// a stateless provider, which has no live process to hold a token against, still has the
// transcript. A private token can be added as an optional field later without breaking callers.
export interface ResumeHandle {
  runId: string
  input: RunAgentInput
}

// The human's decision at a gate. `form` is the approved/edited artifact (byte-verbatim — it
// becomes the effect arguments at step 4); `comment` seeds the future revise loop.
export interface GateResolution {
  gateId: string
  decision: 'approved' | 'rejected'
  form?: Record<string, unknown>
  comment?: string
}
```
Leave the rest of the file (`PromptStrategy`, `ProviderConfig`, `ProviderFactory`, `ProviderRegistry`, `defineProviders`) unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn vitest run packages/core/src/providers.test.ts`
Expected: PASS (existing 2 + new 2 = 4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/providers.ts packages/core/src/providers.test.ts
git commit -m "feat(core): optional Provider.resume() + ResumeHandle/GateResolution"
```

---

## Task 3: Core — conformance suite

**Files:**
- Create: `packages/core/src/conformance.ts`
- Modify: `packages/core/src/index.ts`

This task defines the suite. It is *exercised* by the provider tests in Tasks 5 and 6 (the suite needs a concrete provider to run against). No standalone test file here — a self-test would just re-implement a mock provider.

- [ ] **Step 1: Write the implementation**

Create `packages/core/src/conformance.ts`:
```ts
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
```

- [ ] **Step 2: Export from the package index**

Modify `packages/core/src/index.ts` — add the conformance export at the end:
```ts
export * from './messages.js'
export * from './defineAgent.js'
export * from './providers.js'
export * from './gate.js'
export * from './handoff.js'
export * from './defineWorkflow.js'
export * from './conformance.js'
```

- [ ] **Step 3: Verify it compiles**

Run: `yarn typecheck`
Expected: PASS (no errors). The suite has no test of its own yet — Tasks 5 and 6 run it.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/conformance.ts packages/core/src/index.ts
git commit -m "feat(core): provider conformance check-set (GATE_OPENED + resume invariants)"
```

---

## Task 4: Providers — `claude-stream` emits `GATE_OPENED`

**Files:**
- Modify: `packages/providers/src/claude-stream.ts`
- Test: `packages/providers/src/claude-stream.test.ts`

`claude-stream` returns at two approval suspend points (the complete-message path and the streaming `content_block_stop` path). Both must emit `GATE_OPENED` first. The complete-message path has the full args object (`b.input`); the streaming path must accumulate the args deltas, so we add an `argsBuf` to the tracked block.

- [ ] **Step 1: Write the failing tests**

Add to `packages/providers/src/claude-stream.test.ts` a new `describe` block (keep existing tests). First check the top of the file for the existing line helpers (`textDelta`, `toolStart`, `toolArgs`, `stop`, and how `mapClaudeStream` is driven); reuse them. If the file lacks a streaming-args helper, the inline lines below are self-contained:
```ts
import { readGateOpened } from '@platform/core'

describe('mapClaudeStream — GATE_OPENED', () => {
  async function drain(it: AsyncIterable<any>) {
    const out: any[] = []
    for await (const e of it) out.push(e)
    return out
  }

  it('emits GATE_OPENED after the approval tool on the STREAMING path', async () => {
    async function* lines() {
      yield JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'tc_ok', name: 'mcp__inbox__saveDraft', input: {} },
        },
      })
      yield JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"threadId":"t_1",' } },
      })
      yield JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"body":"Hi"}' } },
      })
      yield JSON.stringify({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } })
    }
    const out = await drain(mapClaudeStream(lines(), { approvalNames: ['saveDraft'], surfaceTools: ['saveDraft'] }))
    const gate = out.map(readGateOpened).find(Boolean)
    expect(gate).toEqual({
      gateKind: 'approval',
      toolName: 'saveDraft',
      toolCallId: 'tc_ok',
      proposedArtifact: { threadId: 't_1', body: 'Hi' },
    })
    // gate is the LAST event (suspend point) — nothing after it
    expect(readGateOpened(out.at(-1))).not.toBeNull()
  })

  it('emits GATE_OPENED after the approval tool on the COMPLETE-MESSAGE path', async () => {
    async function* lines() {
      yield JSON.stringify({
        type: 'assistant',
        message: {
          model: 'claude',
          content: [
            { type: 'tool_use', id: 'tc_c', name: 'mcp__inbox__saveDraft', input: { threadId: 't_2', body: 'Yo' } },
          ],
        },
      })
    }
    const out = await drain(mapClaudeStream(lines(), { approvalNames: ['saveDraft'], surfaceTools: ['saveDraft'] }))
    const gate = out.map(readGateOpened).find(Boolean)
    expect(gate).toEqual({
      gateKind: 'approval',
      toolName: 'saveDraft',
      toolCallId: 'tc_c',
      proposedArtifact: { threadId: 't_2', body: 'Yo' },
    })
  })

  it('emits NO GATE_OPENED for a non-approval tool', async () => {
    async function* lines() {
      yield JSON.stringify({
        type: 'assistant',
        message: { model: 'claude', content: [{ type: 'tool_use', id: 'tc_r', name: 'mcp__inbox__renderLead', input: { id: 1 } }] },
      })
    }
    const out = await drain(mapClaudeStream(lines(), { approvalNames: ['saveDraft'], surfaceTools: ['renderLead'] }))
    expect(out.map(readGateOpened).find(Boolean)).toBeUndefined()
  })
})
```
Ensure `mapClaudeStream` is imported at the top of the test file (it is already used by existing tests; reuse that import).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn vitest run packages/providers/src/claude-stream.test.ts`
Expected: FAIL — no `GATE_OPENED` event is emitted (the two new "emits GATE_OPENED" tests fail; the "NO GATE_OPENED" test passes trivially).

- [ ] **Step 3: Implement — import the helper and emit on both paths**

In `packages/providers/src/claude-stream.ts`:

(a) Add the import at the top (after the existing `@ag-ui/client` import):
```ts
import { gateOpened, type GateOpenedValue } from '@platform/core'
```

(b) Extend `ToolBlock` to accumulate args (line 36):
```ts
type ToolBlock = { id: string; name: string; sawArgs: boolean; startInput: unknown; argsBuf: string }
```

(c) When creating a block in the streaming `content_block_start` path (around line 214), initialize `argsBuf`:
```ts
      blocks.set(index, { id, name, sawArgs: false, startInput: ev.content_block.input, argsBuf: '' })
```

(d) In the `input_json_delta` branch (around line 232-241), append to `argsBuf`:
```ts
      if (ev.delta?.type === 'input_json_delta' && typeof ev.delta.partial_json === 'string') {
        const block = blocks.get(index)
        if (block) {
          block.sawArgs = true
          block.argsBuf += ev.delta.partial_json
          yield {
            type: EventType.TOOL_CALL_ARGS,
            toolCallId: block.id,
            delta: ev.delta.partial_json,
          } as BaseEvent
        }
        continue
      }
```

(e) Add a helper near `isApproval` (after line 110) that parses an args source into a record:
```ts
  function parseArtifact(raw: unknown): Record<string, unknown> {
    if (typeof raw === 'string') {
      try {
        const v = JSON.parse(raw)
        return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
      } catch {
        return {}
      }
    }
    if (raw && typeof raw === 'object') return raw as Record<string, unknown>
    return {}
  }
  function gateFor(toolName: string, toolCallId: string, artifact: Record<string, unknown>): BaseEvent {
    const value: GateOpenedValue = { gateKind: 'approval', toolName, toolCallId, proposedArtifact: artifact }
    return gateOpened(value)
  }
```

(f) Complete-message path — replace the `if (isApproval(b.name ?? '')) return` block (around line 163-164):
```ts
          yield* emitToolCall(b.id, b.name ?? '', argsJson)
          if (isApproval(b.name ?? '')) {
            yield gateFor(stripMcpPrefix(b.name ?? ''), b.id, parseArtifact(b.input))
            return
          }
```

(g) Streaming `content_block_stop` path — replace the final approval return (around line 264):
```ts
      yield { type: EventType.TOOL_CALL_END, toolCallId: block.id } as BaseEvent
      const stoppedBlock = block
      blocks.delete(index)
      if (opts.approvalNames.includes(stoppedBlock.name)) {
        const artifact = parseArtifact(stoppedBlock.argsBuf || stoppedBlock.startInput)
        yield gateFor(stoppedBlock.name, stoppedBlock.id, artifact)
        return
      }
      continue
```
(Note: `stoppedBlock.name` is already the stripped name — `content_block_start` stored `stripMcpPrefix(...)`. The complete-message path stores the raw `b.name`, hence `stripMcpPrefix` there in (f).)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn vitest run packages/providers/src/claude-stream.test.ts`
Expected: PASS (all existing tests + 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/claude-stream.ts packages/providers/src/claude-stream.test.ts
git commit -m "feat(providers): claude-stream emits GATE_OPENED at the approval suspend point"
```

---

## Task 5: Providers — `mock-provider` gate + `resume()` + conformance

**Files:**
- Modify: `packages/providers/src/mock-provider.ts`
- Test: `packages/providers/src/mock-provider.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/providers/src/mock-provider.test.ts`:
```ts
import { providerConformanceChecks, type ConformanceScenario } from '@platform/core'
import type { RunAgentInput } from '@ag-ui/client'

const resolvedMessages = [
  {
    role: 'assistant',
    toolCalls: [
      { id: 'tc_ok', type: 'function', function: { name: 'saveDraft', arguments: '{"threadId":"t","body":"b"}' } },
    ],
  },
  { role: 'tool', toolCallId: 'tc_ok', content: 'approved' },
]

const scenario: ConformanceScenario = {
  approvalNames: ['saveDraft'],
  surfaceTools: ['renderLead', 'saveDraft'],
  turn1Input: { messages: [] } as unknown as RunAgentInput,
  approved: {
    handle: { runId: 'r1', input: { messages: resolvedMessages } as unknown as RunAgentInput },
    resolution: { gateId: 'g1', decision: 'approved', form: { threadId: 't', body: 'b' } },
  },
  rejected: {
    handle: { runId: 'r1', input: { messages: resolvedMessages } as unknown as RunAgentInput },
    resolution: { gateId: 'g1', decision: 'rejected' },
  },
}

describe('mock-provider conformance', () => {
  for (const check of providerConformanceChecks) {
    it(check.name, () => check.run(() => createMockInboxProvider(['saveDraft']), scenario))
  }
})
```
Ensure `createMockInboxProvider` is imported at the top of the file (existing tests already import it; reuse that import).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn vitest run packages/providers/src/mock-provider.test.ts`
Expected: FAIL — the mock emits no `GATE_OPENED` on turn 1 (check 1 fails) and has no `resume()` (checks 2 & 3 fail).

- [ ] **Step 3: Implement — emit GATE_OPENED on turn 1 and add resume()**

Rewrite `packages/providers/src/mock-provider.ts` to:
```ts
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import {
  approvalResolved,
  gateOpened,
  type GateResolution,
  type Provider,
  type ResumeHandle,
  type Message,
} from '@platform/core'

const LEAD = {
  from: 'ivan@acme.ru',
  subject: 'Order: 10 units',
  summary: 'Customer wants to order 10 units; asks about delivery time.',
}

const DRAFT = { threadId: 'thread_demo', body: 'Thanks for reaching out — here is a reply.' }

function textChunk(delta: string): BaseEvent {
  return {
    type: EventType.TEXT_MESSAGE_CHUNK,
    role: 'assistant',
    messageId: crypto.randomUUID(),
    delta,
  } as BaseEvent
}

// Yields the tool-call events and RETURNS the toolCallId (so run() can reference it in the
// GATE_OPENED event). `yield* toolCall(...)` evaluates to that returned id.
async function* toolCall(name: string, args: Record<string, unknown>): AsyncGenerator<BaseEvent, string> {
  const toolCallId = crypto.randomUUID()
  yield {
    type: EventType.TOOL_CALL_START,
    parentMessageId: crypto.randomUUID(),
    toolCallId,
    toolCallName: name,
  } as BaseEvent
  yield { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: JSON.stringify(args) } as BaseEvent
  yield { type: EventType.TOOL_CALL_END, toolCallId } as BaseEvent
  return toolCallId
}

// The fake "model": turn 1 streams text → renderLead → saveDraft approval → GATE_OPENED
// (the suspend point). resume() emits the post-approval done text. `approvalNames` comes from
// the agent definition, not a hardcode. run() keeps the message-detected resume path for
// back-compat with the old client; resume() is the new explicit v2 path.
export function createMockInboxProvider(approvalNames: readonly string[]): Provider {
  return {
    async *run(runInput: RunAgentInput): AsyncIterable<BaseEvent> {
      const messages = (runInput?.messages ?? []) as Message[]

      if (approvalResolved(messages, approvalNames)) {
        yield textChunk('Draft saved to Gmail.')
        return
      }

      yield textChunk('Checking inbox… found a lead.')
      yield* toolCall('renderLead', LEAD)
      const saveDraftId = yield* toolCall('saveDraft', DRAFT)
      yield gateOpened({
        gateKind: 'approval',
        toolName: 'saveDraft',
        toolCallId: saveDraftId,
        proposedArtifact: DRAFT,
      })
    },

    async *resume(_handle: ResumeHandle, resolution: GateResolution): AsyncIterable<BaseEvent> {
      if (resolution.decision === 'rejected') {
        yield textChunk('The human rejected the draft; nothing was saved.')
        return
      }
      yield textChunk('Draft saved to Gmail.')
    },
  }
}
```
Key change from today: `toolCall` now `return`s its `toolCallId` so `run()` can reference it in the `GATE_OPENED` event; the saveDraft call's id is captured and reused.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn vitest run packages/providers/src/mock-provider.test.ts`
Expected: PASS — existing mock tests + 4 conformance checks.

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/mock-provider.ts packages/providers/src/mock-provider.test.ts
git commit -m "feat(providers): mock emits GATE_OPENED + implements resume(); passes conformance"
```

---

## Task 6: Providers — `claude-cli-provider` `resume()` + conformance

**Files:**
- Modify: `packages/providers/src/claude-cli-provider.ts`
- Test: `packages/providers/src/claude-cli-provider.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/providers/src/claude-cli-provider.test.ts` (reuse the file's existing `createReplyPrompts`, `fakeSpawn`, `textDelta`, `toolStart`, `toolArgs`, `stop`, `runInput`, `drain` helpers):
```ts
import { providerConformanceChecks, type ConformanceScenario, type ResumeHandle, type GateResolution } from '@platform/core'

describe('createClaudeCliProvider — resume()', () => {
  const baseOpts = {
    approvalNames: ['saveDraft'] as const,
    surfaceTools: ['renderLead', 'saveDraft'] as const,
    allowedTools: ['mcp__inbox__renderLead', 'mcp__inbox__saveDraft', 'mcp__gmail__create_draft'] as const,
  }

  it('resume(approved) re-primes from resolution.form and streams done text', async () => {
    let seenPrompt = ''
    const spawn = (prompt: string) => {
      seenPrompt = prompt
      async function* lines() {
        yield textDelta('Draft saved to Gmail.')
      }
      return { lines: lines(), kill: () => {} }
    }
    const provider = createClaudeCliProvider({ ...baseOpts, prompts: createReplyPrompts('x'), spawn })
    const handle: ResumeHandle = { runId: 'r1', input: runInput([]) }
    const resolution: GateResolution = { gateId: 'g1', decision: 'approved', form: { threadId: 't_42', body: 'Hi Ivan' } }
    const out = await drain(provider.resume!(handle, resolution))
    expect(seenPrompt).toContain('t_42')
    expect(seenPrompt).toContain('Hi Ivan')
    expect(seenPrompt).toContain('APPROVED')
    expect(out[0]).toMatchObject({ delta: 'Draft saved to Gmail.' })
  })

  it('resume(rejected) yields a no-effect note and does NOT spawn', async () => {
    let spawned = false
    const spawn = () => {
      spawned = true
      async function* lines() {}
      return { lines: lines(), kill: () => {} }
    }
    const provider = createClaudeCliProvider({ ...baseOpts, prompts: createReplyPrompts('x'), spawn })
    const handle: ResumeHandle = { runId: 'r1', input: runInput([]) }
    const out = await drain(provider.resume!(handle, { gateId: 'g1', decision: 'rejected' }))
    expect(spawned).toBe(false)
    expect(out.some((e) => e.type === EventType.TEXT_MESSAGE_CHUNK && /reject/i.test(e.delta ?? ''))).toBe(true)
  })

  it('resume(approved) errors (no spawn) when no usable draft args exist', async () => {
    let spawned = false
    const spawn = () => {
      spawned = true
      async function* lines() {}
      return { lines: lines(), kill: () => {} }
    }
    const provider = createClaudeCliProvider({ ...baseOpts, prompts: createReplyPrompts('x'), spawn })
    const handle: ResumeHandle = { runId: 'r1', input: runInput([]) }
    const out = await drain(provider.resume!(handle, { gateId: 'g1', decision: 'approved', form: {} }))
    expect(spawned).toBe(false)
    expect(out.some((e) => /Resume failed/.test(e.delta ?? ''))).toBe(true)
  })
})

describe('createClaudeCliProvider conformance', () => {
  const scenario: ConformanceScenario = {
    approvalNames: ['saveDraft'],
    surfaceTools: ['renderLead', 'saveDraft'],
    turn1Input: runInput([]),
    approved: {
      handle: { runId: 'r1', input: runInput([]) },
      resolution: { gateId: 'g1', decision: 'approved', form: { threadId: 't_42', body: 'Hi Ivan' } },
    },
    rejected: {
      handle: { runId: 'r1', input: runInput([]) },
      resolution: { gateId: 'g1', decision: 'rejected' },
    },
  }
  const makeProvider = () =>
    createClaudeCliProvider({
      approvalNames: ['saveDraft'],
      surfaceTools: ['renderLead', 'saveDraft'],
      allowedTools: ['mcp__inbox__renderLead', 'mcp__inbox__saveDraft', 'mcp__gmail__create_draft'],
      prompts: createReplyPrompts('do it'),
      spawn: fakeSpawn([
        { when: (p) => /APPROVED/.test(p), lines: [textDelta('Draft saved to Gmail.')] },
        {
          when: () => true,
          lines: [
            textDelta('Checking inbox… found a lead.'),
            toolStart(0, 'tc_lead', 'mcp__inbox__renderLead'),
            toolArgs(0, '{"id":42}'),
            stop(0),
            toolStart(1, 'tc_ok', 'mcp__inbox__saveDraft'),
            toolArgs(1, '{"threadId":"t_42","body":"Hi"}'),
            stop(1),
          ],
        },
      ]).spawn,
    })
  for (const check of providerConformanceChecks) {
    it(check.name, () => check.run(makeProvider, scenario))
  }
})
```
Add the `EventType` import if not already present at the top of the test file (the existing tests import it from `@ag-ui/client`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn vitest run packages/providers/src/claude-cli-provider.test.ts`
Expected: FAIL — `provider.resume` is `undefined` (resume tests throw), conformance checks 2 & 3 fail.

- [ ] **Step 3: Implement — extract `primeAndStream`, add `resume()`**

Rewrite `packages/providers/src/claude-cli-provider.ts`:
```ts
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import {
  approvalResolved,
  lastApprovalArgs,
  type GateResolution,
  type Provider,
  type PromptStrategy,
  type ResumeHandle,
  type Message,
} from '@platform/core'
import { mapClaudeStream } from './claude-stream.js'

export type ClaudeSpawn = (
  prompt: string,
  allowedTools: readonly string[]
) => {
  lines: AsyncIterable<string>
  kill: () => void
}

function errorChunk(message: string): BaseEvent {
  return {
    type: EventType.TEXT_MESSAGE_CHUNK,
    role: 'assistant',
    messageId: crypto.randomUUID(),
    delta: `Provider error: ${message}`,
  } as BaseEvent
}

function textChunk(message: string): BaseEvent {
  return {
    type: EventType.TEXT_MESSAGE_CHUNK,
    role: 'assistant',
    messageId: crypto.randomUUID(),
    delta: message,
  } as BaseEvent
}

export function createClaudeCliProvider(opts: {
  approvalNames: readonly string[]
  surfaceTools: readonly string[]
  allowedTools: readonly string[]
  prompts: PromptStrategy
  spawn: ClaudeSpawn
}): Provider {
  const { approvalNames, surfaceTools, allowedTools, prompts, spawn } = opts

  // Spawn the CLI for a prompt and map its NDJSON to AG-UI events. `detectApprovals` is the
  // approval-name set the stream watches for the GATE_OPENED suspend point — passed [] on a
  // resume run (a resumed run must not re-open the same gate).
  async function* primeAndStream(
    prompt: string,
    detectApprovals: readonly string[]
  ): AsyncGenerator<BaseEvent> {
    let child: { lines: AsyncIterable<string>; kill: () => void }
    try {
      child = spawn(prompt, allowedTools)
    } catch (err) {
      yield errorChunk(err instanceof Error ? err.message : String(err))
      return
    }
    try {
      yield* mapClaudeStream(child.lines, { approvalNames: detectApprovals, surfaceTools })
    } catch (err) {
      yield errorChunk(err instanceof Error ? err.message : String(err))
    } finally {
      child.kill()
    }
  }

  // Build the resume prompt from the approved/edited artifact (resolution.form), falling back
  // to the last approval args in the transcript. Returns null when no usable draft exists.
  function resumePromptFrom(handle: ResumeHandle, resolution: GateResolution): string | null {
    const messages = (handle.input?.messages ?? []) as Message[]
    const args = resolution.form ?? lastApprovalArgs(messages, approvalNames) ?? {}
    return prompts.buildResume?.(args) ?? null
  }

  return {
    async *run(input: RunAgentInput): AsyncIterable<BaseEvent> {
      const messages = (input?.messages ?? []) as Message[]
      const resuming = approvalResolved(messages, approvalNames)
      if (resuming) {
        const args = lastApprovalArgs(messages, approvalNames) ?? {}
        const resumePrompt = prompts.buildResume?.(args) ?? null
        if (!resumePrompt) {
          yield errorChunk('Resume failed: no saved draft found in the thread')
          return
        }
        yield* primeAndStream(resumePrompt, [])
        return
      }
      yield* primeAndStream(prompts.buildFirst(input), approvalNames)
    },

    async *resume(handle: ResumeHandle, resolution: GateResolution): AsyncIterable<BaseEvent> {
      if (resolution.decision === 'rejected') {
        yield textChunk('The human rejected the proposed action; no changes were made.')
        return
      }
      const resumePrompt = resumePromptFrom(handle, resolution)
      if (!resumePrompt) {
        yield errorChunk('Resume failed: no saved draft found in the thread')
        return
      }
      yield* primeAndStream(resumePrompt, [])
    },
  }
}
```
This preserves every existing `run()` behavior (turn 1 reaches the approval and the stream now also emits `GATE_OPENED` via Task 4; the back-compat resume path is unchanged) and adds the explicit `resume()`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn vitest run packages/providers/src/claude-cli-provider.test.ts`
Expected: PASS — all existing tests + 3 resume tests + 4 conformance checks.

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/claude-cli-provider.ts packages/providers/src/claude-cli-provider.test.ts
git commit -m "feat(providers): claude-cli resume() (kill-and-re-prime); passes conformance"
```

---

## Task 7: Full verification + live no-regression smoke

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole workspace**

Run: `yarn typecheck`
Expected: PASS — no errors across all packages + apps/inbox.

- [ ] **Step 2: Run the full test suite**

Run: `yarn test`
Expected: PASS — the prior count (166) plus the new tests (gate: 5, providers contract: 2, claude-stream: 3, mock conformance: 4, claude-cli: 3 resume + 4 conformance). No failures.

- [ ] **Step 3: Lint + format check**

Run: `yarn lint && yarn format:check`
Expected: both PASS (green). If `format:check` flags the new files, run `yarn format` and re-commit.

- [ ] **Step 4: Live no-regression smoke (the added GATE_OPENED must not disturb the old client)**

The live `@copilotkit` client does not consume `GATE_OPENED` — this step confirms the extra event is harmless in the running app. Follow the CLAUDE.md dev-server hygiene (kill stale stacks, free ports) before starting.

Run:
```bash
ps aux | grep -E "AiWorkflow/node_modules/.bin/(tsx|vite|concurrently)" | grep -v grep
pkill -9 -f "AiWorkflow/node_modules/.bin/(tsx|vite|concurrently)" 2>/dev/null; true
lsof -tiTCP:4000 -tiTCP:5173 -sTCP:LISTEN 2>/dev/null | xargs -I{} kill -9 {} 2>/dev/null; true
DEV_RECORD_REPLAY=record yarn dev
```
Then in the browser: run the lead-inbox qualifier → reach a `saveDraft` approval → approve it → confirm the draft is saved and the run resumes (the existing HITL loop). The change passes if the approve/resume loop behaves exactly as before (the new `GATE_OPENED` event is ignored by the client). Use `DEV_RECORD_REPLAY=record` so the run mints a fresh `toolCallId` (per the CLAUDE.md replay-vs-record HITL note).

Expected: the HITL approve→resume→draft-saved flow works unchanged; no console errors referencing `CUSTOM`/`GATE_OPENED`; no page reload.

- [ ] **Step 5: Commit any formatting fixups**

```bash
git add -A && git commit -m "chore: format provider-contract-v2 files" || echo "nothing to format"
```

---

## Task 8: Finish the branch

- [ ] **Step 1: Update HANDOFF.md**

Mark beta build order **step 1 as BUILT** in `HANDOFF.md` (the "Build order (beta)" list and the "Starting point" paragraph): note `resume?()` + `GATE_OPENED` + conformance suite landed in `@platform/core` + `@platform/providers`, additive (live client untouched), record/replay/server/Mastra deferred as planned. Point the next step at build order **step 2** (Week-0 spike: RunObserver + browser attach).

- [ ] **Step 2: Commit the handoff update**

```bash
git add HANDOFF.md
git commit -m "docs(handoff): beta step 1 (provider contract v2) BUILT; next = step 2 spike"
```

- [ ] **Step 3: Hand off for integration**

Invoke the `superpowers:finishing-a-development-branch` skill to choose how to integrate `feat/provider-contract-v2` (merge to `master` / open a PR / keep). Do not merge or push without the user's go-ahead (project rule).

---

## Notes for the implementer

- **TDD throughout:** every task writes the failing test first, watches it fail, then implements. Do not skip the "verify it fails" step — it proves the test exercises the new code.
- **Additive, not a rewrite:** `run()` keeps its exact current behavior. If an existing test changes meaning, stop — that is a regression, not an expected edit.
- **Core stays React-free and Node-free.** `gate.ts`/`conformance.ts` import only `@ag-ui/client` + `zod` + sibling core modules. No `node:*`, no React.
- **One component per file, named const exports, `type {Name}Props`** etc. per `docs/CONVENTIONS.md` — though these are plain modules (no React components here).
- **`@platform/core` must be built/resolvable from `@platform/providers`.** The packages resolve each other as raw TS source (no build step) — if an import of a new core export fails to resolve, re-run `yarn typecheck` from the root; do not add a build step.
