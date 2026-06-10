# Mastra Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production Mastra provider beside dev-only claude-cli, behind the unchanged `Provider` contract, that resumes gates natively (`run.resumeStream`), and prove it with the step-1 conformance suite + a live browser E2E (approve/reject/cancel).

**Architecture:** A PURE `createMastraProvider` in `@platform/providers` maps an injected `MastraRunner`'s chunk stream → AG-UI events and synthesizes `GATE_OPENED` from the approval tool-call it observes when the run suspends. The real Mastra Agent + 2-step workflow (agentStep → gateStep) + Postgres snapshot storage lives server-side in `apps/inbox/server/mastra/` and adapts to `MastraRunner`. Selected by `PROVIDER=mastra`; claude-cli stays the local default.

**Tech Stack:** TypeScript, `@mastra/core` (Agent + workflows), `@ai-sdk/anthropic` (or Mastra model-router string `"anthropic/…"`), `@mastra/pg` (PostgresStore), `@ag-ui/client` (event vocabulary), zod, vitest.

**Spec:** `docs/superpowers/specs/2026-06-10-mastra-provider-design.md`

**Refinement vs spec (intentional):** `MastraRunResult` carries only `{ status }` — the provider derives the gate's `proposedArtifact`/`toolCallId` from the approval-named tool-call it already observes in the stream (mirrors `claude-stream`), so we do NOT depend on Mastra's exact suspend-payload accessor.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/providers/src/mastra-types.ts` | `MastraRunner`, `MastraRun`, `MastraRunResult`, `MastraChunk` interfaces (the injected seam). |
| `packages/providers/src/mastra-stream.ts` | PURE chunk → AG-UI `BaseEvent` mapper (text/tool/result, surface filter, one messageId per contiguous text). |
| `packages/providers/src/mastra-provider.ts` | `createMastraProvider({ approvalNames, surfaceTools, runner })` — `run`/`resume`, GATE_OPENED synthesis, `finally → run.abort()`. |
| `packages/providers/src/mastra-provider.test.ts` | conformance (over a fake runner) + unit tests. |
| `packages/providers/src/index.ts` | re-export the new modules. |
| `apps/inbox/server/mastra/tools.ts` | native Mastra tools: read tools from `gmail-basic`; no-op capture tools for render/propose. |
| `apps/inbox/server/mastra/runner.ts` | build Agent + 2-step workflow + PostgresStore; `makeMastraRunner(cfg) → MastraRunner`. |
| `apps/inbox/server/providers.ts` | add `mastra` factory + `PROVIDER=mastra` alias + `ANTHROPIC_API_KEY` fail-fast. |
| `apps/inbox/server/record-replay.ts` | re-key cassette step to the store's resolved-gate count. |
| `apps/inbox/server/pipeline/db/reset.ts` | init BOTH storages (drizzle migrate + Mastra storage). |

---

## Task 1: MastraRunner seam types

**Files:**
- Create: `packages/providers/src/mastra-types.ts`

- [ ] **Step 1: Write the types**

```ts
import type { GateResolution } from '@platform/core'

// One Mastra fullStream chunk we read. Structural (NOT @mastra/core's type) so the package
// has zero Mastra dependency — same discipline as claude-stream reading NDJSON. Fields are
// read defensively: workflow-level wrapping may nest the agent payload, so the mapper checks
// both `payload.text` and `text`, etc.
export interface MastraChunk {
  type: string // 'text-delta' | 'tool-call' | 'tool-call-input-streaming-delta' | 'tool-result' | 'finish' | 'error' | …
  payload?: {
    text?: string
    toolCallId?: string
    toolName?: string
    args?: unknown
    argsTextDelta?: string
    result?: unknown
    error?: unknown
  }
  // Some chunk shapes flatten these to the top level; the mapper reads payload first, then root.
  text?: string
  toolCallId?: string
  toolName?: string
  args?: unknown
  error?: unknown
}

export type MastraRunResult =
  | { status: 'suspended' }
  | { status: 'completed' }
  | { status: 'failed'; error: string }

export interface MastraRun {
  stream: AsyncIterable<MastraChunk>
  result: Promise<MastraRunResult>
  // CAUTION (a): cancel the in-flight run. The provider calls this in its generator `finally`,
  // so the RunObserver's existing cancel (iterator.return()) reaches Mastra.
  abort(): void
}

// Injected by the server (the spawn-injection pattern). `inputData` is provider-built and
// opaque to the package; the server adapter decodes it. `runId` is caller-supplied so AG-UI
// runId === Mastra runId (native resume targets it).
export interface MastraRunner {
  start(runId: string, inputData: Record<string, unknown>): MastraRun
  resume(runId: string, resolution: GateResolution): MastraRun
}
```

- [ ] **Step 2: Typecheck**

Run: `yarn typecheck`
Expected: PASS (no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add packages/providers/src/mastra-types.ts
git commit -m "feat(providers): MastraRunner injected-seam types"
```

---

## Task 2: chunk → AG-UI mapper

**Files:**
- Create: `packages/providers/src/mastra-stream.ts`
- Test: `packages/providers/src/mastra-stream.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { EventType, type BaseEvent } from '@ag-ui/client'
import { mapMastraStream } from './mastra-stream.js'
import type { MastraChunk } from './mastra-types.js'

async function* from(chunks: MastraChunk[]): AsyncGenerator<MastraChunk> {
  for (const c of chunks) yield c
}
async function collect(it: AsyncIterable<BaseEvent>): Promise<BaseEvent[]> {
  const out: BaseEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

describe('mapMastraStream', () => {
  it('maps contiguous text-delta to ONE messageId, resets after a tool call', async () => {
    const events = await collect(
      mapMastraStream(
        from([
          { type: 'text-delta', payload: { text: 'Draf' } },
          { type: 'text-delta', payload: { text: 'ted a reply' } },
          { type: 'tool-call', payload: { toolCallId: 't1', toolName: 'renderLead', args: { from: 'a' } } },
          { type: 'text-delta', payload: { text: 'after' } },
        ]),
        { surfaceTools: ['renderLead'] }
      )
    )
    const texts = events.filter((e) => e.type === EventType.TEXT_MESSAGE_CHUNK) as Array<
      BaseEvent & { messageId: string; delta: string }
    >
    expect(texts.map((t) => t.delta)).toEqual(['Draf', 'ted a reply', 'after'])
    // first two share an id; the post-tool one differs
    expect(texts[0].messageId).toBe(texts[1].messageId)
    expect(texts[2].messageId).not.toBe(texts[0].messageId)
  })

  it('maps a tool-call to START/ARGS/END and filters unsurfaced tools', async () => {
    const events = await collect(
      mapMastraStream(
        from([
          { type: 'tool-call', payload: { toolCallId: 't1', toolName: 'renderLead', args: { from: 'a' } } },
          { type: 'tool-call', payload: { toolCallId: 't2', toolName: 'ToolSearch', args: {} } },
        ]),
        { surfaceTools: ['renderLead'] }
      )
    )
    const names = events
      .filter((e) => e.type === EventType.TOOL_CALL_START)
      .map((e) => (e as unknown as { toolCallName: string }).toolCallName)
    expect(names).toEqual(['renderLead'])
    const argsEvents = events.filter((e) => e.type === EventType.TOOL_CALL_ARGS)
    expect((argsEvents[0] as unknown as { delta: string }).delta).toBe('{"from":"a"}')
  })

  it('surfaces a tool-result only for a surfaced tool', async () => {
    const events = await collect(
      mapMastraStream(
        from([
          { type: 'tool-call', payload: { toolCallId: 't1', toolName: 'renderLead', args: {} } },
          { type: 'tool-result', payload: { toolCallId: 't1', result: { ok: true } } },
        ]),
        { surfaceTools: ['renderLead'] }
      )
    )
    expect(events.some((e) => e.type === EventType.TOOL_CALL_RESULT)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test mastra-stream`
Expected: FAIL — `mapMastraStream` is not defined.

- [ ] **Step 3: Implement the mapper**

```ts
import { EventType, type BaseEvent } from '@ag-ui/client'
import type { MastraChunk } from './mastra-types.js'

// Read a field from payload first, then the flattened root (workflow wrapping varies).
function field<T>(c: MastraChunk, key: keyof NonNullable<MastraChunk['payload']>): T | undefined {
  const p = c.payload as Record<string, unknown> | undefined
  return ((p?.[key as string] ?? (c as Record<string, unknown>)[key as string]) as T) ?? undefined
}

function textChunk(messageId: string, delta: string): BaseEvent {
  return { type: EventType.TEXT_MESSAGE_CHUNK, role: 'assistant', messageId, delta } as BaseEvent
}

// Maps Mastra fullStream chunks → AG-UI events. Mirrors claude-stream: contiguous text shares
// ONE messageId (cleared at any tool boundary — the AG-UI "split bubble" gotcha); only
// surfaceTools appear as tool calls; surfaced tools also emit TOOL_CALL_RESULT so the default
// chip flips Running→Done and the client gets the data directly.
export async function* mapMastraStream(
  chunks: AsyncIterable<MastraChunk>,
  opts: { surfaceTools: readonly string[] }
): AsyncGenerator<BaseEvent> {
  let textId: string | null = null
  // toolCallId → whether we surfaced it (so we only emit a RESULT for surfaced tools)
  const surfaced = new Map<string, boolean>()

  for await (const c of chunks) {
    if (c.type === 'text-delta') {
      const text = field<string>(c, 'text') ?? ''
      if (!text) continue
      if (textId === null) textId = crypto.randomUUID()
      yield textChunk(textId, text)
      continue
    }

    if (c.type === 'tool-call') {
      textId = null // boundary: close any open text message
      const toolCallId = field<string>(c, 'toolCallId') ?? crypto.randomUUID()
      const toolName = field<string>(c, 'toolName') ?? ''
      const show = opts.surfaceTools.includes(toolName)
      surfaced.set(toolCallId, show)
      if (!show) continue
      const args = field<unknown>(c, 'args') ?? {}
      yield {
        type: EventType.TOOL_CALL_START,
        parentMessageId: crypto.randomUUID(),
        toolCallId,
        toolCallName: toolName,
      } as BaseEvent
      yield {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId,
        delta: typeof args === 'string' ? args : JSON.stringify(args),
      } as BaseEvent
      yield { type: EventType.TOOL_CALL_END, toolCallId } as BaseEvent
      continue
    }

    if (c.type === 'tool-result') {
      const toolCallId = field<string>(c, 'toolCallId') ?? ''
      if (!surfaced.get(toolCallId)) continue
      const result = field<unknown>(c, 'result') ?? {}
      yield {
        type: EventType.TOOL_CALL_RESULT,
        role: 'tool',
        toolCallId,
        messageId: crypto.randomUUID(),
        content: typeof result === 'string' ? result : JSON.stringify(result),
      } as BaseEvent
      continue
    }

    if (c.type === 'error') {
      const err = field<unknown>(c, 'error')
      yield textChunk(crypto.randomUUID(), `Provider error: ${String(err ?? 'unknown')}`)
      textId = null
    }
    // 'finish'/'start'/'step-*' carry no client-visible content — ignored.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test mastra-stream`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/mastra-stream.ts packages/providers/src/mastra-stream.test.ts
git commit -m "feat(providers): Mastra chunk → AG-UI mapper"
```

---

## Task 3: createMastraProvider — run()

**Files:**
- Create: `packages/providers/src/mastra-provider.ts`
- Test: `packages/providers/src/mastra-provider.test.ts` (run() cases; conformance added in Task 5)

- [ ] **Step 1: Write the failing test (with a fake runner)**

```ts
import { describe, it, expect, vi } from 'vitest'
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import { readGateOpened } from '@platform/core'
import { createMastraProvider } from './mastra-provider.js'
import type { MastraChunk, MastraRunner, MastraRun, MastraRunResult } from './mastra-types.js'

async function collect(it: AsyncIterable<BaseEvent>): Promise<BaseEvent[]> {
  const out: BaseEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

// A fake runner: scripts a chunk stream + a settled result, records abort().
function fakeRun(chunks: MastraChunk[], result: MastraRunResult, onAbort = () => {}): MastraRun {
  return {
    stream: (async function* () {
      for (const c of chunks) yield c
    })(),
    result: Promise.resolve(result),
    abort: onAbort,
  }
}

const DRAFT = { threadId: 't1', body: 'hello' }
const input = { messages: [], runId: 'r1' } as unknown as RunAgentInput

describe('createMastraProvider run()', () => {
  it('turn 1 with a saveDraft proposal suspends → exactly one GATE_OPENED', async () => {
    const runner: MastraRunner = {
      start: () =>
        fakeRun(
          [
            { type: 'text-delta', payload: { text: 'Drafting…' } },
            { type: 'tool-call', payload: { toolCallId: 'tc1', toolName: 'renderLead', args: { from: 'a' } } },
            { type: 'tool-call', payload: { toolCallId: 'tc2', toolName: 'saveDraft', args: DRAFT } },
          ],
          { status: 'suspended' }
        ),
      resume: () => fakeRun([], { status: 'completed' }),
    }
    const p = createMastraProvider({
      approvalNames: ['saveDraft'],
      surfaceTools: ['renderLead', 'saveDraft'],
      runner,
    })
    const events = await collect(p.run(input))
    const gates = events.map(readGateOpened).filter(Boolean)
    expect(gates).toHaveLength(1)
    expect(gates[0]!.toolName).toBe('saveDraft')
    expect(gates[0]!.toolCallId).toBe('tc2')
    expect(gates[0]!.proposedArtifact).toEqual(DRAFT)
  })

  it('no saveDraft + completed → no gate, just finishes (caution b)', async () => {
    const runner: MastraRunner = {
      start: () =>
        fakeRun(
          [{ type: 'tool-call', payload: { toolCallId: 'v1', toolName: 'renderVerdict', args: {} } }],
          { status: 'completed' }
        ),
      resume: () => fakeRun([], { status: 'completed' }),
    }
    const p = createMastraProvider({ approvalNames: [], surfaceTools: ['renderVerdict'], runner })
    const events = await collect(p.run(input))
    expect(events.map(readGateOpened).filter(Boolean)).toHaveLength(0)
    expect(events.length).toBeGreaterThan(0)
  })

  it('last saveDraft wins when emitted twice (caution b)', async () => {
    const runner: MastraRunner = {
      start: () =>
        fakeRun(
          [
            { type: 'tool-call', payload: { toolCallId: 'a', toolName: 'saveDraft', args: { body: 'first' } } },
            { type: 'tool-call', payload: { toolCallId: 'b', toolName: 'saveDraft', args: { body: 'second' } } },
          ],
          { status: 'suspended' }
        ),
      resume: () => fakeRun([], { status: 'completed' }),
    }
    const p = createMastraProvider({ approvalNames: ['saveDraft'], surfaceTools: ['saveDraft'], runner })
    const gates = (await collect(p.run(input))).map(readGateOpened).filter(Boolean)
    expect(gates).toHaveLength(1)
    expect(gates[0]!.toolCallId).toBe('b')
    expect(gates[0]!.proposedArtifact).toEqual({ body: 'second' })
  })

  it('calls abort() when the consumer stops early (caution a)', async () => {
    const onAbort = vi.fn()
    const runner: MastraRunner = {
      start: () =>
        fakeRun(
          [
            { type: 'text-delta', payload: { text: 'one' } },
            { type: 'text-delta', payload: { text: 'two' } },
          ],
          { status: 'completed' },
          onAbort
        ),
      resume: () => fakeRun([], { status: 'completed' }),
    }
    const p = createMastraProvider({ approvalNames: [], surfaceTools: [], runner })
    const it = p.run(input)[Symbol.asyncIterator]()
    await it.next() // first event
    await it.return!(undefined) // consumer stops → finally → abort
    expect(onAbort).toHaveBeenCalledTimes(1)
  })

  it('failed result yields an error chunk', async () => {
    const runner: MastraRunner = {
      start: () => fakeRun([], { status: 'failed', error: 'boom' }),
      resume: () => fakeRun([], { status: 'completed' }),
    }
    const p = createMastraProvider({ approvalNames: [], surfaceTools: [], runner })
    const events = await collect(p.run(input))
    const text = events.find((e) => e.type === EventType.TEXT_MESSAGE_CHUNK) as { delta: string }
    expect(text.delta).toContain('boom')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test mastra-provider`
Expected: FAIL — `createMastraProvider` is not defined.

- [ ] **Step 3: Implement run() (resume() stubbed for now, finished in Task 4)**

```ts
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import { gateOpened, type GateResolution, type Provider, type ResumeHandle } from '@platform/core'
import { mapMastraStream } from './mastra-stream.js'
import type { MastraRunner, MastraRun } from './mastra-types.js'

function errorChunk(message: string): BaseEvent {
  return {
    type: EventType.TEXT_MESSAGE_CHUNK,
    role: 'assistant',
    messageId: crypto.randomUUID(),
    delta: `Provider error: ${message}`,
  } as BaseEvent
}

export function createMastraProvider(opts: {
  approvalNames: readonly string[]
  surfaceTools: readonly string[]
  runner: MastraRunner
}): Provider {
  const { approvalNames, surfaceTools, runner } = opts

  // Drive ONE Mastra run (start or resume): map chunks → AG-UI, track the last approval-named
  // tool-call (= the gate proposal), and on a suspended result synthesize GATE_OPENED from it.
  // `emitGateOnSuspend=false` on resume (a resumed run must not re-open the gate).
  async function* drive(run: MastraRun, emitGateOnSuspend: boolean): AsyncGenerator<BaseEvent> {
    let lastApproval: { toolCallId: string; artifact: Record<string, unknown> } | null = null
    try {
      // Tee: map for the client AND watch for the approval tool-call. The mapper consumes the
      // stream; we re-derive the approval call from the same chunks via a tap generator.
      const tap = (async function* () {
        for await (const c of run.stream) {
          const name = (c.payload?.toolName ?? c.toolName) as string | undefined
          if (c.type === 'tool-call' && name && approvalNames.includes(name)) {
            const args = (c.payload?.args ?? c.args ?? {}) as Record<string, unknown>
            const id = (c.payload?.toolCallId ?? c.toolCallId ?? crypto.randomUUID()) as string
            lastApproval = { toolCallId: id, artifact: args } // last-wins (caution b)
          }
          yield c
        }
      })()

      yield* mapMastraStream(tap, { surfaceTools })

      const result = await run.result
      if (result.status === 'failed') {
        yield errorChunk(result.error)
        return
      }
      if (result.status === 'suspended' && emitGateOnSuspend && lastApproval) {
        yield gateOpened({
          gateKind: 'approval',
          toolName: approvalNames.find(Boolean) ?? 'approval',
          toolCallId: lastApproval.toolCallId,
          proposedArtifact: lastApproval.artifact,
        })
      }
      // completed (or suspended w/o approval call) → return; RunObserver does transition(finish).
    } finally {
      run.abort() // caution (a): iterator.return() reaches Mastra
    }
  }

  return {
    async *run(input: RunAgentInput): AsyncIterable<BaseEvent> {
      const runId = (input?.runId as string) ?? crypto.randomUUID()
      const inputData = { messages: input?.messages ?? [] }
      yield* drive(runner.start(runId, inputData), true)
    },

    // eslint-disable-next-line require-yield
    async *resume(_handle: ResumeHandle, _resolution: GateResolution): AsyncIterable<BaseEvent> {
      throw new Error('not implemented yet') // Task 4
    },
  }
}
```

Note: `toolName: approvalNames.find(Boolean) ?? 'approval'` — for the beta there is exactly one approval name (`saveDraft`); if multiple are ever declared, track the name on `lastApproval` instead. (Single-approval is the current reality; revisit only when an agent declares two.)

- [ ] **Step 4: Refine — track the approval tool NAME on lastApproval (so it is exact, not first-of-list)**

Replace the `lastApproval` shape and assignment:

```ts
    let lastApproval: { toolName: string; toolCallId: string; artifact: Record<string, unknown> } | null = null
    // … inside the tap:
            lastApproval = { toolName: name, toolCallId: id, artifact: args }
    // … inside the suspend branch:
        yield gateOpened({
          gateKind: 'approval',
          toolName: lastApproval.toolName,
          toolCallId: lastApproval.toolCallId,
          proposedArtifact: lastApproval.artifact,
        })
```

- [ ] **Step 5: Run test to verify run() cases pass**

Run: `yarn test mastra-provider`
Expected: the 5 run() tests PASS (resume() not yet exercised).

- [ ] **Step 6: Commit**

```bash
git add packages/providers/src/mastra-provider.ts packages/providers/src/mastra-provider.test.ts
git commit -m "feat(providers): Mastra provider run() with GATE_OPENED synthesis + abort"
```

---

## Task 4: createMastraProvider — resume()

**Files:**
- Modify: `packages/providers/src/mastra-provider.ts`
- Modify: `packages/providers/src/mastra-provider.test.ts`

- [ ] **Step 1: Add failing resume tests**

```ts
import type { ResumeHandle } from '@platform/core'

const handle = { runId: 'r1', input } as ResumeHandle

describe('createMastraProvider resume()', () => {
  it('approved completes, re-opens no gate, emits events', async () => {
    const runner: MastraRunner = {
      start: () => fakeRun([], { status: 'completed' }),
      resume: () =>
        fakeRun([{ type: 'text-delta', payload: { text: 'The Gmail draft was saved.' } }], {
          status: 'completed',
        }),
    }
    const p = createMastraProvider({ approvalNames: ['saveDraft'], surfaceTools: ['saveDraft'], runner })
    const events = await collect(
      p.resume!(handle, { gateId: 'g1', decision: 'approved', form: DRAFT, executedResult: { draftId: 'd1' } })
    )
    expect(events.map(readGateOpened).filter(Boolean)).toHaveLength(0)
    expect(events.length).toBeGreaterThan(0)
  })

  it('rejected terminates with no tool call', async () => {
    const runner: MastraRunner = {
      start: () => fakeRun([], { status: 'completed' }),
      resume: () =>
        fakeRun([{ type: 'text-delta', payload: { text: 'Rejected; nothing was saved.' } }], {
          status: 'completed',
        }),
    }
    const p = createMastraProvider({ approvalNames: ['saveDraft'], surfaceTools: ['saveDraft'], runner })
    const events = await collect(p.resume!(handle, { gateId: 'g1', decision: 'rejected' }))
    expect(events.filter((e) => e.type === EventType.TOOL_CALL_START)).toHaveLength(0)
    expect(events.map(readGateOpened).filter(Boolean)).toHaveLength(0)
    expect(events.length).toBeGreaterThan(0)
  })

  it('passes the resolution to runner.resume keyed by handle.runId', async () => {
    const resume = vi.fn(() =>
      fakeRun([{ type: 'text-delta', payload: { text: 'ok' } }], { status: 'completed' as const })
    )
    const runner: MastraRunner = { start: () => fakeRun([], { status: 'completed' }), resume }
    const p = createMastraProvider({ approvalNames: ['saveDraft'], surfaceTools: [], runner })
    await collect(p.resume!(handle, { gateId: 'g1', decision: 'approved', executedResult: { draftId: 'd1' } }))
    expect(resume).toHaveBeenCalledWith('r1', expect.objectContaining({ decision: 'approved' }))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test mastra-provider`
Expected: FAIL — resume() throws "not implemented yet".

- [ ] **Step 3: Implement resume()**

Replace the stubbed `resume`:

```ts
    async *resume(handle: ResumeHandle, resolution: GateResolution): AsyncIterable<BaseEvent> {
      const runId = handle.runId
      // The server already executed the effect; resolution carries decision + executedResult.
      // gateStep reads these from resumeData (approved → confirm sentence; rejected → bail).
      yield* drive(runner.resume(runId, resolution), false)
    },
```

Remove the `// eslint-disable-next-line require-yield` line.

- [ ] **Step 4: Run to verify it passes**

Run: `yarn test mastra-provider`
Expected: all run() + resume() tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/mastra-provider.ts packages/providers/src/mastra-provider.test.ts
git commit -m "feat(providers): Mastra provider resume() via native runner.resume"
```

---

## Task 5: Conformance suite against the fake runner

**Files:**
- Modify: `packages/providers/src/mastra-provider.test.ts`

- [ ] **Step 1: Add the conformance block**

```ts
import { providerConformanceChecks, type ConformanceScenario } from '@platform/core'

// A fake runner that satisfies the conformance scenario: turn1 → suspend at saveDraft;
// resume(approved) → completed text; resume(rejected) → completed text, no tool call.
function conformanceRunner(): MastraRunner {
  return {
    start: () =>
      fakeRun(
        [
          { type: 'tool-call', payload: { toolCallId: 'tc-render', toolName: 'renderLead', args: { from: 'a' } } },
          { type: 'tool-call', payload: { toolCallId: 'tc-draft', toolName: 'saveDraft', args: DRAFT } },
        ],
        { status: 'suspended' }
      ),
    resume: (_runId, resolution) =>
      fakeRun(
        [
          {
            type: 'text-delta',
            payload: { text: resolution.decision === 'approved' ? 'Saved.' : 'Rejected.' },
          },
        ],
        { status: 'completed' }
      ),
  }
}

const scenario: ConformanceScenario = {
  approvalNames: ['saveDraft'],
  surfaceTools: ['renderLead', 'saveDraft'],
  turn1Input: { messages: [], runId: 'r1' } as unknown as RunAgentInput,
  approved: {
    handle: { runId: 'r1', input: { messages: [] } as unknown as RunAgentInput },
    resolution: { gateId: 'g1', decision: 'approved', form: DRAFT, executedResult: { draftId: 'd1' } },
  },
  rejected: {
    handle: { runId: 'r1', input: { messages: [] } as unknown as RunAgentInput },
    resolution: { gateId: 'g1', decision: 'rejected' },
  },
}

describe('mastra-provider conformance', () => {
  for (const check of providerConformanceChecks) {
    it(check.name, () =>
      check.run(
        () =>
          createMastraProvider({
            approvalNames: ['saveDraft'],
            surfaceTools: ['renderLead', 'saveDraft'],
            runner: conformanceRunner(),
          }),
        scenario
      )
    )
  }
})
```

- [ ] **Step 2: Run to verify the 4 conformance checks pass**

Run: `yarn test mastra-provider`
Expected: PASS — the same 4 invariants the mock + claude-cli pass. **This is the two-unlike-providers proof.**

- [ ] **Step 3: Commit**

```bash
git add packages/providers/src/mastra-provider.test.ts
git commit -m "test(providers): Mastra passes the step-1 conformance suite (two-unlike-providers proof)"
```

---

## Task 6: Export + package-level green

**Files:**
- Modify: `packages/providers/src/index.ts`

- [ ] **Step 1: Add exports**

```ts
export * from './mastra-types.js'
export * from './mastra-stream.js'
export * from './mastra-provider.js'
```

- [ ] **Step 2: Full green**

Run: `yarn typecheck && yarn test && yarn lint && yarn format:check`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/providers/src/index.ts
git commit -m "feat(providers): export Mastra provider"
```

---

## Task 7: Install server-side Mastra deps

**Files:**
- Modify: `apps/inbox/package.json`

- [ ] **Step 1: Add deps**

Run (from repo root):

```bash
yarn workspace inbox add @mastra/core @mastra/pg @ai-sdk/anthropic --ignore-engines
```

(If `@mastra/pg` resolution fails, the alternative is Mastra core's built-in storage; pin the version that installs cleanly and note it in the commit.)

- [ ] **Step 2: Verify install**

Run: `yarn typecheck`
Expected: PASS (no usage yet).

- [ ] **Step 3: Commit**

```bash
git add apps/inbox/package.json package.json yarn.lock
git commit -m "chore(inbox): add @mastra/core, @mastra/pg, @ai-sdk/anthropic"
```

---

## Task 8: Native Mastra tools (read + capture)

**Files:**
- Create: `apps/inbox/server/mastra/tools.ts`

Context: read the existing Gmail read path before writing this — `mcp/gmail-tools.mjs` (the `get_latest_email` impl) and `@platform/integrations/gmail-basic` exports. The read tool must call the SAME underlying Gmail read as the MCP tool.

- [ ] **Step 1: Implement the tools**

```ts
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getLatestEmail } from '@platform/integrations/gmail-basic'

// Render/propose tools are NO-OPs whose args = the artifact. They appear as tool-calls (the
// mapper surfaces them) but perform no side effect — the SERVER executes effects (step 4) and
// fills the card from the tool-call args. saveDraft is the approval/propose tool.
function captureTool(id: string, schema: z.ZodTypeAny) {
  return createTool({
    id,
    description: `Surface "${id}" to the UI. Does not perform any action.`,
    inputSchema: schema,
    execute: async ({ context }) => context, // echo args back; no side effect
  })
}

export const renderLeadTool = captureTool(
  'renderLead',
  z.object({ from: z.string(), subject: z.string(), summary: z.string() })
)
export const renderVerdictTool = captureTool(
  'renderVerdict',
  z.object({ origin: z.string().optional() }).passthrough()
)
export const saveDraftTool = captureTool(
  'saveDraft',
  z.object({ threadId: z.string(), body: z.string() })
)

// The ONLY real-effect read tool — the qualifier's inbox reader. Calls the same Gmail read as
// the stdio MCP `get_latest_email`. No write tools exist for any Mastra agent (effects are
// server-side).
export const getLatestEmailTool = createTool({
  id: 'get_latest_email',
  description: 'Read the most recent email in the inbox.',
  inputSchema: z.object({}),
  execute: async () => getLatestEmail(),
})
```

Note: confirm the exact `@platform/integrations/gmail-basic` read export name (`getLatestEmail` vs other) by grepping the package before implementing; adjust the import to match. Also confirm `createTool`'s execute receives `{ context }` (current Mastra) vs `{ inputData }` — pin via the installed version's types.

- [ ] **Step 2: Typecheck**

Run: `yarn typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/inbox/server/mastra/tools.ts
git commit -m "feat(inbox/mastra): native read tool + no-op capture tools"
```

---

## Task 9: Mastra runner adapter (Agent + workflow + storage)

**Files:**
- Create: `apps/inbox/server/mastra/runner.ts`

This is the integration task — unit-testing real Mastra is out of scope; it is verified by the live E2E (Task 13). Write concrete code; the two version-sensitive spots are flagged.

- [ ] **Step 1: Implement makeMastraRunner**

```ts
import { Mastra } from '@mastra/core'
import { Agent } from '@mastra/core/agent'
import { createStep, createWorkflow } from '@mastra/core/workflows'
import { PostgresStore } from '@mastra/pg'
import { z } from 'zod'
import { decodeHandoff, HandoffPayloadSchema, type GateResolution } from '@platform/core'
import type { MastraRunner, MastraRun, MastraChunk, MastraRunResult } from '@platform/providers'
import type { Message } from '@platform/core'
import { getLatestEmailTool, renderLeadTool, renderVerdictTool, saveDraftTool } from './tools.js'

// Build the prompt the agent works from, from the run's messages (the handoff payload). Mirrors
// reply.prompts handoffFirst/noLeadFirst, but server-side (Mastra ignores PromptStrategy).
function buildPrompt(instructions: string, messages: Message[]): string {
  const h = decodeHandoff({ messages } as never, HandoffPayloadSchema)
  if (!h) return `${instructions}\n\nNo lead was handed off. Reply with one short sentence asking the user to start from the Lead Qualifier. Do not call any tool.`
  return [
    instructions,
    '',
    `A colleague qualified this lead — category "${h.category}", priority "${h.priority}".`,
    `From ${h.from}, subject "${h.subject}". Summary: ${h.summary}`,
    'Do NOT fetch the email again. Call renderLead with { from, subject, summary }, draft a short',
    `reply, then call saveDraft with { threadId: "${h.threadId}", body } to ask the human. Do NOT`,
    'send anything and do not narrate tool usage.',
  ].join('\n')
}

export interface MastraRunnerConfig {
  agentId: string
  instructions: string
  approvalNames: readonly string[] // [] for the qualifier
  readTools: readonly string[] // e.g. ['get_latest_email']
  renderAndProposeTools: readonly string[] // e.g. ['renderLead','saveDraft'] or ['renderVerdict']
  model: string // e.g. 'anthropic/claude-sonnet-4-6'
  databaseUrl: string
}

const ALL_TOOLS = {
  get_latest_email: getLatestEmailTool,
  renderLead: renderLeadTool,
  renderVerdict: renderVerdictTool,
  saveDraft: saveDraftTool,
} as const

export function makeMastraRunner(cfg: MastraRunnerConfig): MastraRunner {
  const tools = Object.fromEntries(
    [...cfg.readTools, ...cfg.renderAndProposeTools].map((n) => [n, ALL_TOOLS[n as keyof typeof ALL_TOOLS]])
  )

  const agent = new Agent({
    id: cfg.agentId,
    name: cfg.agentId,
    instructions: cfg.instructions,
    model: cfg.model,
    tools,
  })

  const hasApproval = cfg.approvalNames.length > 0

  // agentStep: stream the agent, capture the LAST approval tool-call (last-wins, caution b).
  const agentStep = createStep({
    id: 'agent',
    inputSchema: z.object({ prompt: z.string() }),
    outputSchema: z.object({ draft: z.record(z.unknown()).nullable(), toolCallId: z.string().nullable() }),
    execute: async ({ inputData, writer }) => {
      const res = await agent.stream(inputData.prompt)
      let draft: Record<string, unknown> | null = null
      let toolCallId: string | null = null
      // Pipe to the writer for the workflow run stream AND inspect for the approval call.
      for await (const chunk of res.fullStream) {
        await writer.write(chunk) // bubbles to run.stream()
        const name = (chunk as { payload?: { toolName?: string }; toolName?: string }).payload?.toolName
        if (hasApproval && name && cfg.approvalNames.includes(name)) {
          const c = chunk as { payload?: { args?: unknown; toolCallId?: string } }
          draft = (c.payload?.args ?? {}) as Record<string, unknown>
          toolCallId = (c.payload?.toolCallId ?? null) as string | null
        }
      }
      return { draft, toolCallId }
    },
  })

  // gateStep: suspend if there is a draft; resume branches on the decision (caution b: no draft
  // → completed, never suspends).
  const gateStep = createStep({
    id: 'gate',
    inputSchema: z.object({ draft: z.record(z.unknown()).nullable(), toolCallId: z.string().nullable() }),
    resumeSchema: z.object({ decision: z.enum(['approved', 'rejected']), executedResult: z.record(z.unknown()).optional() }),
    suspendSchema: z.object({ toolCallId: z.string().nullable(), proposedArtifact: z.record(z.unknown()).nullable() }),
    outputSchema: z.object({ done: z.boolean() }),
    execute: async ({ inputData, resumeData, suspend, bail, writer }) => {
      if (!inputData.draft) return { done: true } // qualifier / no-proposal → normal finish
      if (resumeData?.decision === 'rejected') {
        await writer.write({ type: 'text-delta', payload: { text: 'The human rejected the draft; nothing was saved.' } })
        return bail({ done: false })
      }
      if (resumeData?.decision === 'approved') {
        await writer.write({ type: 'text-delta', payload: { text: 'The Gmail draft was saved.' } })
        return { done: true }
      }
      return await suspend({ toolCallId: inputData.toolCallId, proposedArtifact: inputData.draft })
    },
  })

  const workflow = createWorkflow({
    id: `wf-${cfg.agentId}`,
    inputSchema: z.object({ prompt: z.string() }),
    outputSchema: z.object({ done: z.boolean() }),
  })
    .then(agentStep)
    .then(gateStep)
  workflow.commit()

  const mastra = new Mastra({
    storage: new PostgresStore({ connectionString: cfg.databaseUrl }),
    workflows: { [`wf-${cfg.agentId}`]: workflow },
  })

  // Adapt a Mastra streamed run to MastraRun. result derives from stream.result.status.
  function adapt(stream: { [Symbol.asyncIterator](): AsyncIterator<unknown>; result: Promise<{ status: string; error?: unknown }> }, cancel: () => void): MastraRun {
    return {
      stream: stream as AsyncIterable<MastraChunk>,
      result: stream.result.then((r): MastraRunResult =>
        r.status === 'suspended'
          ? { status: 'suspended' }
          : r.status === 'failed'
            ? { status: 'failed', error: String(r.error ?? 'mastra run failed') }
            : { status: 'completed' }
      ),
      abort: cancel,
    }
  }

  return {
    start(runId, inputData) {
      const messages = (inputData.messages ?? []) as Message[]
      const prompt = buildPrompt(cfg.instructions, messages)
      // createRun accepts an external runId → AG-UI runId === Mastra runId.
      const runPromise = mastra.getWorkflow(`wf-${cfg.agentId}`).createRun({ runId })
      // createRun is async; wrap to keep MastraRun synchronous. We resolve the run then stream.
      return deferRun(runPromise, (run) => run.stream({ inputData: { prompt } }))
    },
    resume(runId, resolution: GateResolution) {
      const runPromise = mastra.getWorkflow(`wf-${cfg.agentId}`).createRun({ runId })
      return deferRun(runPromise, (run) =>
        run.resumeStream({ resumeData: { decision: resolution.decision, executedResult: resolution.executedResult } })
      )
    },
  }

  // Bridge createRun's Promise into the synchronous MastraRun the provider expects: expose an
  // async-iterable that awaits the run, and a result promise + abort that chain through.
  function deferRun(
    runPromise: Promise<{ stream: (a: unknown) => unknown; resumeStream: (a: unknown) => unknown; cancel?: () => void }>,
    makeStream: (run: { stream: (a: unknown) => unknown; resumeStream: (a: unknown) => unknown; cancel?: () => void }) => unknown
  ): MastraRun {
    let cancelFn: () => void = () => {}
    let resolveResult!: (r: MastraRunResult) => void
    const result = new Promise<MastraRunResult>((res) => (resolveResult = res))
    const stream: AsyncIterable<MastraChunk> = {
      async *[Symbol.asyncIterator]() {
        const run = await runPromise
        cancelFn = () => run.cancel?.()
        const s = makeStream(run) as { [Symbol.asyncIterator](): AsyncIterator<MastraChunk>; result: Promise<{ status: string; error?: unknown }> }
        try {
          for await (const c of s) yield c
        } finally {
          const r = await s.result
          resolveResult(
            r.status === 'suspended'
              ? { status: 'suspended' }
              : r.status === 'failed'
                ? { status: 'failed', error: String(r.error ?? 'failed') }
                : { status: 'completed' }
          )
        }
      },
    }
    return { stream, result, abort: () => cancelFn() }
  }
}
```

**Version-sensitive spots to confirm against the installed Mastra (Step 2):**
1. `createTool` execute arg — `{ context }` vs `{ inputData }` (Task 8 also).
2. The agent `fullStream` chunk field names (`payload.toolName`/`payload.args`/`payload.text`) — log one real run and adjust `tools.ts`/the mapper/`agentStep` capture if they differ. The structural mapper tolerates `payload.*` or root-level.
3. `run.cancel()` for abort — if absent, construct the run with an `AbortController` signal and abort that instead.

(The `adapt` helper is unused above — `deferRun` is the one the runner uses; delete `adapt` before committing. Kept here only to document the simpler shape for a future synchronous-createRun Mastra version.)

- [ ] **Step 2: Confirm the 3 version-sensitive spots, then typecheck**

Run a one-off probe (a tiny script `node --import tsx apps/inbox/server/mastra/_probe.ts` that starts one run and `console.log`s the first 5 `fullStream` chunks) OR rely on the installed `@mastra/core` types. Adjust field reads to match. Delete the probe and the dead `adapt` helper.

Run: `yarn typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/inbox/server/mastra/runner.ts
git commit -m "feat(inbox/mastra): Agent + 2-step workflow runner adapter (Postgres storage, external runId, abort)"
```

---

## Task 10: Provider registry env-switch

**Files:**
- Modify: `apps/inbox/server/providers.ts`

- [ ] **Step 1: Add the mastra factory + PROVIDER alias**

```ts
import { defineProviders, type ProviderRegistry, type ProviderFactory } from '@platform/core'
import { createMockInboxProvider, createClaudeCliProvider, createMastraProvider } from '@platform/providers'
import { claudeSpawn } from './claude-spawn.js'
import { makeMastraRunner } from './mastra/runner.js'

const MASTRA_MODEL = process.env.MASTRA_MODEL ?? 'anthropic/claude-sonnet-4-6'

// Per-agent metadata the Mastra runner needs but the generic ProviderConfig does not carry.
// Read tools = the allow-list entries that are NOT render/approval; here we pass them through
// by stripping the mcp prefix. For the beta the two agents are known, so derive from config.
const mastraFactory: ProviderFactory = (config) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('PROVIDER=mastra requires ANTHROPIC_API_KEY')
  }
  const bare = (config.allowedTools ?? []).map((t) => t.replace(/^mcp__[^_]+__/, ''))
  const readTools = bare.filter((t) => !config.surfaceTools.includes(t) && !config.approvalNames.includes(t))
  const renderAndProposeTools = bare.filter((t) => config.surfaceTools.includes(t))
  const runner = makeMastraRunner({
    agentId: 'agent', // label only; the workflow id is per-runner
    instructions: '', // see note: instructions must reach the runner — pass via config below
    approvalNames: config.approvalNames,
    readTools,
    renderAndProposeTools,
    model: MASTRA_MODEL,
    databaseUrl: process.env.DATABASE_URL ?? '',
  })
  return createMastraProvider({
    approvalNames: config.approvalNames,
    surfaceTools: config.surfaceTools,
    runner,
  })
}

const usingMastra = process.env.PROVIDER === 'mastra'

export const providerRegistry: ProviderRegistry = defineProviders({
  mock: (config) => createMockInboxProvider(config.approvalNames),
  'claude-cli': usingMastra
    ? mastraFactory
    : (config) =>
        createClaudeCliProvider({
          approvalNames: config.approvalNames,
          surfaceTools: config.surfaceTools,
          allowedTools: config.allowedTools,
          prompts: config.prompts,
          spawn: claudeSpawn,
        }),
  mastra: mastraFactory,
})
```

**Problem to fix in this step:** the Mastra runner needs each agent's `instructions`, which `ProviderConfig` does NOT carry. Resolve by adding `instructions` to `ProviderConfig` (in `@platform/core` `providers.ts`) and threading it from `buildProvider` (it has `def.instructions`). This is a small additive contract change.

- [ ] **Step 2: Add `instructions` to ProviderConfig + thread it**

In `packages/core/src/providers.ts`, add to `ProviderConfig`:

```ts
  // The agent's system instructions (from defineAgent). claude-cli reads them via PromptStrategy;
  // Mastra uses them as the Agent's instructions. Always present.
  instructions: string
```

In `apps/inbox/server/build-agent.ts` `buildProvider`, pass it:

```ts
  let provider = makeProvider({
    approvalNames: def.approvals,
    surfaceTools: def.tools,
    allowedTools,
    prompts,
    instructions: def.instructions,
  })
```

Then in `providers.ts` use `config.instructions` in `makeMastraRunner({ instructions: config.instructions, … })`, and update the claude-cli + mock factories (they ignore it — fine). Update the conformance/test scenarios that build a `ProviderConfig` to include `instructions: ''`.

- [ ] **Step 3: Typecheck + targeted tests**

Run: `yarn typecheck && yarn test providers`
Expected: PASS (add `instructions: ''` wherever a ProviderConfig literal failed to typecheck).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/providers.ts apps/inbox/server/build-agent.ts apps/inbox/server/providers.ts
git commit -m "feat(inbox): PROVIDER=mastra env-switch; thread instructions through ProviderConfig"
```

---

## Task 11: Re-key record/replay to resolved-gate count

**Files:**
- Modify: `apps/inbox/server/record-replay.ts`

Context: read `record-replay.ts` first. Today the cassette step = `resolvedApprovalCount(input)` (a message scan in `@platform/core`). With the server spine, the authoritative count is the store's resolved-gate count for the WorkItem. The decorator must key on that instead.

- [ ] **Step 1: Change the step key source**

The decorator currently computes the step from the run input's messages. Change it to accept an injected `step` (the resolved-gate count) from the caller (RunObserver / buildProvider), OR compute it from the store. Minimal change: `withRecordReplay` gains a `step: () => number` (or the count is passed per call). Implement so:
- on `run()` the step is the count of resolved gates for the WorkItem at start (0 on a fresh run),
- on `resume()` the step is that count + 1 (the gate just resolved).

Concretely, thread a `resolvedGateCount(workItemId)` from `StateStore` into `buildProvider`'s record/replay wrap. Update `docs/dev-record-replay.md`'s "step =" line.

- [ ] **Step 2: Wipe cassettes once**

```bash
rm -f apps/inbox/.cassettes/*.jsonl
```

- [ ] **Step 3: Typecheck + tests**

Run: `yarn typecheck && yarn test record-replay`
Expected: PASS (update record-replay unit tests to the new step source).

- [ ] **Step 4: Commit**

```bash
git add apps/inbox/server/record-replay.ts apps/inbox/server/build-agent.ts docs/dev-record-replay.md
git commit -m "feat(inbox): re-key record/replay to the store's resolved-gate count"
```

---

## Task 12: reset.ts initializes both storages

**Files:**
- Modify: `apps/inbox/server/pipeline/db/reset.ts`

Context: read `reset.ts` first — today it resets `aiworkflow_test` via drizzle. Mastra's PostgresStore creates its own tables on first use; the test DB must have them too so a `PROVIDER=mastra` test run does not fail on a missing Mastra table.

- [ ] **Step 1: Add Mastra storage init after the drizzle migrate**

```ts
import { PostgresStore } from '@mastra/pg'

// After the existing drizzle migrate of aiworkflow_test:
const store = new PostgresStore({ connectionString: process.env.DATABASE_URL! })
await store.init() // creates Mastra's own tables (kept OUT of our drizzle migration set — caution c)
```

(Confirm the PostgresStore init method name — `init()` vs lazy-on-first-write — against the installed version; if lazy, a no-op first write or `store.init()` if available. If neither exists, document that Mastra tables auto-create on first run and remove this step.)

- [ ] **Step 2: Run the pipeline test suite**

Run: `yarn test pipeline`
Expected: PASS (real-PG tests still green; Mastra tables present in `aiworkflow_test`).

- [ ] **Step 3: Commit**

```bash
git add apps/inbox/server/pipeline/db/reset.ts
git commit -m "chore(inbox): init Mastra storage tables in the test DB reset (caution c)"
```

---

## Task 13: Live browser E2E (approve / reject / cancel)

**Files:** none (verification). Follow the CLAUDE.md browser-verify gotchas: kill stale dev stacks, free `:4000/:5173`, kill stale `mcp-chrome-*`.

- [ ] **Step 1: Start the app on the Mastra provider in RECORD mode**

```bash
pkill -9 -f "AiWorkflow/node_modules/.bin/(tsx|vite|concurrently)"; lsof -tiTCP:4000,:5173,:5174 | xargs kill -9 2>/dev/null
PROVIDER=mastra DEV_RECORD_REPLAY=record yarn dev
```

Confirm one `server on http://localhost:4000` and one vite on `:5173`, 0 `EADDRINUSE`.

- [ ] **Step 2: Approve flow**

In the browser at `http://localhost:5173/?spike=1`: Start a reply run → it qualifies/proposes → gate banner shows the proposed draft. EDIT the body (insert a unique marker), Approve.
Expected: status → `finished`; a REAL Gmail draft created by the server effect; the draft body contains the edited marker; thread shows the resume confirmation ("The Gmail draft was saved."), no `create_draft` tool call. (Delete the test draft from Gmail afterward.)

- [ ] **Step 3: Reject flow**

Start another run → at the gate, Reject.
Expected: status → `finished` with `resolution: rejected`; zero `action_ledger` rows for that gate; the rejected sentence appears.

- [ ] **Step 4: Cancel-mid-run flow (caution a — the critical one)**

Start a run; while it is `running` (before the gate), click Stop.
Expected: the Mastra run is aborted (stream stops mid-flight via `runner.abort()`), status → `finished`/`cancelled`. **If Stop no-ops, `abort()` is not wired through `run.cancel()` — fix Task 9 Step 1 spot #3 before proceeding.**

- [ ] **Step 5: Replay verification**

Stop the server. Restart with `PROVIDER=mastra DEV_RECORD_REPLAY=1 yarn dev`. Re-run the approve flow.
Expected: it replays from the cassette in ~seconds (cassette mtime unchanged); the gate + resume appear without a real model call.

- [ ] **Step 6: claude-cli regression**

Stop. Restart with `DEV_RECORD_REPLAY=1 yarn dev` (PROVIDER unset → claude-cli). Run the approve flow.
Expected: still works (the env-switch did not break the default provider).

- [ ] **Step 7: Commit any fixes found during E2E**

```bash
git add -A && git commit -m "fix(inbox/mastra): <whatever the browser surfaced>"
```

(If nothing needed fixing, skip.)

---

## Task 14: Final green + HANDOFF

**Files:**
- Modify: `HANDOFF.md`

- [ ] **Step 1: Full green**

Run: `yarn typecheck && yarn test && yarn lint && yarn format:check`
Expected: all PASS.

- [ ] **Step 2: Update HANDOFF step-5 line to ✅ BUILT + an As-built note**

Mark step 5 ✅ BUILT & browser-verified; record: the injected `MastraRunner` seam, the 2-step workflow, the GATE_OPENED-from-observed-approval-call refinement, the `instructions`-on-ProviderConfig contract addition, the record/replay re-key, the `PROVIDER=mastra` switch, and the E2E results (approve/reject/cancel). Set the next session's starting point = **step 6** (re-point board/thread UI to server state; delete `@copilotkit/*`).

- [ ] **Step 3: Commit**

```bash
git add HANDOFF.md
git commit -m "docs(step-5): Mastra provider BUILT & browser-verified (As-built)"
```

---

## Self-review notes

- **Spec coverage:** fork 1 (inject) → Tasks 1,3,9; fork 2 (propose tool + 2-step) → Tasks 8,9; fork 3 (native resume) → Tasks 4,9; fork 4 (Postgres storage, runId map) → Tasks 9,12 + the existing `setRunId`. Caution a (abort) → Tasks 1,3,9,13-S4; caution b (last-wins/no-draft) → Tasks 3,9; caution c (separate tables) → Task 12. Conformance DoD → Task 5. record/replay re-key → Task 11. Live E2E approve+reject+cancel → Task 13.
- **Known integration risk (isolated to Task 9):** exact Mastra `fullStream` chunk field names, `createTool` execute arg, and `run.cancel()` for abort — all flagged with confirm-against-installed-version steps; the pure provider/mapper/conformance (Tasks 1-6) are fully deterministic and do not depend on them.
- **Contract change:** `ProviderConfig.instructions` is additive (Task 10 Step 2) — every existing factory ignores it except Mastra; test ProviderConfig literals need `instructions: ''`.
