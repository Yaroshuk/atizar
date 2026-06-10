# RunObserver + Browser Attach Spike — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the post-CopilotKit thread design — a browser attaches to a server-side agent run, sees history + a live SSE tail, and approves via a plain HTTP POST that resumes the SAME trace — before building the Postgres spine.

**Architecture:** A durable pure `foldEventsToMessages` (in `@platform/core`) reduces AG-UI events to `Message[]` (what CopilotKit did internally). A throwaway in-memory RunObserver consumes `provider.run()` / `provider.resume()`, appends each event to a per-WorkItem `trace[]` with a monotonic `seq`, and re-publishes on an EventEmitter. Two READ endpoints (`/api/workitems/:id/trace` JSON snapshot, `/api/workitems/:id/stream` SSE) — these shapes survive into steps 3/6. The record/replay decorator is extended to also wrap `resume()` (Variant A) so the whole flow replays from the `lead-inbox__reply` cassette.

**Tech Stack:** TypeScript, `@ag-ui/client` events, Hono + `hono/streaming` (SSE), React (Vite), vitest. Spike driven by `DEV_RECORD_REPLAY=1`.

**Branch:** `feat/provider-contract-v2` (step 1 + step 2 share this branch per HANDOFF).

**Spec:** `docs/superpowers/specs/2026-06-10-runobserver-browser-attach-spike-design.md`

---

## File Structure

**New:**
- `packages/core/src/fold.ts` (+ `fold.test.ts`) — DURABLE: event → message fold.
- `apps/inbox/server/dev-runs.ts` — THROWAWAY: in-memory RunObserver, store, route factory.
- `apps/inbox/client/src/spike/TraceSpike.tsx` — THROWAWAY: `?spike=1` dev page.

**Modified:**
- `packages/core/src/index.ts` — export `./fold.js`.
- `apps/inbox/server/record-replay.ts` — wrap `resume()` (Variant A).
- `apps/inbox/server/record-replay.test.ts` — resume-wrap tests.
- `apps/inbox/server/build-agent.ts` — extract `buildProvider`.
- `apps/inbox/server/index.ts` — build a `providers` map + mount dev routes.
- `apps/inbox/client/src/main.tsx` — `?spike=1` branch.

---

## Task 1: `foldEventsToMessages` (DURABLE, TDD)

**Files:**
- Create: `packages/core/src/fold.ts`
- Test: `packages/core/src/fold.test.ts`
- Modify: `packages/core/src/index.ts`

> NOTE: a draft of `fold.ts` + `fold.test.ts` already exists in the working tree from
> the pre-brainstorm spike. Treat the code below as canonical — overwrite to match.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/fold.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { EventType, type BaseEvent } from '@ag-ui/client'
import { gateOpened } from './gate.js'
import { foldEventsToMessages } from './fold.js'
import { isAssistant, isToolMessage, pairToolResults } from './messages.js'

const text = (messageId: string, delta: string): BaseEvent =>
  ({ type: EventType.TEXT_MESSAGE_CHUNK, role: 'assistant', messageId, delta }) as BaseEvent
const tcStart = (parentMessageId: string, toolCallId: string, toolCallName: string): BaseEvent =>
  ({ type: EventType.TOOL_CALL_START, parentMessageId, toolCallId, toolCallName }) as BaseEvent
const tcArgs = (toolCallId: string, delta: string): BaseEvent =>
  ({ type: EventType.TOOL_CALL_ARGS, toolCallId, delta }) as BaseEvent
const tcEnd = (toolCallId: string): BaseEvent =>
  ({ type: EventType.TOOL_CALL_END, toolCallId }) as BaseEvent
const tcResult = (messageId: string, toolCallId: string, content: string): BaseEvent =>
  ({ type: EventType.TOOL_CALL_RESULT, messageId, toolCallId, content, role: 'tool' }) as BaseEvent

describe('foldEventsToMessages', () => {
  it('returns no messages for an empty event list', () => {
    expect(foldEventsToMessages([])).toEqual([])
  })

  it('concatenates contiguous text deltas that share one messageId into ONE bubble', () => {
    const msgs = foldEventsToMessages([text('m1', 'Draf'), text('m1', 'ted a reply')])
    expect(msgs).toHaveLength(1)
    expect(isAssistant(msgs[0])).toBe(true)
    expect(msgs[0].content).toBe('Drafted a reply')
  })

  it('splits text deltas with different messageIds into separate bubbles, in order', () => {
    const msgs = foldEventsToMessages([text('m1', 'first'), text('m2', 'second')])
    expect(msgs.map((m) => m.content)).toEqual(['first', 'second'])
  })

  it('builds an assistant tool call with accumulated arguments', () => {
    const msgs = foldEventsToMessages([
      tcStart('p1', 'call_1', 'renderVerdict'),
      tcArgs('call_1', '{"category":'),
      tcArgs('call_1', '"sales"}'),
      tcEnd('call_1'),
    ])
    expect(msgs).toHaveLength(1)
    const m = msgs[0]
    if (!isAssistant(m) || !m.toolCalls)
      throw new Error('expected an assistant message with tool calls')
    expect(m.toolCalls).toHaveLength(1)
    expect(m.toolCalls[0].id).toBe('call_1')
    expect(m.toolCalls[0].function.name).toBe('renderVerdict')
    expect(JSON.parse(m.toolCalls[0].function.arguments)).toEqual({ category: 'sales' })
  })

  it('pairs a tool result with its call via pairToolResults (AgentModal logic)', () => {
    const msgs = foldEventsToMessages([
      tcStart('p1', 'call_1', 'get_latest_email'),
      tcArgs('call_1', '{}'),
      tcEnd('call_1'),
      tcResult('r1', 'call_1', '{"subject":"hi"}'),
    ])
    expect(msgs.find(isToolMessage)).toBeTruthy()
    expect(pairToolResults(msgs).get('call_1')?.content).toBe('{"subject":"hi"}')
  })

  it('preserves chronological order across text, tool call, and result', () => {
    const msgs = foldEventsToMessages([
      text('m1', 'Checking inbox'),
      tcStart('p1', 'call_1', 'get_latest_email'),
      tcEnd('call_1'),
      tcResult('r1', 'call_1', 'email body'),
      text('m2', 'Found a lead'),
    ])
    expect(msgs.map((m) => m.role)).toEqual(['assistant', 'assistant', 'tool', 'assistant'])
  })

  it('ignores GATE_OPENED (a signal, not a message)', () => {
    const msgs = foldEventsToMessages([
      tcStart('p1', 'call_1', 'saveDraft'),
      tcArgs('call_1', '{"body":"hi"}'),
      tcEnd('call_1'),
      gateOpened({
        gateKind: 'approval',
        toolName: 'saveDraft',
        toolCallId: 'call_1',
        proposedArtifact: { body: 'hi' },
      }),
    ])
    expect(msgs).toHaveLength(1)
    expect(isAssistant(msgs[0])).toBe(true)
  })

  it('is incremental: folding a prefix matches the full fold on the common prefix', () => {
    const events = [
      text('m1', 'Hello '),
      text('m1', 'world'),
      tcStart('p1', 'call_1', 'renderVerdict'),
      tcArgs('call_1', '{"ok":true}'),
      tcEnd('call_1'),
    ]
    expect(foldEventsToMessages(events.slice(0, 2))).toHaveLength(1)
    expect(foldEventsToMessages(events)).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run packages/core/src/fold.test.ts -c vitest.config.ts`
Expected: FAIL — `Failed to resolve import "./fold.js"` (module not yet present).

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/fold.ts`:

```ts
import { EventType, type BaseEvent } from '@ag-ui/client'
import type { AssistantMessage, Message, ToolCall, ToolMessage } from './messages.js'

// Fold a stream of AG-UI events into the Message[] the thread renders. This is the
// reduction CopilotKit's runtime did internally; with the `@copilotkit/*` transport
// dropped (pipeline-updated-3 decision 6) the server's Trace is the source and the
// client folds it here. Pure & isomorphic (no React, no Node) so the same function
// serves the live SSE tail, a `?from=seq` snapshot, and a reopened thread.
//
// Folding is a left fold: `foldEventsToMessages(events)` and
// `foldEventsToMessages(events.slice(0, k))` agree on their common prefix, so a viewer
// can re-fold the whole trace on every SSE delta without special-casing the tail.
//
// Events handled (exactly what claude-stream / the mock emit):
//   TEXT_MESSAGE_CHUNK  → assistant bubble keyed by messageId; deltas concatenated.
//   TOOL_CALL_START     → assistant message keyed by parentMessageId, with one tool call.
//   TOOL_CALL_ARGS      → appended to that tool call's `function.arguments`.
//   TOOL_CALL_END       → no-op for message shape (boundary marker only).
//   TOOL_CALL_RESULT    → a role:"tool" message (paired later via pairToolResults).
// Anything else (e.g. the GATE_OPENED CUSTOM signal) is not a message and is skipped.
export function foldEventsToMessages(events: readonly BaseEvent[]): Message[] {
  // Insertion-ordered: a Map preserves first-seen order, which is chronological because
  // every message id (text messageId, tool parentMessageId, result messageId) is unique
  // and first appears at its position in the stream.
  const byId = new Map<string, Message>()
  // Route TOOL_CALL_ARGS back to the assistant message that owns the call.
  const messageIdByToolCallId = new Map<string, string>()

  for (const event of events) {
    const e = event as BaseEvent & {
      messageId?: string
      delta?: string
      parentMessageId?: string
      toolCallId?: string
      toolCallName?: string
      content?: string
    }

    switch (e.type) {
      case EventType.TEXT_MESSAGE_CHUNK: {
        const id = e.messageId
        if (!id) break
        const existing = byId.get(id)
        if (existing && existing.role === 'assistant') {
          existing.content = (existing.content ?? '') + (e.delta ?? '')
        } else {
          byId.set(id, { id, role: 'assistant', content: e.delta ?? '' } as AssistantMessage)
        }
        break
      }

      case EventType.TOOL_CALL_START: {
        const callId = e.toolCallId
        if (!callId) break
        // claude-stream mints a fresh parentMessageId per tool call, so each call is its
        // own assistant message — fall back to the callId if it is ever absent.
        const msgId = e.parentMessageId ?? `tc-${callId}`
        let msg = byId.get(msgId) as AssistantMessage | undefined
        if (!msg || msg.role !== 'assistant') {
          msg = { id: msgId, role: 'assistant', content: '', toolCalls: [] } as AssistantMessage
          byId.set(msgId, msg)
        }
        if (!msg.toolCalls) msg.toolCalls = []
        const call: ToolCall = {
          id: callId,
          type: 'function',
          function: { name: e.toolCallName ?? '', arguments: '' },
        }
        msg.toolCalls.push(call)
        messageIdByToolCallId.set(callId, msgId)
        break
      }

      case EventType.TOOL_CALL_ARGS: {
        const callId = e.toolCallId
        if (!callId) break
        const msgId = messageIdByToolCallId.get(callId)
        if (!msgId) break
        const msg = byId.get(msgId) as AssistantMessage | undefined
        const call = msg?.toolCalls?.find((c) => c.id === callId)
        if (call) call.function.arguments += e.delta ?? ''
        break
      }

      case EventType.TOOL_CALL_END:
        break // boundary marker only

      case EventType.TOOL_CALL_RESULT: {
        const callId = e.toolCallId
        const id = e.messageId ?? (callId ? `result-${callId}` : undefined)
        if (!id || !callId) break
        byId.set(id, { id, role: 'tool', toolCallId: callId, content: e.content ?? '' } as ToolMessage)
        break
      }

      default:
        break // not a message-bearing event (e.g. GATE_OPENED)
    }
  }

  return [...byId.values()]
}
```

- [ ] **Step 4: Export it from core**

Modify `packages/core/src/index.ts` — add after the `gate.js` line:

```ts
export * from './fold.js'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn vitest run packages/core/src/fold.test.ts -c vitest.config.ts`
Expected: PASS — 8 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/fold.ts packages/core/src/fold.test.ts packages/core/src/index.ts
git commit -m "feat(core): foldEventsToMessages — AG-UI events → Message[] (durable thread fold)"
```

---

## Task 2: Wrap `resume()` in `withRecordReplay` (Variant A, TDD)

**Files:**
- Modify: `apps/inbox/server/record-replay.ts`
- Test: `apps/inbox/server/record-replay.test.ts`

The decorator currently wraps only `run()`. Add a `resume()` with the SAME auto-semantics, keyed by `resolvedApprovalCount(handle.input.messages, approvalNames) + 1`. Only added when the wrapped provider HAS a `resume`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/inbox/server/record-replay.test.ts` (inside the file, after the existing `describe('withRecordReplay', …)` block — add a new `describe`). First add a resume-capable fake near the existing `fakeProvider`:

```ts
// A fake provider with BOTH run and resume, counting real invocations of each.
function fakeResumeProvider(runEvents: BaseEvent[], resumeEvents: BaseEvent[]) {
  let runs = 0
  let resumes = 0
  const provider: Provider = {
    async *run() {
      runs++
      for (const e of runEvents) yield e
    },
    async *resume() {
      resumes++
      for (const e of resumeEvents) yield e
    },
  }
  return { provider, runs: () => runs, resumes: () => resumes }
}

const resumeHandle = { runId: 'r1', input: step0Input } // step0Input → resolvedApprovalCount 0 → resume step 1
const approvedResolution = { gateId: 'g1', decision: 'approved' as const }
```

Then the new describe block:

```ts
describe('withRecordReplay resume()', () => {
  it('records the resume run under step (resolvedApprovalCount + 1)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cassette-'))
    const fake = fakeResumeProvider([], [ev('saved')])
    const wrapped = withRecordReplay(fake.provider, {
      key: 'wf__a',
      approvalNames: APPROVALS,
      dir,
      mode: 'replay',
    })
    const out = await collect(wrapped.resume!(resumeHandle, approvedResolution))
    expect(out).toEqual([ev('saved')])
    expect(fake.resumes()).toBe(1)
    // step0Input has 0 resolved approvals → resume is recorded at step 1
    expect(await new CassetteStore(dir, 'wf__a').readStep(1)).toEqual([ev('saved')])
  })

  it('replays a recorded resume step WITHOUT calling the real provider', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cassette-'))
    const fake = fakeResumeProvider([], [ev('saved')])
    await new CassetteStore(dir, 'wf__a').writeStep(1, [ev('from-disk')])
    const wrapped = withRecordReplay(fake.provider, {
      key: 'wf__a',
      approvalNames: APPROVALS,
      dir,
      mode: 'replay',
    })
    const out = await collect(wrapped.resume!(resumeHandle, approvedResolution))
    expect(out).toEqual([ev('from-disk')])
    expect(fake.resumes()).toBe(0)
  })

  it('does NOT add resume when the wrapped provider has none', () => {
    const dir = '/tmp/unused'
    const noResume: Provider = {
      async *run() {},
    }
    const wrapped = withRecordReplay(noResume, {
      key: 'wf__a',
      approvalNames: APPROVALS,
      dir,
      mode: 'replay',
    })
    expect(wrapped.resume).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run apps/inbox/server/record-replay.test.ts -c vitest.config.ts`
Expected: FAIL — `wrapped.resume is not a function` (resume not yet implemented).

- [ ] **Step 3: Implement the resume wrap**

In `apps/inbox/server/record-replay.ts`, update the import to add the resume types:

```ts
import {
  resolvedApprovalCount,
  type Provider,
  type Message,
  type ResumeHandle,
  type GateResolution,
} from '@platform/core'
```

Replace the `withRecordReplay` function body with (run() unchanged; resume() added conditionally):

```ts
export function withRecordReplay(
  provider: Provider,
  opts: { key: string; approvalNames: readonly string[]; dir: string; mode: RecordReplayMode }
): Provider {
  const base: Provider = {
    async *run(input: RunAgentInput): AsyncIterable<BaseEvent> {
      const messages = (input.messages ?? []) as Message[]
      const step = resolvedApprovalCount(messages, opts.approvalNames)
      const store = new CassetteStore(opts.dir, opts.key)

      if (opts.mode === 'replay') {
        const recorded = await store.readStep(step)
        if (recorded) {
          yield* recorded
          return
        }
      }

      const captured: BaseEvent[] = []
      for await (const event of provider.run(input)) {
        captured.push(event)
        yield event
      }
      await store.writeStep(step, captured)
    },
  }

  // Wrap resume() with the SAME auto-semantics, keyed one past the resolved-approval
  // count of the handle's input (the gate being resolved is the NEXT step). Only when
  // the underlying provider has a resume — a resume-less provider stays resume-less.
  if (!provider.resume) return base
  const resume = provider.resume.bind(provider)
  return {
    ...base,
    async *resume(handle: ResumeHandle, resolution: GateResolution): AsyncIterable<BaseEvent> {
      const messages = (handle.input?.messages ?? []) as Message[]
      const step = resolvedApprovalCount(messages, opts.approvalNames) + 1
      const store = new CassetteStore(opts.dir, opts.key)

      if (opts.mode === 'replay') {
        const recorded = await store.readStep(step)
        if (recorded) {
          yield* recorded
          return
        }
      }

      const captured: BaseEvent[] = []
      for await (const event of resume(handle, resolution)) {
        captured.push(event)
        yield event
      }
      await store.writeStep(step, captured)
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run apps/inbox/server/record-replay.test.ts -c vitest.config.ts`
Expected: PASS — existing tests + 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/server/record-replay.ts apps/inbox/server/record-replay.test.ts
git commit -m "feat(server): record/replay wraps resume() too (step key = resolvedApprovalCount+1)"
```

---

## Task 3: Extract `buildProvider` from `build-agent.ts`

**Files:**
- Modify: `apps/inbox/server/build-agent.ts`

Expose the raw wrapped `Provider` so the RunObserver gets it through the exact same path (registry resolve + record/replay wrap) the CopilotKit agents use.

- [ ] **Step 1: Refactor**

Replace the body of `apps/inbox/server/build-agent.ts` (keep imports; add a `Provider` import):

```ts
import { BuiltInAgent } from '@copilotkit/runtime/v2'
import type {
  AgentDefinition,
  ProviderRegistry,
  PromptStrategy,
  Provider,
} from '@platform/core'
import { withRecordReplay, recordReplayMode, cassettesDir } from './record-replay.js'

// Resolves the provider FACTORY for an agent passport and constructs the provider from
// the passport (approvals/tools) + this agent's prompt strategy, then wraps it in the
// dev record/replay decorator when DEV_RECORD_REPLAY is set (unset ⇒ byte-identical
// production path). `instanceKey` (wf__agent) is the cassette key.
//
// Returns the raw Provider so both buildAgent (CopilotKit transport) and the step-2
// RunObserver spike consume the SAME wrapped provider through one code path.
export function buildProvider(
  def: AgentDefinition,
  prompts: PromptStrategy,
  registry: ProviderRegistry,
  allowedTools: readonly string[],
  instanceKey: string
): Provider {
  const makeProvider = registry.resolve(def.provider)
  let provider = makeProvider({
    approvalNames: def.approvals,
    surfaceTools: def.tools,
    allowedTools,
    prompts,
  })

  const mode = recordReplayMode()
  if (mode) {
    provider = withRecordReplay(provider, {
      key: instanceKey,
      approvalNames: def.approvals,
      dir: cassettesDir(),
      mode,
    })
  }

  return provider
}

// Builds the CopilotKit BuiltInAgent for an agent passport, driving the provider built
// by buildProvider.
export function buildAgent(
  def: AgentDefinition,
  prompts: PromptStrategy,
  registry: ProviderRegistry,
  allowedTools: readonly string[],
  instanceKey: string
): BuiltInAgent {
  const provider = buildProvider(def, prompts, registry, allowedTools, instanceKey)
  return new BuiltInAgent({
    type: 'custom',
    factory: ({ input }) => provider.run(input),
  })
}
```

- [ ] **Step 2: Verify typecheck**

Run: `yarn typecheck`
Expected: PASS (no callers broke — `buildAgent`'s signature is unchanged).

- [ ] **Step 3: Commit**

```bash
git add apps/inbox/server/build-agent.ts
git commit -m "refactor(server): extract buildProvider from buildAgent (shared by RunObserver)"
```

---

## Task 4: RunObserver + in-memory store + dev route factory

**Files:**
- Create: `apps/inbox/server/dev-runs.ts`

THROWAWAY. An in-memory store of WorkItem runs, a consume loop that tees `provider.run()` / `provider.resume()` into a `trace[]` + EventEmitter, and a Hono route factory for the two READ endpoints (durable shapes) + dev start/resolve (throwaway).

- [ ] **Step 1: Write the module**

Create `apps/inbox/server/dev-runs.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { BaseEvent, RunAgentInput } from '@ag-ui/client'
import {
  readGateOpened,
  type GateOpenedValue,
  type GateResolution,
  type Provider,
  type ResumeHandle,
} from '@platform/core'

// ───────────────────────────────────────────────────────────────────────────
// STEP-2 SPIKE — THROWAWAY. Replaced at step 3 by Postgres-backed Trace + the
// dispatch chokepoint. The READ endpoint shapes (trace snapshot + SSE tail) and
// the per-WorkItem seq cursor are the parts that must survive.
// ───────────────────────────────────────────────────────────────────────────

type RunStatus = 'running' | 'awaiting_approval' | 'done' | 'error'

interface TraceEntry {
  seq: number
  event: BaseEvent
}

interface WorkItemRun {
  id: string
  agentKey: string
  status: RunStatus
  trace: TraceEntry[]
  emitter: EventEmitter
  done: boolean
  gate?: GateOpenedValue
  input: RunAgentInput
}

const runs = new Map<string, WorkItemRun>()

function setStatus(run: WorkItemRun, status: RunStatus): void {
  run.status = status
  run.done = status === 'done' || status === 'error'
  run.emitter.emit('status', status)
}

// Append one event to the trace (seq = current length), publish it, and react to a
// GATE_OPENED signal by flipping the run to awaiting_approval and capturing the gate.
function pushEvent(run: WorkItemRun, event: BaseEvent): void {
  const entry: TraceEntry = { seq: run.trace.length, event }
  run.trace.push(entry)
  run.emitter.emit('event', entry)
  const gate = readGateOpened(event)
  if (gate) {
    run.gate = gate
    setStatus(run, 'awaiting_approval')
  }
}

async function consume(run: WorkItemRun, iterable: AsyncIterable<BaseEvent>): Promise<void> {
  for await (const event of iterable) pushEvent(run, event)
}

// Minimal valid RunAgentInput. In DEV_RECORD_REPLAY mode the prompt is irrelevant —
// the cassette step keys on resolvedApprovalCount (0 here) → replays the agent's step 0.
function minimalInput(): RunAgentInput {
  return {
    threadId: randomUUID(),
    runId: randomUUID(),
    state: {},
    messages: [],
    tools: [],
    context: [],
    forwardedProps: {},
  } as RunAgentInput
}

// `getProvider(agentKey)` returns the SAME wrapped Provider the CopilotKit agents use
// (built via buildProvider in index.ts).
export function createDevRunsRoutes(getProvider: (agentKey: string) => Provider | undefined): Hono {
  const app = new Hono()

  // START a run (dev throwaway — step 3 starts via the dispatch chokepoint).
  app.post('/api/dev/runs', async (c) => {
    const { agent } = await c.req.json<{ agent: string }>()
    const provider = getProvider(agent)
    if (!provider) return c.json({ error: `unknown agent: ${agent}` }, 404)

    const run: WorkItemRun = {
      id: randomUUID(),
      agentKey: agent,
      status: 'running',
      trace: [],
      emitter: new EventEmitter(),
      done: false,
      input: minimalInput(),
    }
    run.emitter.setMaxListeners(0) // many SSE tails may attach
    runs.set(run.id, run)

    // Fire-and-forget so the client can attach mid-run.
    void (async () => {
      try {
        await consume(run, provider.run(run.input))
        if (run.status === 'running') setStatus(run, 'done')
      } catch {
        setStatus(run, 'error')
      }
    })()

    return c.json({ id: run.id })
  })

  // JSON history snapshot from `?from=seq` (durable shape).
  app.get('/api/workitems/:id/trace', (c) => {
    const run = runs.get(c.req.param('id'))
    if (!run) return c.json({ error: 'not found' }, 404)
    const from = Number(c.req.query('from') ?? 0)
    return c.json({
      id: run.id,
      status: run.status,
      done: run.done,
      nextSeq: run.trace.length,
      events: run.trace.slice(from),
    })
  })

  // SSE tail (durable shape). Attaches listeners BEFORE flushing the backlog so no
  // event slips through the gap; the client dedupes/orders by `seq` (the SSE `id`),
  // so duplicate or out-of-order delivery on reconnect is harmless.
  app.get('/api/workitems/:id/stream', (c) => {
    const run = runs.get(c.req.param('id'))
    if (!run) return c.json({ error: 'not found' }, 404)
    const lastId = c.req.header('Last-Event-ID')
    const from = lastId !== undefined && lastId !== '' ? Number(lastId) + 1 : Number(c.req.query('from') ?? 0)

    return streamSSE(c, async (stream) => {
      await new Promise<void>((resolve) => {
        const writeEvent = (entry: TraceEntry) => {
          if (entry.seq < from) return
          void stream.writeSSE({ id: String(entry.seq), data: JSON.stringify(entry.event) }).catch(() => {})
        }
        const onStatus = (status: RunStatus) => {
          void stream.writeSSE({ event: 'status', data: status }).catch(() => {})
          if (status === 'done' || status === 'error') cleanup()
        }
        const cleanup = () => {
          run.emitter.off('event', writeEvent)
          run.emitter.off('status', onStatus)
          resolve()
        }
        run.emitter.on('event', writeEvent)
        run.emitter.on('status', onStatus)
        stream.onAbort(cleanup)

        // Backlog (after attaching — dupes are fine, client orders by seq).
        for (const entry of run.trace) writeEvent(entry)
        void stream.writeSSE({ event: 'status', data: run.status }).catch(() => {})
        if (run.done) cleanup()
      })
    })
  })

  // RESOLVE a gate (dev throwaway — step 4 = gate-keyed /api/gates/:id/resolve with
  // transition() + ledger). Here it only flips the in-memory flag and resumes.
  app.post('/api/dev/workitems/:id/resolve', async (c) => {
    const run = runs.get(c.req.param('id'))
    if (!run) return c.json({ error: 'not found' }, 404)
    if (!run.gate) return c.json({ error: 'no open gate' }, 409)
    const provider = getProvider(run.agentKey)
    if (!provider?.resume) return c.json({ error: 'provider has no resume' }, 400)

    const body = await c.req.json<{ decision: 'approved' | 'rejected'; form?: Record<string, unknown> }>()
    const handle: ResumeHandle = { runId: run.id, input: run.input }
    const resolution: GateResolution = {
      gateId: run.gate.toolCallId,
      decision: body.decision,
      form: body.form,
    }
    const resume = provider.resume.bind(provider)

    setStatus(run, 'running')
    void (async () => {
      try {
        await consume(run, resume(handle, resolution))
        setStatus(run, 'done')
      } catch {
        setStatus(run, 'error')
      }
    })()

    return c.json({ ok: true })
  })

  return app
}
```

- [ ] **Step 2: Verify typecheck**

Run: `yarn typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/inbox/server/dev-runs.ts
git commit -m "feat(server): RunObserver spike — in-memory trace + SSE tail + dev start/resolve (throwaway)"
```

---

## Task 5: Mount dev routes + build the provider map in `index.ts`

**Files:**
- Modify: `apps/inbox/server/index.ts`

- [ ] **Step 1: Wire it up**

In `apps/inbox/server/index.ts`:

(a) Update imports — add `buildProvider` and the dev routes + a `Provider` type:

```ts
import { instanceId, type Provider } from '@platform/core'
import { providerRegistry } from './providers.js'
import { buildAgent, buildProvider } from './build-agent.js'
import { workflowServers } from './workflows.js'
import { createDevRunsRoutes } from './dev-runs.js'
```

(b) Inside the registration loop, build a parallel `providers` map alongside `agents`. Replace the loop block:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const agents: Record<string, any> = {}
const providers: Record<string, Provider> = {}
for (const { descriptor, bindings } of workflowServers) {
  const byId = new Map(descriptor.agents.map((a) => [a.agent.id, a.agent]))
  for (const b of bindings(descriptor.id)) {
    const def = byId.get(b.agentId)
    if (!def)
      throw new Error(`server binding for unknown agent "${b.agentId}" in "${descriptor.id}"`)
    const key = instanceId(descriptor.id, b.agentId)
    agents[key] = buildAgent(def, b.prompts, providerRegistry, b.allowedTools, key)
    providers[key] = buildProvider(def, b.prompts, providerRegistry, b.allowedTools, key)
  }
}
```

(c) After `app.route('/', copilot)` and BEFORE `serve(...)`, mount the dev routes:

```ts
// Step-2 spike: server-side RunObserver + browser attach (throwaway). The CopilotKit
// transport above stays the live dev surface; these routes are the parallel
// server-authoritative path being prototyped.
app.route('/', createDevRunsRoutes((key) => providers[key]))
```

- [ ] **Step 2: Verify typecheck**

Run: `yarn typecheck`
Expected: PASS.

- [ ] **Step 3: Verify the server boots and serves the snapshot endpoint**

Kill stale stacks first (per CLAUDE.md), then start one server in replay mode and probe:

```bash
pkill -9 -f "AiWorkflow/node_modules/.bin/(tsx|vite|concurrently)" 2>/dev/null; lsof -tiTCP:4000 | xargs kill -9 2>/dev/null; true
DEV_RECORD_REPLAY=1 yarn --cwd apps/inbox dev:server &
sleep 4
curl -s -X POST localhost:4000/api/dev/runs -H 'content-type: application/json' -d '{"agent":"lead-inbox__reply"}'
```

Expected: `{"id":"<uuid>"}`. Then (substitute the id):

```bash
curl -s "localhost:4000/api/workitems/<id>/trace?from=0" | head -c 400
```

Expected: JSON `{ "id":…, "status":"awaiting_approval", "done":false, "nextSeq":…, "events":[…] }` — events include a `TOOL_CALL_START`/`renderLead`, `saveDraft`, and a `CUSTOM`/`GATE_OPENED`. Then kill the server: `lsof -tiTCP:4000 | xargs kill -9`.

- [ ] **Step 4: Commit**

```bash
git add apps/inbox/server/index.ts
git commit -m "feat(server): mount RunObserver dev routes + provider map (step-2 spike)"
```

---

## Task 6: Client `?spike=1` dev page

**Files:**
- Create: `apps/inbox/client/src/spike/TraceSpike.tsx`
- Modify: `apps/inbox/client/src/main.tsx`

THROWAWAY. A standalone page (NO CopilotKit provider — that is the point) that starts a run, snapshots, folds, renders a minimal thread, tails via EventSource, and approves via POST. Orders/dedupes events by `seq`.

- [ ] **Step 1: Write the component**

Create `apps/inbox/client/src/spike/TraceSpike.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BaseEvent } from '@ag-ui/client'
import {
  foldEventsToMessages,
  pairToolResults,
  readGateOpened,
  type GateOpenedValue,
  type Message,
} from '@platform/core'

// THROWAWAY step-2 spike page. Proves: attach to a server-side run without CopilotKit,
// fold the trace, follow the live SSE tail, approve via plain POST (same tail continues).
type Status = 'running' | 'awaiting_approval' | 'done' | 'error'

const AGENT = 'lead-inbox__reply'

export const TraceSpike = () => {
  // Seed the id from the URL so a browser RELOAD re-attaches to the SAME live server-side
  // run (PASS 2: reload mid-run loses nothing). Start writes the id back into the URL.
  const [id, setId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('id')
  )
  const [status, setStatus] = useState<Status>('running')
  // Order/dedupe by seq so duplicate or out-of-order SSE delivery is harmless.
  const [bySeq, setBySeq] = useState<Map<number, BaseEvent>>(new Map())
  const esRef = useRef<EventSource | null>(null)

  const setEvent = (seq: number, event: BaseEvent) =>
    setBySeq((prev) => {
      if (prev.has(seq)) return prev
      const next = new Map(prev)
      next.set(seq, event)
      return next
    })

  const start = async () => {
    const res = await fetch('/api/dev/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: AGENT }),
    })
    const { id } = (await res.json()) as { id: string }
    window.history.replaceState(null, '', `?spike=1&id=${id}`) // survive a reload
    setId(id)
  }

  // On id: snapshot from 0 (full history → reload loses nothing), then tail from nextSeq.
  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      const snap = (await (await fetch(`/api/workitems/${id}/trace?from=0`)).json()) as {
        status: Status
        nextSeq: number
        events: { seq: number; event: BaseEvent }[]
      }
      if (cancelled) return
      setBySeq(() => new Map(snap.events.map((e) => [e.seq, e.event])))
      setStatus(snap.status)

      const es = new EventSource(`/api/workitems/${id}/stream?from=${snap.nextSeq}`)
      esRef.current = es
      es.onmessage = (m) => setEvent(Number(m.lastEventId), JSON.parse(m.data) as BaseEvent)
      es.addEventListener('status', (m) => setStatus((m as MessageEvent).data as Status))
    })()
    return () => {
      cancelled = true
      esRef.current?.close()
    }
  }, [id])

  const events = useMemo(
    () => [...bySeq.entries()].sort((a, b) => a[0] - b[0]).map(([, e]) => e),
    [bySeq]
  )
  const messages = useMemo(() => foldEventsToMessages(events), [events])
  const toolResults = useMemo(() => pairToolResults(messages), [messages])
  const gate = useMemo<GateOpenedValue | null>(() => {
    for (const e of events) {
      const g = readGateOpened(e)
      if (g) return g
    }
    return null
  }, [events])

  const approve = async () => {
    if (!id) return
    await fetch(`/api/dev/workitems/${id}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approved' }),
    })
  }

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'system-ui', padding: 16 }}>
      <h1 style={{ fontSize: 18 }}>RunObserver spike — {AGENT}</h1>
      {!id ? (
        <button onClick={start}>Start reply run</button>
      ) : (
        <p>
          WorkItem <code>{id.slice(0, 8)}</code> · status: <strong>{status}</strong>
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
        {messages.map((m: Message) => (
          <ThreadRow key={m.id} message={m} toolResults={toolResults} />
        ))}
      </div>

      {status === 'awaiting_approval' && gate && (
        <div style={{ marginTop: 16, padding: 12, border: '1px solid #d97706', borderRadius: 8 }}>
          <p style={{ margin: 0 }}>
            ⏸ Awaiting approval — <strong>{gate.toolName}</strong>
          </p>
          <pre style={{ fontSize: 12, overflow: 'auto' }}>
            {JSON.stringify(gate.proposedArtifact, null, 2)}
          </pre>
          <button onClick={approve}>Approve</button>
        </div>
      )}
    </div>
  )
}

const ThreadRow = ({
  message,
  toolResults,
}: {
  message: Message
  toolResults: ReturnType<typeof pairToolResults>
}) => {
  if (message.role === 'assistant') {
    return (
      <div>
        {typeof message.content === 'string' && message.content && (
          <div style={{ background: '#f3f4f6', borderRadius: 8, padding: '8px 12px' }}>
            {message.content}
          </div>
        )}
        {Array.isArray(message.toolCalls) &&
          message.toolCalls.map((tc) => {
            const done = toolResults.has(tc.id)
            return (
              <div key={tc.id} style={{ fontSize: 13, color: '#374151', marginTop: 4 }}>
                🔧 <strong>{tc.function.name}</strong> — {done ? 'done' : 'running'}
              </div>
            )
          })}
      </div>
    )
  }
  return null // tool results are surfaced via the chip's done/running flag
}
```

- [ ] **Step 2: Branch on `?spike=1` in main.tsx**

Replace `apps/inbox/client/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { TraceSpike } from './spike/TraceSpike.js'
import './styles.css'

const spike = new URLSearchParams(window.location.search).get('spike') === '1'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{spike ? <TraceSpike /> : <App />}</StrictMode>
)
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `yarn typecheck && yarn lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/inbox/client/src/spike/TraceSpike.tsx apps/inbox/client/src/main.tsx
git commit -m "feat(client): ?spike=1 RunObserver attach page — fold + SSE tail + approve (throwaway)"
```

---

## Task 7: Browser E2E verification + HANDOFF update

**Files:**
- Modify: `HANDOFF.md`

- [ ] **Step 1: Start one clean dev server in replay mode**

Per CLAUDE.md, kill stale stacks and free ports first:

```bash
pkill -9 -f "AiWorkflow/node_modules/.bin/(tsx|vite|concurrently)" 2>/dev/null
lsof -tiTCP:4000,:5173,:5174 | xargs kill -9 2>/dev/null; true
DEV_RECORD_REPLAY=1 yarn dev
```

Confirm one `server on http://localhost:4000` and one vite on `:5173`, zero `EADDRINUSE`.

- [ ] **Step 2: Run the 4 PASS checks in the browser**

Open `http://localhost:5173/?spike=1` (use the Playwright MCP / a real browser):

1. **Attach mid-run:** click "Start reply run" → the URL gains `&id=<uuid>` and the thread shows the lead card chip, the `saveDraft` chip, and an "⏸ Awaiting approval — saveDraft" banner with the proposed artifact. (PASS 1: history + tail visible.)
2. **Reload mid-run:** with status `awaiting_approval`, reload the page (the URL carries `&id=`) → the page re-attaches to the SAME live server-side run: snapshot from 0 rebuilds the full thread and the status banner, the SSE re-tails from nextSeq. Nothing is lost. (PASS 2.)
3. **Approve:** click "Approve" → WITHOUT reconnecting, the open tail appends the resume text bubble "The reply was saved as a Gmail draft in the thread (not sent)." and status flips to `done`. (PASS 3.)
4. **Stitched history after approve:** reload once more (or `curl "localhost:4000/api/workitems/<id>/trace?from=0"`) → the thread/event list contains BOTH the pre-gate events AND the post-approval text — one trace, two provider runs. (PASS 4.)

- [ ] **Step 3: Confirm replay (no real claude)**

Note the `lead-inbox__reply.jsonl` mtime before and after the run:

```bash
stat -f '%m %N' apps/inbox/.cassettes/lead-inbox__reply.jsonl
```

Expected: unchanged across the run (true replay; step 0 + step 1 already recorded). If it changes, the resume step was missing and got recorded — re-run to confirm it then replays.

- [ ] **Step 4: Full gate green**

```bash
yarn typecheck && yarn test && yarn lint && yarn format:check
```

Expected: all PASS.

- [ ] **Step 5: Update HANDOFF.md**

Mark step 2 BUILT & browser-verified under the build order: note what survives (the trace/stream endpoint shapes + `foldEventsToMessages`), what was throwaway (in-memory store, dev start/resolve, `?spike=1`), the PASS-2 endpoint-level caveat, and that step 3 starts the Postgres spine. Point to this plan + the spec.

- [ ] **Step 6: Commit**

```bash
git add HANDOFF.md
git commit -m "docs(handoff): step 2 (RunObserver + browser attach) BUILT & browser-verified"
```

---

## Self-Review

**Spec coverage:**
- §3.1 fold → Task 1 ✓
- §3.2 RunObserver/store → Task 4 ✓
- §3.3 endpoints (trace snapshot, SSE tail, dev start, dev resolve) → Task 4 + Task 5 ✓
- §3.4 buildProvider extraction → Task 3 ✓
- §3.5 client `?spike=1` page → Task 6 ✓
- §4 resume record/replay (Variant A) → Task 2 ✓
- §6 verification (typecheck/test/lint/format + browser E2E + replay confirm) → Task 5 step 3, Task 7 ✓

**Placeholder scan:** no TBD/TODO; every code step shows full code; commands have expected output.

**Type consistency:** `buildProvider` signature matches its call in Task 5; `WorkItemRun`/`TraceEntry`/`RunStatus` consistent across Task 4; `foldEventsToMessages`/`pairToolResults`/`readGateOpened`/`GateOpenedValue` are real `@platform/core` exports used consistently; `ResumeHandle`/`GateResolution` shapes match `providers.ts`; SSE `id`=seq / `event: status` consistent between server (Task 4) and client (Task 6).

**PASS 2 demonstrated genuinely:** the WorkItem id rides in the URL (`?spike=1&id=…`), so a browser reload re-attaches to the same still-alive in-memory server run (snapshot from 0 + SSE re-tail). The only loss boundary is a SERVER restart (in-memory store) — which is exactly what step 3's Postgres-backed Trace removes; note that boundary in the HANDOFF but don't build durability now (out of scope, 2-day timebox).
```
