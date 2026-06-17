# Resume — Three Modes (generalize `onResume`/`buildResume`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An approved gate can resolve **without spawning the model**. Today every approve spawns
claude (`observer.resume()` → `consume(provider.resume(...))`, prompt from `buildResume`), and a
`null` `buildResume` yields an ugly `"Resume failed"` chunk then `done`. Generalize the resume
result into a discriminated union so the workflow's `onResume` chooses one of three modes:
`prompt` (spawn the model — today's behavior), `message` (server appends a verbatim canned line, no
LLM round-trip), or `null` (clean silent settle, no turn, NO "Resume failed").

**Architecture:** The resume mode is decided in `@atizar/core` (`PromptStrategy.buildResume` /
`definePrompt`'s `onResume` return a `ResumeOutcome` union). The SERVER (`runObserver.resume()`) is
the single place that branches on the mode: `prompt` → consume the provider stream as today;
`message` → append ONE `TEXT_MESSAGE_CHUNK` event to the trace (the same `appendTrace`/`bus.publish`
seam `consume` uses) then `settle('finish')` WITHOUT touching the provider; `null` → `settle('finish')`
directly, no event. The claude-cli PROVIDER's `resume()` only ever sees `prompt` mode (message/null
are resolved server-side before the provider is called), so its `"Resume failed"` errorChunk path is
removed (RM4 regression guard). `done` is still reached for all three modes.

**Tech Stack:** TypeScript, Vitest, @ag-ui/client event vocabulary, Postgres (PGlite in tests),
@atizar/core + @atizar/server + @atizar/providers.

This implements **§5 "The resume seam — three modes"** of spec
`docs/superpowers/specs/2026-06-17-agent-view-lifecycle-presentation.md` and acceptance cases
**RM1–RM4** of `docs/superpowers/specs/2026-06-17-agent-view-e2e-cases.md`. No React change is
expected — `foldEventsToMessages` already folds a `TEXT_MESSAGE_CHUNK` into an assistant bubble, so a
`message`-mode line renders like any other tail message.

## Global Constraints

> **READ FIRST — two standing rules for whoever implements this (the reason this whole plan set exists). Hold them on EVERY task:**
> 1. **Always think about the framework/app boundary.** Before placing any non-trivial code, ask: generic *mechanism* every workflow needs (→ `@atizar/*`) or *one workflow's policy* (→ `apps/inbox/...`)? A framework symbol carries ZERO workflow knowledge — no `reply/reader/spam/email/ticket` literals. The three-mode mechanism is framework; the phrase/mode choice stays in the workflow `onResume` (policy). Unsure → default to the app.
> 2. **Never multiply sources of truth.** One derivation per concept. Reuse the existing seam/classifier; a new question is asked OF the one status, never a forked new set.
> 3. **DECISION (locked): option A — add `buildResume` to `AgentRuntime`** so the observer resolves the resume mode there; do NOT introduce a separate `resumeOutcome` dep (option B).

- **I14 — provider/core contract boundary (PROTECTED).** This changes the `@atizar/core`
  `PromptStrategy.buildResume` return type (and `definePrompt`'s `onResume`), which the
  `@atizar/providers` `claude-cli` provider consumes. That is the locked provider/core contract seam.
  Run the **`check-foundation`** skill before the final commit; the resume modes are a *generalization*
  of the existing `string | null` return (additive shapes, no behavior removed for `prompt`), but the
  contract edit requires the explicit foundation check + the developer's confirmation if any tension
  is flagged.
- **Framework/app boundary (I5):** the three-mode MECHANISM (the union, the server branch, the
  provider honoring `prompt` only) is **framework-generic** — `@atizar/core` + `@atizar/server` +
  `@atizar/providers`. WHICH mode and the phrase are **workflow policy** — they live in the agent's
  `onResume` in `apps/inbox/workflows/email-inbox/prompts.ts`. No `reply/reader/spam/email` literal
  enters `@atizar/*`.
- **TDD:** no production code without a failing test first. Watch each test fail, then pass.
- **Server tests use PGlite** (`describe.skipIf(!reachable)` guard, as in `runObserver.test.ts`) —
  skip if the DB is unreachable; do NOT treat a skip as a pass.
- **Green gate before "done":** `yarn typecheck && yarn test && yarn lint && yarn format:check` from
  repo root. (Only run `yarn workspace @atizar/react build` if a `@atizar/react` source file is
  touched — this plan does not expect to touch React.)
- **Tests run from repo root** (`yarn test`).

---

### Task 1: Core — the `ResumeOutcome` union on `PromptStrategy.buildResume`

**Files:**
- Modify: `packages/core/src/providers.ts:36-48` (`PromptStrategy.buildResume` return type + add the `ResumeOutcome` type)
- Modify: `packages/core/src/index.ts` (export `ResumeOutcome`)
- Modify: `packages/core/src/definePrompt.ts:9-41` (`PromptSpec.onResume` return type + `definePrompt`'s `buildResume` wiring)
- Test: `packages/core/src/definePrompt.test.ts:34-40` (update the two existing resume cases; add `message`/`null` cases)

**Interfaces:**
- New exported type (EXACT shape — this is the union name the whole plan references):
  ```ts
  export type ResumeOutcome =
    | { kind: 'prompt'; text: string } // spawn the model with `text` as the resume prompt
    | { kind: 'message'; text: string } // server appends `text` verbatim, NO model spawn
    | null // clean silent settle, no turn
  ```
- `PromptStrategy.buildResume?(args, executedResult?): ResumeOutcome` (was `string | null`).
- `PromptSpec.onResume?(result): ResumeOutcome` (was `string`).
- Consumed by: `claude-cli-provider.ts` (Task 4, reads `.kind === 'prompt'`) and
  `runObserver.resume()` (Task 3, branches all three). Note `definePrompt` is the SUGAR layer; the
  raw `PromptStrategy` escape hatch (providers.ts docstring) now returns the union too.

- [ ] **Step 1: Write the failing core tests**

In `packages/core/src/definePrompt.test.ts`, REPLACE the existing `buildResume passes the server
effect result` case and add the two new modes. The existing test asserts a bare string
(`toBe('saved d1')`) — that signature is gone, so it must change to the union:

```ts
it('buildResume wraps onResume into a prompt-mode ResumeOutcome', () => {
  const p = definePrompt({
    onStart: () => 's',
    onResume: ({ draftId }) => ({ kind: 'prompt', text: `saved ${draftId}` }),
  })
  expect(p.buildResume?.({}, { draftId: 'd1' })).toEqual({ kind: 'prompt', text: 'saved d1' })
})

it('onResume may return message mode (server-appended, no model spawn)', () => {
  const p = definePrompt({ onStart: () => 's', onResume: () => ({ kind: 'message', text: 'Draft saved' }) })
  expect(p.buildResume?.({}, {})).toEqual({ kind: 'message', text: 'Draft saved' })
})

it('onResume may return null (silent settle)', () => {
  const p = definePrompt({ onStart: () => 's', onResume: () => null })
  expect(p.buildResume?.({}, {})).toBeNull()
})

it('no onResume → buildResume is undefined', () => {
  const p = definePrompt({ onStart: () => 's' })
  expect(p.buildResume).toBeUndefined()
})
```

(Keep the existing `buildFirst` cases untouched. Match the file's current import of `definePrompt`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn test packages/core/src/definePrompt.test.ts`
Expected: FAIL — `onResume` currently is typed `=> string`, so `() => ({ kind: 'message', ... })`
won't typecheck and the prompt-mode assertion `toEqual({...})` won't match the bare-string return.

- [ ] **Step 3: Add `ResumeOutcome` + retype `buildResume` in `providers.ts`**

In `packages/core/src/providers.ts`, add the union above `PromptStrategy` (with a docstring noting
the three modes + I14 contract), and change `buildResume`'s return from `string | null` to
`ResumeOutcome`:

```ts
// The resume result of a gated agent — a discriminated union (I14 provider/core contract). The
// SERVER decides what to do from `kind`; the provider only ever runs `prompt`. `message` lets an
// approval resolve with a canned confirmation (no LLM round-trip); `null` is a clean silent finish.
export type ResumeOutcome =
  | { kind: 'prompt'; text: string }
  | { kind: 'message'; text: string }
  | null

export interface PromptStrategy {
  buildFirst(input: RunAgentInput): string
  // Returns a ResumeOutcome: prompt → spawn the model; message → server appends text; null → silent.
  buildResume?(args: Record<string, unknown>, executedResult?: Record<string, unknown>): ResumeOutcome
}
```

- [ ] **Step 4: Export `ResumeOutcome` from core**

In `packages/core/src/index.ts`, ensure `ResumeOutcome` is exported. `providers.ts` is already
re-exported via `export * from './providers.js'` (verify with `grep -n "providers" packages/core/src/index.ts`);
if it uses an explicit type re-export list, add `ResumeOutcome` to it. Otherwise the wildcard covers it.

- [ ] **Step 5: Update `definePrompt` to return the union**

In `packages/core/src/definePrompt.ts`:
- Import the type: `import type { PromptStrategy, ResumeOutcome } from './providers.js'`.
- Change `PromptSpec.onResume`'s signature to `onResume?: (result: Record<string, unknown>) => ResumeOutcome`.
- Change the `buildResume` wiring to forward the union directly (no `?? null` string coercion):

```ts
buildResume: onResume
  ? (_args: Record<string, unknown>, executedResult?: Record<string, unknown>): ResumeOutcome =>
      onResume(executedResult ?? {})
  : undefined,
```

Update the docstring on `onResume` to say it returns a `ResumeOutcome` (prompt/message/null), not a
prompt string.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `yarn test packages/core/src/definePrompt.test.ts`
Expected: PASS (all four cases).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/providers.ts packages/core/src/definePrompt.ts packages/core/src/index.ts packages/core/src/definePrompt.test.ts
git commit -m "feat(core): buildResume/onResume return a ResumeOutcome union (prompt|message|null)"
```

---

### Task 2: Provider — `claude-cli` resume honors `prompt` only; drop the "Resume failed" path

**Files:**
- Modify: `packages/providers/src/claude-cli-provider.ts:88-132` (`resumePromptFrom` + the `run()` legacy-resume branch + `resume()`)

**Interfaces:**
- Consumes: `ResumeOutcome` from `@atizar/core` (Task 1). After Task 3, the server only calls
  `provider.resume()` when the mode is `prompt`, so the provider extracts `.text` from a
  `prompt`-kind outcome and streams it; any non-`prompt` outcome reaching the provider is a no-op
  (yield nothing → clean `done`), NOT an errorChunk.
- Produces: no `errorChunk('Resume failed: …')` anywhere (RM4). The `rejected`-decision `textChunk`
  stays.

- [ ] **Step 1: Write/adjust the provider test**

Find the existing provider resume coverage:
`grep -rln "resume\|Resume failed\|buildResume" packages/providers/src/*.test.ts`. In the file that
covers `createClaudeCliProvider` resume (add one if none exists — a minimal local test with a fake
`spawn`), add:

```ts
it('streams the prompt text when buildResume returns prompt mode', async () => {
  const spawned: string[] = []
  const provider = createClaudeCliProvider({
    approvalNames: ['saveDraft'],
    surfaceTools: [],
    allowedTools: [],
    prompts: {
      buildFirst: () => 'first',
      buildResume: () => ({ kind: 'prompt', text: 'human approved, confirm' }),
    },
    spawn: (prompt) => {
      spawned.push(prompt)
      return { lines: (async function* () {})(), kill: () => {} }
    },
  })
  const handle = { runId: 'r1', input: { messages: [] } as any }
  for await (const _ of provider.resume!(handle, { gateId: 'g', decision: 'approved' })) void _
  expect(spawned.some((p) => p.includes('human approved, confirm'))).toBe(true)
})

it('never emits a "Resume failed" chunk when buildResume returns null', async () => {
  const provider = createClaudeCliProvider({
    approvalNames: ['saveDraft'],
    surfaceTools: [],
    allowedTools: [],
    prompts: { buildFirst: () => 'first', buildResume: () => null },
    spawn: () => ({ lines: (async function* () {})(), kill: () => {} }),
  })
  const handle = { runId: 'r1', input: { messages: [] } as any }
  const out: any[] = []
  for await (const e of provider.resume!(handle, { gateId: 'g', decision: 'approved' })) out.push(e)
  expect(out.some((e) => String(e.delta ?? '').includes('Resume failed'))).toBe(false)
})
```

(Match the file's existing import of `createClaudeCliProvider`. The fake `spawn` returns an empty
line stream so `mapClaudeStream` yields nothing — the point is asserting the PROMPT text passed to
spawn, and the absence of the error chunk.)

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test packages/providers`
Expected: FAIL — the null case currently yields `errorChunk('Resume failed: …')`; the prompt-mode
case currently can't compile against the new union (or passes a string), and once Task 1 lands
`buildResume` returns an object, so `withIdentity(... ?? null)` (string-typed) breaks.

- [ ] **Step 3: Rework `resumePromptFrom` to return the prompt text from a `prompt` outcome**

In `packages/providers/src/claude-cli-provider.ts`, change `resumePromptFrom` so it reads the union
and returns a `string | null` (the spawn prompt) — extracting `.text` only when `kind === 'prompt'`,
otherwise `null` (no spawn). Keep the `?? lastApprovalArgs` precedence on `args`:

```ts
// Returns the resume PROMPT (string) to spawn, or null when there is no prompt-mode resume to run.
// message/null modes are resolved by the SERVER before resume() is called, so they never reach here.
function resumePromptFrom(handle: ResumeHandle, resolution: GateResolution): string | null {
  const messages = (handle.input?.messages ?? []) as Message[]
  const args = resolution.form ?? lastApprovalArgs(messages, approvalNames) ?? {}
  const outcome = prompts.buildResume?.(args, resolution.executedResult) ?? null
  if (outcome && outcome.kind === 'prompt') return withIdentity(outcome.text)
  return null // message/null mode: nothing for the provider to spawn
}
```

- [ ] **Step 4: Drop the "Resume failed" errorChunk in `resume()` and the legacy `run()` branch**

In `resume()` (lines ~121-132): if `resumePromptFrom` returns null, simply `return` (clean end → no
events → server settles `finish`), NOT an errorChunk:

```ts
async *resume(handle: ResumeHandle, resolution: GateResolution): AsyncIterable<BaseEvent> {
  if (resolution.decision === 'rejected') {
    yield textChunk('The human rejected the proposed action; no changes were made.')
    return
  }
  const resumePrompt = resumePromptFrom(handle, resolution)
  if (!resumePrompt) return // message/null handled server-side; nothing to spawn here
  yield* primeAndStream(resumePrompt, [])
},
```

In the legacy `run()` resume branch (lines ~104-117): `buildResume` now returns the union, so update
the extraction and remove the errorChunk:

```ts
const outcome = prompts.buildResume?.(args) ?? null
const resumePrompt = outcome && outcome.kind === 'prompt' ? withIdentity(outcome.text) : null
if (!resumePrompt) return // message/null/none: clean end, no "Resume failed"
yield* primeAndStream(resumePrompt, [])
return
```

(Leave the `errorChunk` HELPER in place — it is still used by `primeAndStream`'s spawn/stream
catch blocks at lines ~77/83. Only the two "Resume failed" CALL sites are removed. Update the stale
docstrings on `resumePromptFrom` lines ~89-94 that mention "surfacing Resume failed".)

- [ ] **Step 5: Run to verify it passes**

Run: `yarn test packages/providers`
Expected: PASS — prompt text reaches spawn; no "Resume failed" chunk for null.

- [ ] **Step 6: Commit**

```bash
git add packages/providers/src/claude-cli-provider.ts packages/providers/src/*.test.ts
git commit -m "feat(providers): claude-cli resume honors prompt-mode ResumeOutcome; drop Resume-failed chunk"
```

---

### Task 3: Server — `runObserver.resume()` branches on the resume mode

**Files:**
- Modify: `packages/server/src/runObserver.ts:295-320` (the `resume(id, resolution)` method)
- Modify: `packages/server/src/runObserver.ts:37-66` (`RunObserverDeps` — add a `resolvePrompts`/strategy accessor IF the strategy isn't already reachable; see Interfaces — verify first)
- Test: `packages/server/src/runObserver.test.ts` (add `message`/`null` resume cases alongside the existing prompt case)

**Interfaces:**
- The server must read the agent's `ResumeOutcome` to branch BEFORE deciding whether to call
  `provider.resume()`. **VERIFY how the strategy is reachable from the observer first:** the observer
  currently calls `runtime.provider.resume(handle, resolution)` and does NOT hold the `PromptStrategy`.
  Two options — pick by what the wiring exposes:
  - **(A) Preferred:** add `buildResume?` to `AgentRuntime` (the runtime already carries
    `renderToolNames`/`effects`/`handoffs`; the wiring in `buildAgent`/server has the
    `PromptStrategy`). Then `runtime.buildResume?.(args, resolution.executedResult)` gives the
    `ResumeOutcome` directly, and the observer branches on it.
  - **(B) Fallback** (if threading the strategy is heavy): add a new dep
    `resumeOutcome: (agentId, resolution) => ResumeOutcome | undefined` to `RunObserverDeps`, wired
    in the server where the strategy is in scope.
  Grep `buildAgent`/`makeRunObserver` wiring in `packages/server/src/` to choose; document the choice
  in the commit. The `args` passed to `buildResume` = `resolution.form ?? {}` (the server has the
  resolution; it does not need the transcript fallback the provider uses).
- Consumes: `ResumeOutcome` from `@atizar/core`; the `appendTrace`/`bus.publish`/`seq` seam already
  used by `consume()` (runObserver.ts:117-132) and by Task-equivalent handoff append.
- Produces: for `message` mode, ONE `TEXT_MESSAGE_CHUNK` event appended to the trace at the next
  `seq` then `settle(id, 'finish', actor)`; for `null`, `settle(id, 'finish', actor)` with no event;
  for `prompt`, the unchanged `consume(provider.resume(...))` path.

- [ ] **Step 1: Write the failing server tests (one per mode, PGlite)**

In `packages/server/src/runObserver.test.ts`, extend the fake provider + add tests. First make the
fake provider's resume mode configurable, and make `resolveAgent` carry a `buildResume`. Add three
`describe.skipIf(!reachable)` cases mirroring the existing harness (insert WorkItem → `transition
start` → `observer.run` to the gate → `observer.resume`). Skeleton:

```ts
function fakeProviderWithResumeSpy(spy: { resumed: boolean }): Provider {
  return {
    async *run(_input: RunAgentInput) {
      yield gateOpened({ gateKind: 'approval', toolName: 'saveDraft', toolCallId: 'toolu_g', proposedArtifact: { body: 'hi' } })
    },
    async *resume() {
      spy.resumed = true
      yield ev({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm3', delta: 'spawned' })
    },
  }
}

it('message mode: appends verbatim text + finishes, WITHOUT spawning the provider', async () => {
  const spy = { resumed: false }
  // resolveAgent returns { provider: fakeProviderWithResumeSpy(spy), buildResume: () => ({ kind:'message', text:'Draft saved ✓' }), ... }
  // run to the gate, then resume with { decision:'approved' }.
  // Assert:
  expect(spy.resumed).toBe(false) // provider.resume NOT called
  const wi = await store.getWorkItem(id)
  expect(wi?.phase).toBe('terminal') // reaches done
  const trace = await store.getTrace(id, 0)
  const last = trace[trace.length - 1].event as any
  expect(last.type).toBe('TEXT_MESSAGE_CHUNK')
  expect(last.delta).toBe('Draft saved ✓')
})

it('null mode: silent finish, no extra trace event, no provider spawn, no error chunk', async () => {
  const spy = { resumed: false }
  // resolveAgent returns { ..., buildResume: () => null }
  const before = (await store.getTrace(id, 0)).length // after gate, before resume
  // resume...
  expect(spy.resumed).toBe(false)
  expect((await store.getWorkItem(id))?.phase).toBe('terminal')
  const after = await store.getTrace(id, 0)
  expect(after.length).toBe(before) // NO new event appended
  expect(after.some((r) => String((r.event as any).delta ?? '').includes('Resume failed'))).toBe(false)
})

it('prompt mode: spawns the provider as today (regression)', async () => {
  const spy = { resumed: false }
  // resolveAgent returns { ..., buildResume: () => ({ kind:'prompt', text:'confirm' }) }
  // resume...
  expect(spy.resumed).toBe(true)
  expect((await store.getWorkItem(id))?.phase).toBe('terminal')
})
```

(Adapt `resolveAgent` to whichever Interfaces option you chose — A: `buildResume` on the runtime
object; B: a `resumeOutcome` dep. Reuse the file's `store`, `fakePool`, `transition`, `ev` helpers.
The existing "runs to a gate … then resumes to finished" test stays as the prompt-mode default and
must remain green.)

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test packages/server/src/runObserver.test.ts`
Expected: FAIL — `message`/`null` modes are not handled; the observer always calls
`provider.resume`, so `spy.resumed` is `true` and the message-mode trace has no appended line.
(Or SKIPPED if PGlite unreachable — then state that and do not claim pass.)

- [ ] **Step 3: Branch on the mode in `resume()`**

In `packages/server/src/runObserver.ts`, after the gate-resolution + `transition('resume')` +
`publishStatus('active')` + `reconcile` (keep those — they fire for every approved resume), compute
the `ResumeOutcome` and branch instead of unconditionally consuming `provider.resume`:

```ts
const args = resolution.form ?? {}
const outcome = runtime.buildResume?.(args, resolution.executedResult) ?? null // option A
// (option B: deps.resumeOutcome(wi.agentId, resolution) ?? null)

if (!outcome) {
  // null mode → clean silent finish, no turn, no event.
  await deps.settle(id, 'finish', resolution.resolvedBy ?? null)
  return
}
if (outcome.kind === 'message') {
  // Server appends the verbatim canned line — NO provider spawn.
  const seq = await store.countTrace(id)
  const event = {
    type: EventType.TEXT_MESSAGE_CHUNK,
    role: 'assistant',
    messageId: randomUUID(),
    delta: outcome.text,
  } as unknown as BaseEvent
  await store.appendTrace(id, seq, event)
  bus.publish(`workitem:${id}`, { seq, event })
  await deps.settle(id, 'finish', resolution.resolvedBy ?? null)
  return
}
// prompt mode → today's path.
const input = buildInput(wi)
const handle = { runId: wi.runId ?? input.runId, input }
await consume(id, wi, runtime, runtime.provider.resume!(handle, resolution))
```

Notes:
- `settle(... 'finish')` is the same terminal writer `consume` calls at line ~237 → it does the
  trace lifecycle note + audit + pool reconcile, so all three modes reach `done` identically.
- `store.countTrace(id)` gives the next `seq` (rows are contiguous 0..n-1; verified
  stateStore.ts:90-96). `consume` uses `getTrace(...).length` for the same purpose — either works;
  `countTrace` is cheaper.
- `actor`: pass `resolution.resolvedBy ?? null` if the field exists; otherwise `null` (matches the
  observer's existing `settle('finish', null)` at line 237 — VERIFY the `GateResolution` field and
  keep it consistent with the prompt-mode path, which also settles via `consume`).
- The `EventType.TEXT_MESSAGE_CHUNK` + `randomUUID` shape mirrors the provider's `textChunk`
  (claude-cli-provider.ts:34-41) so `foldEventsToMessages` renders it as a normal assistant bubble.
- If you chose option A, add `buildResume?: PromptStrategy['buildResume']` to `AgentRuntime`
  (`runObserver.ts:24-35`) and wire it where the runtime is constructed (grep the `resolveAgent`
  factory / `buildAgent` site).

- [ ] **Step 4: Run to verify it passes**

Run: `yarn test packages/server/src/runObserver.test.ts`
Expected: PASS (all three modes + the existing gate→finish regression). Or SKIPPED if PGlite
unreachable — note it explicitly.

- [ ] **Step 5: Run the full server suite (no regression)**

Run: `yarn test packages/server`
Expected: all PASS/skip; in particular `runObserver.dispatch.test.ts`, `settle.test.ts`,
`pipelineService.test.ts` stay green.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/runObserver.ts packages/server/src/runObserver.test.ts
git commit -m "feat(server): runObserver.resume branches on ResumeOutcome — message appends, null settles silent"
```

---

### Task 4: Workflow — email-inbox `onResume` returns `{kind:'prompt', text}` (preserve behavior)

**Files:**
- Modify: `apps/inbox/workflows/email-inbox/prompts.ts:61-69` (`replyOnResume`), `:112-121` (`batchOnResume`)

**Interfaces:**
- Consumes: the `ResumeOutcome` union (Task 1). `replyOnResume`/`batchOnResume` currently return a
  `string`; wrap that exact string in `{ kind: 'prompt', text: <the string> }` so the live email
  workflow keeps spawning the model on approval (today's RM1 behavior). The MECHANISM is framework;
  this phrase + the `prompt` choice are workflow POLICY (I5).
- Produces: no behavior change for the email demo — approve still streams a one-sentence confirmation
  from the model.

- [ ] **Step 1: Wrap `replyOnResume`'s return**

Change `replyOnResume` to build its current string into `text` and return
`{ kind: 'prompt', text }`. Its type becomes `(result) => ResumeOutcome` (import the type from
`@atizar/core` if a return annotation is added; or rely on `definePrompt`'s `onResume` typing —
verify it compiles).

- [ ] **Step 2: Wrap `batchOnResume`'s return**

Same for `batchOnResume`: wrap its current `[...].join('\n')` string in `{ kind: 'prompt', text }`.

- [ ] **Step 3: Typecheck the app**

Run: `yarn typecheck`
Expected: PASS — `definePrompt({ onResume })` now accepts the union; the email prompts return
`prompt` mode.

- [ ] **Step 4: Commit**

```bash
git add apps/inbox/workflows/email-inbox/prompts.ts
git commit -m "feat(email-inbox): onResume returns prompt-mode ResumeOutcome (behavior preserved)"
```

---

### Task 5: Green gate, foundation check, browser-verify (RM1–RM4)

**Files:** none (verification only).

- [ ] **Step 1: Full green gate from repo root**

Run: `yarn typecheck && yarn test && yarn lint && yarn format:check`
Expected: all PASS (server resume tests run under PGlite; skips noted, not counted as pass). Fix any
fallout before proceeding. (No `yarn workspace @atizar/react build` — no React source touched; if a
React file WAS touched, run it.)

- [ ] **Step 2: Run check-foundation (I14)**

Invoke the `check-foundation` skill against this diff. It touches the `@atizar/core`
`PromptStrategy.buildResume` / `definePrompt.onResume` contract consumed by the `@atizar/providers`
claude-cli provider — the locked provider/core seam (I14). Expected verdict: Clear — the change is an
**additive generalization** of `string | null` into a discriminated union; `prompt` mode preserves
today's exact behavior, `message`/`null` are new server-resolved modes, no provider/AG-UI wire
contract changes, no workflow literal enters `@atizar/*` (I5). If check-foundation flags tension,
STOP and get the developer's explicit confirmation before landing.

- [ ] **Step 3: Browser-verify the three resume modes (RM1–RM4)**

Invoke the `browser-verify` skill. Start `yarn dev` (use `DEV_RECORD_REPLAY=record` once if a fresh
cassette is needed; concurrent-HITL replay caveats do not apply to single-instance resume). Verify:
- **RM1** (reply agent, `prompt` mode, today's email default): run a sorter scan → open the reply
  draft → Approve → the model streams a one-sentence confirmation, then `done`. (This is the live
  email path; it MUST still work.)
- **RM2** (`message` mode): temporarily point one agent's `onResume` at `{kind:'message', text:'Draft
  saved ✓'}` (or use a test workflow) → Approve → the verbatim "Draft saved ✓" line appears in the
  thread with NO model latency, then `done`. Confirm via the Network tab / server logs that no
  claude run started for the resume.
- **RM3** (`null` mode): point an `onResume` at `null` → Approve → the run goes `done` **silently** —
  no confirmation bubble, and **no "Resume failed"** text anywhere.
- **RM4** (regression guard): confirm the old `null → "Resume failed"` chunk is gone (it is, after
  RM3). Revert any temporary `onResume` edits used for RM2/RM3.

- [ ] **Step 4: Final commit (if verification produced fixes)**

```bash
git add -p
git commit -m "test: verify resume three modes (green gate + browser RM1-RM4)"
```

---

## Self-Review

- **Spec coverage (§5 three modes + RM1–RM4):** the `ResumeOutcome` union in `@atizar/core`
  (Task 1); the claude-cli provider honoring `prompt` only and dropping "Resume failed" (Task 2,
  RM4); the server branch — `prompt` consumes the stream, `message` appends a verbatim event +
  settles, `null` settles silently — all reaching `done` (Task 3, RM1/RM2/RM3); the email workflow
  preserving today's `prompt` behavior (Task 4, RM1 live); foundation + browser cross-check (Task 5).
- **Chosen union (EXACT):** `ResumeOutcome = { kind: 'prompt'; text: string } | { kind: 'message';
  text: string } | null`, exported from `@atizar/core`; it is `PromptStrategy.buildResume`'s and
  `PromptSpec.onResume`'s return type. This is the symbol Tasks 2/3/4 all import — single source.
- **I14 / I5 boundaries called out:** the contract edit is the protected provider/core seam (Task 5
  runs check-foundation); the WHICH-mode + phrase decision is workflow policy in `prompts.ts`
  (Task 4) — no email literal in `@atizar/*`.
- **One verify-first point (not a placeholder):** Task 3's "how the strategy reaches the observer"
  (option A `buildResume` on `AgentRuntime` vs option B a `resumeOutcome` dep) is a wiring choice to
  resolve by grepping the `buildAgent`/`resolveAgent` site — the assertions and the branch logic are
  concrete regardless of which accessor is used. Likewise the `actor`/`resolvedBy` field is
  verify-and-match against the existing `settle('finish', …)` call at runObserver.ts:237.
- **`done` reached for all three:** every branch ends in `deps.settle(id, 'finish', …)` (message/null
  directly; prompt via `consume`'s settle at :237) — the message/null tests assert `phase ===
  'terminal'`.
- **No React change expected:** a `message`-mode `TEXT_MESSAGE_CHUNK` folds into a normal assistant
  bubble via the existing `foldEventsToMessages`; the react lib build is only run if a React source
  file ends up touched.
