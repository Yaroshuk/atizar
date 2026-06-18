# Agent-to-Agent Return Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the honest agent-to-agent return channel — an agent asks another agent mid-task, suspends in a new `awaiting_agent` phase, and wakes with the answer — server-authoritative, bounded, auditable.

**Architecture:** Synthesis of "V2 separation" + "V3 contract honesty" from the design (`docs/superpowers/specs/2026-06-18-agent-return-channel-design.md`): a separate `AGENT_QUESTION` signal, a new `awaiting_agent` phase + `ask`/`answered` edges, the gate stays human-only, hub routing is workflow policy; the resume payload becomes an honest discriminated union `{kind:'gate'} | {kind:'answer'}` that REUSES the existing resume mechanism (no second path). Built on the current Phase/Outcome lifecycle + keyed-instance model (both BUILT & LOCKED 2026-06-16).

**Tech Stack:** TypeScript, Zod, AG-UI event vocabulary (`@ag-ui/client`), Hono, Drizzle + Postgres, claude-cli + Mastra + mock providers, Vitest, yarn-classic workspace.

## Global Constraints

- All content (code, comments, identifiers, docs) is **English** regardless of chat language.
- Prettier: `semi:false`, single quotes, `trailingComma:"es5"`, `printWidth:100`. ESLint must stay GREEN.
- `@atizar/core` is **isomorphic** — no React, no Node imports. Providers stay Node-free (`spawn` injected).
- **Config-as-data (I7):** wire strings via `as const` maps, never TS enums; operator-tunable limits are declared params, never hardcoded in prose.
- **Single source of truth:** "waiting on an agent" = the work-item phase `awaiting_agent` and nothing else; "question pending/answered/failed/timed-out" derives from the one `questions` row; the conversation round counter lives in one place.
- **Framework/workflow boundary (I5):** the mechanism (signal, phase+edges, `questions` record, resume union, bound, timeout) is framework; the routing (who the hub is, which agent answers), the prompts, and the tunable limits are workflow policy. The framework carries **zero** agent-id literals — a question `target` is opaque.
- Commands run from the **repo root** with `yarn`. Commit only when the developer asks; stage specific paths, never `git add -A`. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **`check-foundation` runs BEFORE Task 4** (the `resume` contract change touches I14/I3/I4) and is re-affirmed before Plan 2 (the `ask`/`answered` edges + new phase touch I8). The developer has consciously approved building this; the skill run keeps it honest.
- Work happens on a feature branch off `master` (create via `superpowers:using-git-worktrees` at execution start — we are currently on `master`).

---

# PLAN 1 — Core contract + both providers + conformance

**Delivers:** the `AGENT_QUESTION` signal, the `asks` tool class, the `awaiting_agent` phase in the lifecycle classifier, the honest `ResumePayload` union + the `buildResumeFromAnswer` prompt hook, both real providers branching on `payload.kind`, and a provider-conformance check proving answer-resume parity. Entirely testable with `@atizar/core` unit tests + provider conformance — **no DB required.** The contract change is **additive** (`kind` optional on `GateResolution`) so the `@atizar/server` package still typechecks before Plan 2 wires the callers.

**Why first:** it lays the protected-core contract exactly once, with I4 conformance proving it didn't leak, before any server orchestration depends on it.

### Task 1: The `AGENT_QUESTION` signal

**Files:**
- Create: `packages/core/src/question.ts`
- Test: `packages/core/src/question.test.ts`
- Modify: `packages/core/src/index.ts` (export the new symbols)

**Interfaces:**
- Produces: `AGENT_QUESTION` const, `AgentQuestionValueSchema`, `AgentQuestionValue` type, `agentQuestion(value): CustomEvent`, `readAgentQuestion(event): AgentQuestionValue | null`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/question.test.ts
import { describe, it, expect } from 'vitest'
import { EventType } from '@ag-ui/client'
import { agentQuestion, readAgentQuestion, AGENT_QUESTION } from './question.js'

describe('agent question signal', () => {
  const value = {
    questions: [{ toolCallId: 'tc1', target: { agentId: 'answerer' }, payload: { q: 'how?' } }],
  }

  it('round-trips a question value through the CUSTOM envelope', () => {
    const ev = agentQuestion(value)
    expect(ev.type).toBe(EventType.CUSTOM)
    expect(ev.name).toBe(AGENT_QUESTION)
    expect(readAgentQuestion(ev)).toEqual(value)
  })

  it('returns null for a non-question event', () => {
    expect(readAgentQuestion({ type: EventType.TEXT_MESSAGE_CHUNK } as never)).toBeNull()
  })

  it('returns null for a malformed question payload', () => {
    const bad = { type: EventType.CUSTOM, name: AGENT_QUESTION, value: { questions: 'nope' } }
    expect(readAgentQuestion(bad as never)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn test packages/core/src/question.test.ts`
Expected: FAIL — `Cannot find module './question.js'`.

- [ ] **Step 3: Implement `question.ts`**

```ts
// packages/core/src/question.ts
import { EventType, type BaseEvent, type CustomEvent } from '@ag-ui/client'
import { z } from 'zod'

// A provider-agnostic "an agent just asked another agent a question" signal, carried as an AG-UI
// CUSTOM event (mirrors gate.ts GATE_OPENED): it stays inside the AG-UI vocabulary, survives
// record/replay as an ordinary BaseEvent, and is ignored by consumers that don't know it. The
// provider emits it at the suspend point; the server turns it into questions row(s) and suspends
// the asker into the `awaiting_agent` phase.
export const AGENT_QUESTION = 'AGENT_QUESTION' as const

// Shaped for fan-out from day one: an asker may emit several questions in one signal (the server
// joins on all answers before waking). Pass 1 always has length 1. `target` is OPAQUE — the core
// never knows which agent it is; a workflow-provided router resolves it (I5). The runId/transcript
// are NOT carried here — the orchestrator builds the resume handle from the { runId, input } it holds.
export const AgentQuestionValueSchema = z.object({
  questions: z
    .array(
      z.object({
        toolCallId: z.string(), // correlates with the TOOL_CALL_* events of the ask tool call
        target: z.unknown(), // opaque destination descriptor; the workflow router resolves it
        payload: z.record(z.unknown()), // the question body the answerer is seeded with
      })
    )
    .min(1),
})
export type AgentQuestionValue = z.infer<typeof AgentQuestionValueSchema>

export function agentQuestion(value: AgentQuestionValue): CustomEvent {
  return { type: EventType.CUSTOM, name: AGENT_QUESTION, value }
}

// Recognize + parse a question signal from any BaseEvent. Returns null for non-question events AND
// for a malformed payload (so a bad value never reaches a consumer as a "valid" question).
export function readAgentQuestion(event: BaseEvent): AgentQuestionValue | null {
  const e = event as { type: EventType; name?: string; value?: unknown }
  if (e.type !== EventType.CUSTOM || e.name !== AGENT_QUESTION) return null
  const parsed = AgentQuestionValueSchema.safeParse(e.value)
  return parsed.success ? parsed.data : null
}
```

- [ ] **Step 4: Export from the core barrel**

In `packages/core/src/index.ts`, beside the `gate.js` export, add:

```ts
export * from './question.js'
```

(If the file uses explicit named re-exports rather than `export *`, mirror the `gate.ts` line and add `AGENT_QUESTION`, `agentQuestion`, `readAgentQuestion`, `AgentQuestionValueSchema`, and `type AgentQuestionValue`.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn test packages/core/src/question.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/question.ts packages/core/src/question.test.ts packages/core/src/index.ts
git commit -m "feat(core): AGENT_QUESTION signal (agent-to-agent ask)"
```

### Task 2: The `asks` tool class in `defineAgent`

**Files:**
- Modify: `packages/core/src/defineAgent.ts`
- Test: `packages/core/src/defineAgent.test.ts` (add cases)

**Interfaces:**
- Produces: `AgentDefinition.asks: string[]` (validated `⊆ tools`, default `[]`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/defineAgent.test.ts — ADD these cases
import { describe, it, expect } from 'vitest'
import { defineAgent } from './defineAgent.js'

describe('defineAgent asks tool class', () => {
  const base = {
    id: 'a', name: 'A', provider: 'mock', instructions: 'x',
    tools: ['ask_peer'], approvals: [], renders: {},
  }

  it('accepts an ask tool declared in tools', () => {
    const def = defineAgent({ ...base, asks: ['ask_peer'] })
    expect(def.asks).toEqual(['ask_peer'])
  })

  it('defaults asks to []', () => {
    expect(defineAgent(base).asks).toEqual([])
  })

  it('rejects an ask tool not declared in tools', () => {
    expect(() => defineAgent({ ...base, asks: ['ghost'] })).toThrow(/ask "ghost" is not declared in tools/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn test packages/core/src/defineAgent.test.ts`
Expected: FAIL — `asks` is undefined / no validation error thrown.

- [ ] **Step 3: Add the `asks` field + superRefine check**

In `packages/core/src/defineAgent.ts`, inside the `.object({...})`, after the `dispatches` field (line ~29):

```ts
    // Tools the model calls to ASK another agent and SUSPEND until the answer returns (the return
    // channel). Distinct from `dispatches` (fire-and-forget): an ask suspends the asker into
    // `awaiting_agent`. Declared so the boot-time I15 classification stays exhaustive.
    asks: z.array(z.string()).default([]),
```

In the `.superRefine((def, ctx) => {...})`, after the `dispatches` loop (line ~63):

```ts
    for (const name of def.asks) {
      if (!def.tools.includes(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `ask "${name}" is not declared in tools`,
        })
      }
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test packages/core/src/defineAgent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/defineAgent.ts packages/core/src/defineAgent.test.ts
git commit -m "feat(core): asks tool class on defineAgent (I15 classification)"
```

### Task 3: The `awaiting_agent` phase in the lifecycle classifier

**Files:**
- Modify: `packages/core/src/lifecycle.ts`
- Test: `packages/core/src/lifecycle.test.ts` (add cases)

**Interfaces:**
- Produces: `Phase` union gains `'awaiting_agent'`; `lifecycle('awaiting_agent', …)` is live + visible + covers.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/lifecycle.test.ts — ADD this case
import { describe, it, expect } from 'vitest'
import { lifecycle } from './lifecycle.js'

describe('awaiting_agent phase', () => {
  it('is live, visible, and covers (a suspended asker holds its source)', () => {
    const lc = lifecycle('awaiting_agent', 'running', false, false)
    expect(lc.isLive).toBe(true)
    expect(lc.isVisible).toBe(true)
    expect(lc.covers).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn test packages/core/src/lifecycle.test.ts`
Expected: FAIL — TS rejects `'awaiting_agent'` as a `Phase` (and/or it is not classified live).

- [ ] **Step 3: Add `awaiting_agent` to the Phase union + LIVE_PHASES**

In `packages/core/src/lifecycle.ts`, line 8:

```ts
// awaiting_agent = suspended waiting on ANOTHER AGENT's answer (the return channel). A live,
// visible pause like awaiting_human, but resolved by an agent answer (transition `answered`),
// not a human gate. Distinct phase so the UI + classifier never confuse it with a human gate.
export type Phase = 'queued' | 'active' | 'awaiting_human' | 'awaiting_agent' | 'terminal'
```

Line 45:

```ts
const LIVE_PHASES: ReadonlySet<Phase> = new Set(['queued', 'active', 'awaiting_human', 'awaiting_agent'])
```

(`isVisible` and `covers` follow automatically: `isLive` ⇒ `isVisible: true` via line 72, and `covers = isLive || …` via line 76. No other change needed in `lifecycle()`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test packages/core/src/lifecycle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lifecycle.ts packages/core/src/lifecycle.test.ts
git commit -m "feat(core): awaiting_agent lifecycle phase (return-channel suspend)"
```

### Task 4: The `ResumePayload` union + `buildResumeFromAnswer` hook

> **Run `check-foundation` before this task** — it changes the provider/core resume contract (I14/I3/I4). The change is additive and server-authoritative; confirm with the developer per the skill.

**Files:**
- Modify: `packages/core/src/providers.ts`
- Modify: `packages/core/src/definePrompt.ts`
- Test: `packages/core/src/definePrompt.test.ts` (add a case)

**Interfaces:**
- Produces: `GateResolution.kind?: 'gate'` (optional, back-compatible), `AnswerResolution` interface, `ResumePayload` union, `Provider.resume(handle, payload: ResumePayload)`, `PromptStrategy.buildResumeFromAnswer?(answers): ResumeOutcome`, `PromptSpec.onAnswer?`.

- [ ] **Step 1: Write the failing test (definePrompt forwards an answer)**

```ts
// packages/core/src/definePrompt.test.ts — ADD this case
import { describe, it, expect } from 'vitest'
import { definePrompt } from './definePrompt.js'

describe('definePrompt onAnswer', () => {
  it('wires onAnswer into buildResumeFromAnswer', () => {
    const strat = definePrompt({
      onStart: () => 'start',
      onAnswer: (answers) => ({ kind: 'prompt', text: `got ${answers.length} answers` }),
    })
    expect(strat.buildResumeFromAnswer).toBeDefined()
    expect(strat.buildResumeFromAnswer!([{ target: {}, answer: { a: 1 }, ok: true }])).toEqual({
      kind: 'prompt',
      text: 'got 1 answers',
    })
  })

  it('leaves buildResumeFromAnswer undefined when onAnswer is omitted', () => {
    expect(definePrompt({ onStart: () => 'start' }).buildResumeFromAnswer).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn test packages/core/src/definePrompt.test.ts`
Expected: FAIL — `onAnswer` not accepted / `buildResumeFromAnswer` undefined.

- [ ] **Step 3: Generalize the resume payload in `providers.ts`**

In `packages/core/src/providers.ts`, change the `GateResolution` interface (line 25) to add an OPTIONAL discriminant (optional keeps every existing caller compiling — Plan 2 sets it explicitly):

```ts
export interface GateResolution {
  // Optional discriminant: absent ⇒ a gate resolution (the default arm). Plan 2's callers set
  // it explicitly; existing callers that omit it still typecheck and behave as a gate.
  kind?: 'gate'
  gateId: string
  decision: 'approved' | 'rejected'
  form?: Record<string, unknown>
  comment?: string
  executedResult?: Record<string, unknown>
}

// An agent answer delivered back to a suspended asker (the return channel). Carries one entry per
// outstanding question (Pass 1: exactly one). `ok` is per-answer; `allOk` is the join verdict the
// asker's prompt branches on. NOT a GateResolution — an answer has no gateId/decision (the patch
// the design rejected); its own honest type instead.
export interface AnswerResolution {
  kind: 'answer'
  answers: { target: unknown; answer: Record<string, unknown>; ok: boolean }[]
  allOk: boolean
}

// What the orchestrator hands a provider to resume a suspended run. The provider branches on `kind`
// and REUSES one resume mechanism for both (no second path): gate-resume and answer-resume differ
// only in the prompt the strategy builds.
export type ResumePayload = GateResolution | AnswerResolution
```

Change the `Provider.resume` signature (line 10):

```ts
  resume?(handle: ResumeHandle, payload: ResumePayload): AsyncIterable<BaseEvent>
```

Add the sibling hook to `PromptStrategy` (after `buildResume`, line ~54):

```ts
  // Resume after an AGENT ANSWER (the return channel), parallel to buildResume (human gate). Builds
  // the resume prompt from the delivered answers. Omit for an agent that never asks.
  buildResumeFromAnswer?(
    answers: AnswerResolution['answers']
  ): ResumeOutcome
```

- [ ] **Step 4: Wire `onAnswer` through `definePrompt`**

In `packages/core/src/definePrompt.ts`, add to `PromptSpec<T>` (after `onResume`, line ~19):

```ts
  // Resume after an agent ANSWER (the return channel). `answers` is one entry per outstanding
  // question. Returns a ResumeOutcome like onResume. Omit for an agent that never asks.
  onAnswer?: (answers: { target: unknown; answer: Record<string, unknown>; ok: boolean }[]) => ResumeOutcome
```

Update the import (line 4) and the returned strategy (line ~37):

```ts
import type { PromptStrategy, ResumeOutcome, AnswerResolution } from './providers.js'
```

```ts
    buildResume: onResume
      ? (_args: Record<string, unknown>, executedResult?: Record<string, unknown>): ResumeOutcome =>
          onResume(executedResult ?? {})
      : undefined,
    buildResumeFromAnswer: spec.onAnswer
      ? (answers: AnswerResolution['answers']): ResumeOutcome => spec.onAnswer!(answers)
      : undefined,
```

- [ ] **Step 5: Run the test + typecheck to verify green**

Run: `yarn test packages/core/src/definePrompt.test.ts && yarn typecheck`
Expected: PASS — the additive `kind?` keeps `@atizar/server` and `@atizar/providers` compiling (their `resume` callers pass a `GateResolution` that satisfies `ResumePayload`).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/providers.ts packages/core/src/definePrompt.ts packages/core/src/definePrompt.test.ts
git commit -m "feat(core): ResumePayload union + buildResumeFromAnswer (honest answer-resume contract)"
```

### Task 5: Both providers branch on an answer resume

**Files:**
- Modify: `packages/providers/src/mock-provider.ts`
- Modify: `packages/providers/src/claude-cli-provider.ts`
- Modify: `packages/providers/src/mastra-provider.ts`
- Test: `packages/providers/src/mock-provider.test.ts` (add a case; create if absent)

**Interfaces:**
- Consumes: `ResumePayload`, `AnswerResolution` from `@atizar/core` (Task 4).
- Produces: each provider's `resume` accepts `ResumePayload` and yields an answer-driven turn when `payload.kind === 'answer'`.

- [ ] **Step 1: Write the failing test (mock resumes from an answer)**

```ts
// packages/providers/src/mock-provider.test.ts — ADD (create the file if it does not exist)
import { describe, it, expect } from 'vitest'
import { EventType, type BaseEvent } from '@ag-ui/client'
import { createMockInboxProvider } from './mock-provider.js'

async function collect(it: AsyncIterable<BaseEvent>): Promise<BaseEvent[]> {
  const out: BaseEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

describe('mock provider answer-resume', () => {
  it('yields a turn that reflects the delivered answer', async () => {
    const p = createMockInboxProvider(['saveDraft'])
    const events = await collect(
      p.resume!(
        { runId: 'r1', input: { messages: [] } as never },
        { kind: 'answer', answers: [{ target: {}, answer: { text: 'use X' }, ok: true }], allOk: true }
      )
    )
    expect(events.length).toBeGreaterThan(0)
    const text = events
      .filter((e) => e.type === EventType.TEXT_MESSAGE_CHUNK)
      .map((e) => (e as unknown as { delta: string }).delta)
      .join('')
    expect(text).toContain('answer')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn test packages/providers/src/mock-provider.test.ts`
Expected: FAIL — `resume` ignores `kind` / treats the answer payload as a gate (reads `decision`).

- [ ] **Step 3: Branch the mock provider on `kind`**

In `packages/providers/src/mock-provider.ts`, update the import (line 2) to add `type ResumePayload`, and replace the `resume` body (line 71):

```ts
    async *resume(_handle: ResumeHandle, payload: ResumePayload): AsyncIterable<BaseEvent> {
      if (payload.kind === 'answer') {
        const ok = payload.allOk ? 'an answer' : 'no usable answer'
        yield textChunk(`Continuing with ${ok} from the peer agent.`)
        return
      }
      if (payload.decision === 'rejected') {
        yield textChunk('The human rejected the draft; nothing was saved.')
        return
      }
      yield textChunk('Draft saved to Gmail.')
    },
```

- [ ] **Step 4: Branch the claude-cli provider on `kind`**

In `packages/providers/src/claude-cli-provider.ts`, update the import (line 2) to add `type ResumePayload, type AnswerResolution`, and replace the `resume` body (line 120). Add an answer-prompt builder beside `resumePromptFrom`:

```ts
  // Build the resume prompt from an agent ANSWER (parallel to resumePromptFrom for a gate).
  function resumePromptFromAnswer(answers: AnswerResolution['answers']): string | null {
    const outcome = prompts.buildResumeFromAnswer?.(answers) ?? null
    if (outcome && outcome.kind === 'prompt') return withIdentity(outcome.text)
    return null // message/null handled server-side; nothing to spawn
  }

  return {
    async *run(input: RunAgentInput): AsyncIterable<BaseEvent> {
      /* unchanged */
```

Replace the `resume` method:

```ts
    async *resume(handle: ResumeHandle, payload: ResumePayload): AsyncIterable<BaseEvent> {
      if (payload.kind === 'answer') {
        const resumePrompt = resumePromptFromAnswer(payload.answers)
        if (!resumePrompt) return
        yield* primeAndStream(resumePrompt, [])
        return
      }
      if (payload.decision === 'rejected') {
        yield textChunk('The human rejected the proposed action; no changes were made.')
        return
      }
      const resumePrompt = resumePromptFrom(handle, payload)
      if (!resumePrompt) return // message/null handled server-side; nothing to spawn here
      yield* primeAndStream(resumePrompt, [])
    },
```

- [ ] **Step 5: Branch the mastra provider on `kind`**

In `packages/providers/src/mastra-provider.ts`, update the `resume` signature (line ~87) to take `payload: ResumePayload` and pass it through to native resume unchanged (Mastra's `runner.resume` receives the discriminated payload; the gate vs answer distinction lives in the suspended step's resume schema). Add the import for `ResumePayload`; keep `drive(runner.resume(handle.runId, payload), false)`. (The native snapshot path is symmetric for both kinds — verify against the live `mastra-provider.ts` resume body during execution.)

- [ ] **Step 6: Run the providers tests + typecheck**

Run: `yarn test packages/providers && yarn typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/providers/src/mock-provider.ts packages/providers/src/claude-cli-provider.ts packages/providers/src/mastra-provider.ts packages/providers/src/mock-provider.test.ts
git commit -m "feat(providers): branch resume on answer payload (return channel)"
```

### Task 6: Conformance — answer-resume parity (I4)

**Files:**
- Modify: `packages/core/src/conformance.ts`
- Modify: the provider conformance test(s) that supply a `ConformanceScenario` (find via `grep -rl providerConformanceChecks packages`) to add an `answered` fixture.

**Interfaces:**
- Consumes: `AnswerResolution`, the existing `ConformanceScenario`.
- Produces: a new `ConformanceCheck` "resume(answer) completes and re-opens no gate"; `ConformanceScenario` gains `answered: { handle: ResumeHandle; payload: AnswerResolution }`.

- [ ] **Step 1: Write the failing check + extend the scenario type**

In `packages/core/src/conformance.ts`, import `AnswerResolution` (line 3), add to `ConformanceScenario` (after `rejected`, line 16):

```ts
  answered: { handle: ResumeHandle; payload: AnswerResolution }
```

Add a new check to `providerConformanceChecks` (after the `rejected` check, line ~94):

```ts
  {
    name: 'resume(answer) completes and re-opens no gate',
    async run(makeProvider, s) {
      const p = makeProvider()
      assert(typeof p.resume === 'function', 'provider does not implement resume()')
      const events = await collect(p.resume!(s.answered.handle, s.answered.payload))
      assert(gatesOf(events).length === 0, 'resume(answer) re-opened a gate')
      assert(events.length > 0, 'resume(answer) produced no events')
    },
  },
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn test packages/core/src/conformance.test.ts` (or the file that runs `providerConformanceChecks`)
Expected: FAIL — the conformance scenarios don't yet supply `answered` (TS error) or the check throws.

- [ ] **Step 3: Supply the `answered` fixture in each provider's conformance test**

In each test that builds a `ConformanceScenario`, add:

```ts
answered: {
  handle: { runId: 'r1', input: { messages: [] } as never },
  payload: { kind: 'answer', answers: [{ target: {}, answer: { text: 'use X' }, ok: true }], allOk: true },
},
```

For the **claude-cli** conformance test, ensure the agent's `PromptStrategy` (the fake passed in) implements `buildResumeFromAnswer` returning `{ kind: 'prompt', text: '…' }` so the re-prime path yields events (mirror how the existing fixture supplies `buildResume`).

- [ ] **Step 4: Run the conformance tests to verify green**

Run: `yarn test packages/core && yarn test packages/providers`
Expected: PASS — answer-resume behaves identically on mock + claude-cli (I4: the contract did not leak).

- [ ] **Step 5: Full green gate**

Run: `yarn typecheck && yarn test && yarn lint && yarn format:check`
Expected: all GREEN.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/conformance.ts packages/core/src/conformance.test.ts packages/providers/src/*.test.ts
git commit -m "test(core): provider conformance for answer-resume (I4 parity)"
```

**Plan 1 acceptance:** `@atizar/core` defines the `AGENT_QUESTION` signal, the `asks` class, the `awaiting_agent` phase, and the honest `ResumePayload` union + `buildResumeFromAnswer`; both real providers branch on `payload.kind`; the conformance suite proves answer-resume parity; the whole workspace is green and the `@atizar/server` package still typechecks (the contract change was additive).

---

# PLAN 2 — Server orchestration (sequenced outline)

> **Expand to bite-sized TDD steps against the LIVE code once Plan 1 lands** — these tasks cut the server's protected state machine and the running `pipelineService`/`runObserver`, so writing exact code now would guess at signatures that Plan 1's interfaces and the live files determine. Re-affirm `check-foundation` at the start (the `ask`/`answered` edges + new phase touch I8). Each task is TDD (PGlite server tests), exact paths, complete code, commits — same discipline as Plan 1.

1. **`awaiting_agent` phase enum + `ask`/`answered` edges.** `db/schema.ts` `work_item_phase` pg-enum gains `awaiting_agent` (drizzle-kit migration). `transition.ts` `Edge` union + `EDGES` gain `ask: { from:['active'], to:'awaiting_agent', outcome:'running' }` and `answered: { from:['awaiting_agent'], to:'active', outcome:'running' }`; add `awaiting_agent` to `cancel.from` (a suspended asker must cancel — I10). Test: legal/illegal edge cases via PGlite.

2. **The `questions` table + stateStore methods.** New `questions` table (schema in design §3.4) + migration. `stateStore` methods: `insertQuestion`, `getQuestion`, `getPendingQuestionsForAsker`, `answerQuestion`, `failQuestion`, `getExpiredQuestions`. Test: insert→pending→answer→no-pending transitions; round/retry/deadline columns.

3. **runObserver detects `AGENT_QUESTION` + suspends the asker.** In `consume()`, mirror the `readGateOpened` site: `readAgentQuestion(event)` → `insertQuestion` row(s) → `transition(db, askerId, 'ask')` → `publishStatus(askerId, 'awaiting_agent')` → resolve `target` via the workflow router (Task 5) → dispatch the answerer **shallow** via the injected `deliver`, seeded with the question via `encodeHandoff`, recording `answerer_work_item_id` → audit. Test: an asker run emitting the signal lands `awaiting_agent` with a pending row + a dispatched answerer.

4. **Answer propagation + wake.** When an answerer finishes having emitted its declared answer tool call, capture the answer → `answerQuestion` → if `getPendingQuestionsForAsker(askerId)` empty → `transition(db, askerId, 'answered')` + `observer.resume(askerId, { kind:'answer', answers, allOk })`. Reuse the existing resume mechanism (no second path); decide the exact hook site (`pipelineService` vs a `runObserver` dep callback) against the live `resolveGate`/`autoFinishParent` seams. Test: answerer finishes → asker resumes active → finishes, with the answer in the payload.

5. **`resolveQuestionTarget` workflow binding [app].** Extend `ServerBinding` with an optional `resolveQuestionTarget(target, ctx) => answererAgentId` (parallel to `effects`). The framework invokes it; the binding holds the agent-id knowledge (I5). Harness provides a trivial router (target = agent id, validated against `handoffs`). Test: routing resolves the declared target; an unknown target errors (no silent drop).

6. **Bounds + timeout/escalation.** Config-as-data limits on the workflow/agent: `maxQuestionRounds`, `questionTokenBudget`, `questionTimeoutMs`, `maxQuestionRetries`. Per-chain `round` counter (single source: the question chain) + `DEPTH_CAP` backstop. A reaper over `getExpiredQuestions`: retry up to `maxQuestionRetries`, else escalate by opening a **human gate** on the asker (reuse `insertGate` + `transition('gate')`). Tests: round-budget exhaustion escalates; timeout retries then escalates; cancel of a suspended asker cleans its questions + answerer (I10); no silent drop (I12).

**Plan 2 acceptance:** on the server, an agent run emitting `AGENT_QUESTION` suspends in `awaiting_agent`, the answerer runs, the asker wakes with the answer and finishes; timeout/round-exhaustion escalate to a human gate; everything is audited and cancellable; verified on PGlite.

---

# PLAN 3 — Minimal harness + cross-provider end-to-end (sequenced outline)

> **Expand against live code after Plan 2.** Builds the two-agent toy workflow and proves the full suspend/wake loop on BOTH mock and claude-cli.

1. **The `asker`/`answerer` toy workflow [app/test].** A minimal workflow (scaffolded via the `add-workflow` skill, or a test-only fixture under the server tests) with an `asker` (has an `asks` tool + an `onAnswer` prompt) and an `answerer` (has the declared answer tool). The mock provider script: asker emits `AGENT_QUESTION` (N=1) → suspends; answerer emits its answer → asker resumes and finishes.

2. **Full server e2e on mock (PGlite).** Drive the loop end-to-end: dispatch the asker → assert `awaiting_agent` + pending row → answerer dispatched shallow (assert lineage depth did not grow) → answer → asker `answered`→active→finish, with the answer in the resume payload. Plus the timeout→escalation and cancel-cascade paths.

3. **Cross-provider proof on claude-cli (record/replay cassette).** Run the same toy workflow on the real claude-cli provider once (`DEV_RECORD_REPLAY=record`), capture the cassette, and replay-verify — proving re-prime carries the answer (the contract didn't leak across the second provider, I4).

4. **Browser-verify gate — DEFERRED to Pass 2.** Per the project's refined rule, the Pass-1 core has no user-visible symptom yet (`awaiting_agent` is not surfaced in the UI until Pass 2). It is gated by the server + conformance tests here; the browser-verify pass arrives with the Pass-2 increment that surfaces `awaiting_agent` in the board/thread, where real-browser screen tests assert the visible waiting/answered states.

5. **Skill co-evolution + docs (AGENTIC directive #1).** Update the `add-workflow` skill to teach wiring an ask/answer pair (the `asks`/answer tool classes, the `resolveQuestionTarget` binding, the tunable limits); add a `rules/` entry or skill for the return channel; update `HANDOFF.md`/`docs/BUILD-LOG.md`/`docs/AGENTIC.md` with the as-built narrative.

**Plan 3 acceptance:** the isolated return-channel primitive runs end-to-end on mock + claude-cli; the suspend/wake/timeout/cancel paths are proven server-side; the reusable lessons are captured into the skills/docs; `feature-delivery` (Pass 2) can now be built on top.

---

## Self-review notes

- **Spec coverage:** signal (P1 T1), tool class (P1 T2), phase+edges (P1 T3 + P2 T1), resume union + hook (P1 T4), provider branch + conformance (P1 T5/T6), questions record (P2 T2), detect/suspend (P2 T3), propagate/wake (P2 T4), routing-as-app-policy (P2 T5), bounds/timeout/escalation (P2 T6), harness + cross-provider e2e (P3), single-source-of-truth + fw/app boundary + tunables-as-config (Global Constraints, enforced throughout), foundation notes + check-foundation gates (Global Constraints + P1 T4 + P2 preamble), browser-verify deferral with the genre rule (P3 #4), trajectory + skill capture (P3 #5).
- **Additivity:** the only protected-core contract change in Plan 1 (the resume payload) is made back-compatible via an OPTIONAL `kind?` on `GateResolution`, so `@atizar/server`/`@atizar/providers` stay green before Plan 2 wires the callers. Plan 2 may then set `kind: 'gate'` explicitly at the construction sites.
- **Type consistency:** `AnswerResolution.answers` element `{ target, answer, ok }` is used identically in `providers.ts`, `definePrompt.ts` (`onAnswer`), the providers' `buildResumeFromAnswer`, and the conformance fixture. `target` is `unknown` everywhere (opaque, I5).
- **No silent caps:** P2 T6's budget/timeout exhaustion ESCALATES to a human gate, never drops a suspended asker (I12).
