# Mastra provider (beta build step 5) — design

**Date:** 2026-06-10 · **Branch:** `feat/provider-contract-v2` · **Status:** approved (forks 1–4 + 3 cautions, HANDOFF 2026-06-10)

## Goal

Add a **production** provider — Mastra — beside the dev-only `claude-cli`, behind the
unchanged `Provider` contract (`@atizar/core` `providers.ts`). Mastra resumes a gate
**natively** (`run.resume({ step, resumeData })`, no kill-and-re-prime), which is exactly the
property that makes it the "second unlike provider". **Definition of done = the step-1
conformance suite (`providerConformanceChecks`) passes against the Mastra provider**, plus a live
browser E2E (approve **and** reject **and** cancel) on the real lead-inbox flow with a real Gmail
draft created by the existing server-executed effect.

No change to the `Provider` interface, the RunObserver, the pipeline, or the spike surface — the
Mastra provider is one more `ProviderFactory` in `apps/inbox/server/providers.ts`, selected by an
env switch (`PROVIDER=mastra`); `claude-cli` stays the local default.

## Non-goals

- No new gate kinds, no effect changes — `saveDraft` stays the one approval/effect; the server
  still executes `createDraft` (step 4). Mastra only proposes.
- No mirroring of Mastra's step/snapshot state into our StateStore (belief #2). StateStore keeps
  only the `workItemId ↔ runId` it already keeps (`work_items.run_id`).
- No MCP for Mastra — read tools are wired as **native Mastra tools** (`gmail-basic` read fns).
  The stdio MCP child stays the claude-cli path only.
- Not touching the `@copilotkit/*` client layer (that is step 6).

## Architecture — the injected `MastraRunner` seam (fork 1)

`@atizar/providers` is imported **only by the server** today, but it must stay isomorphic and
fake-testable (the claude-cli pattern: `spawn` is injected, conformance runs on a fake). So
**Mastra is injected**, not imported by the package.

```
@atizar/providers/src/mastra-provider.ts   ← PURE: maps Mastra chunks → AG-UI BaseEvent,
                                                 synthesizes GATE_OPENED from a suspend, drives
                                                 the injected MastraRunner. NO @mastra/* import.
apps/inbox/server/mastra/                     ← NODE: builds the real Mastra Agent + workflow
                                                 (@mastra/core + @ai-sdk/anthropic + API key +
                                                 native read tools + Postgres storage), adapts it
                                                 to the MastraRunner interface.
```

### `MastraRunner` interface (the injected seam)

Lives in `@atizar/providers` (the package owns the contract; the server implements it). Shaped
so a **fake** can model suspend/resume deterministically with no API key.

```ts
export interface MastraRunner {
  // Start a fresh run with a CALLER-SUPPLIED runId (so AG-UI runId === Mastra runId — see
  // "runId" below). inputData carries the source/handoff payload the workflow needs.
  start(runId: string, inputData: Record<string, unknown>): MastraRun
  // Resume the suspended run identified by runId with the human's decision.
  resume(runId: string, resumeData: Record<string, unknown>): MastraRun
}

export interface MastraRun {
  // The workflow run's event stream (agent text-deltas, tool-calls/results bubbled up from the
  // agent step). Mastra's own chunk vocabulary; the provider maps it to AG-UI.
  stream: AsyncIterable<MastraChunk>
  // Resolves when the run settles: 'suspended' (carries the gate suspend payload) or 'completed'
  // (normal finish, e.g. the qualifier or a no-saveDraft reply run) or 'failed'.
  result: Promise<MastraRunResult>
  // CAUTION (a): abort the in-flight run. The provider's run()/resume() generators call this in
  // their `finally`, so the RunObserver's existing cancel (iterator.return()) reaches Mastra.
  abort(): void
}

export type MastraRunResult =
  | { status: 'suspended'; suspend: { toolName: string; toolCallId: string; proposedArtifact: Record<string, unknown> } }
  | { status: 'completed' }
  | { status: 'failed'; error: string }
```

`MastraChunk` = a thin structural type for the subset of Mastra `fullStream` chunks we map
(`text-delta`, `tool-call`, `tool-call-args`/`tool-input-delta`, `tool-result`, `finish`/`error`).
We do **not** depend on `@mastra/core`'s chunk types — we declare the structural shape we read
(same discipline as `claude-stream` reading NDJSON), so the package has zero Mastra dependency.

### Why the `result` promise instead of reading suspend from the stream

Mastra's exact suspend chunk shape varies by version; betting the conformance invariant on a
chunk name is fragile. Instead the provider **interleaves**: yield mapped AG-UI events from
`stream` as they arrive, and when the stream ends `await result`. On `suspended`, synthesize
`GATE_OPENED` from `result.suspend`. The fake models this directly; the real adapter derives
`result` from `run.start()`'s returned status + `run.watch`/`createRunAsync` (impl detail of the
server adapter, nailed during TDD against the live API).

## The Mastra workflow (fork 2) — propose tool, terminal gesture

One generic 2-step workflow serves **both** agents (qualifier has no approval, so it never
suspends — same shape, caution (b) handles it):

1. **agentStep** — runs the Mastra `Agent` (instructions from the descriptor). The agent's tools:
   - **read tools** (qualifier: `get_latest_email`) = native Mastra tools wired to
     `@atizar/integrations/gmail-basic` read fns (no MCP).
   - **render tools** (`renderVerdict`, `renderLead`) = no-op capture tools (`execute` returns its
     args) so they appear as tool-calls → the RunObserver fills the card from `TOOL_CALL_END`.
   - **propose tool** (`saveDraft`, the approval name) = a no-op capture tool; its args are the
     proposed artifact. agentStep extracts the **last** `saveDraft` tool-call (CAUTION (b):
     last-call-wins) → `{ toolCallId, args }`. Zero `saveDraft` calls → `{ draft: null }`.
2. **gateStep** — `execute({ inputData, resumeData, suspend, bail })`:
   - **No draft** (qualifier, or a reply run that never proposed): return a completed output. The
     run finishes normally — CAUTION (b): never hang on the no-saveDraft path.
   - **First execution, draft present, no resumeData**: `return await suspend({ toolName: 'saveDraft', toolCallId, proposedArtifact: draft })`.
     Run status → `suspended`; provider emits `GATE_OPENED`.
   - **resume approved** (`resumeData.decision === 'approved'`): the SERVER already executed the
     effect (step 4) and passes `resumeData.executedResult`. Emit ONE short confirming sentence
     ("The Gmail draft was saved.") and complete — propose-don't-execute, the model performs no
     tool call. (fork 3)
   - **resume rejected**: `bail(...)` + one short sentence, **no tool call** (conformance:
     `resume(rejected)` must emit no `TOOL_CALL_START`). (fork 3)

The approval tool name is a **parameter** (`config.approvalNames`), never hardcoded — the
provider tells the runner which tool opens a gate. For the qualifier `approvalNames === []`, so
gateStep's "no draft" branch is the only reachable one.

`PromptStrategy` is **legitimately ignored** by the Mastra provider (the `providers.ts` comment
already anticipates this): instructions live in the Mastra Agent config, built server-side from
the descriptor's `instructions`. `buildFirst`/`buildResume` are a claude-cli concern.

## Data flow

### Turn 1 (`provider.run(input)`)

1. RunObserver: `transition(start)`, `setRunId(id, input.runId)`, then `provider.run(input)`.
2. Provider: derive `inputData` from `input` (decode the handoff payload from `input.messages`
   via the existing `decodeHandoff` / source payload — same data the claude-cli prompts read).
   `runner.start(input.runId, inputData)`.
3. Provider: `for await (chunk of run.stream)` → map → yield AG-UI events
   (`TEXT_MESSAGE_CHUNK`, `TOOL_CALL_START/ARGS/END`, surfaced-tool filtering by
   `config.surfaceTools` exactly like `claude-stream`).
4. Stream ends → `await run.result`. `suspended` → `yield gateOpened({ gateKind:'approval',
   toolName, toolCallId, proposedArtifact })` and return. `completed` → return (RunObserver does
   `transition(finish)`). `failed` → yield an error chunk.
5. `finally { run.abort() }` — so cancel (iterator.return) reaches Mastra (caution a).

The RunObserver is unchanged: it already reads `GATE_OPENED` → insert Gate + `transition(gate)`,
and fills the card from render-tool `TOOL_CALL_END`.

### runId (the load-bearing detail)

RunObserver mints `input.runId` and persists it via `setRunId` **before** the stream. The Mastra
provider therefore creates the Mastra run **with that same runId** (`runner.start(input.runId,
…)`), so AG-UI runId === Mastra runId. On resume, RunObserver builds `handle = { runId: wi.runId
… }` and the provider calls `runner.resume(handle.runId, …)` — the native resume targets the
exact suspended Mastra run. (Requires Mastra `createRun({ runId })`; the server adapter supplies
it — verified during TDD; if a Mastra version refuses an external runId, the adapter keeps a
`callerRunId → mastraRunId` map and the provider is unaffected.)

### Resume (`provider.resume(handle, resolution)`)

`resolution = { decision, form, executedResult, comment }`. Provider:
`runner.resume(handle.runId, { decision, executedResult })` → map `run.stream` → on `result`
completed, return. No `GATE_OPENED` is re-emitted (conformance). Rejected → the bail branch
emits a closing sentence and no tool call.

## The three cautions (built in)

- **(a) abort()** — `MastraRunner.abort()` is part of the interface; the provider's `run`/`resume`
  generators wrap the stream loop in `try { … } finally { run.abort() }`. The RunObserver's
  `cancel(id)` already does `iterator.return()`, which runs that `finally`. **Browser E2E adds a
  cancel-mid-run case under `PROVIDER=mastra`** so the Stop button is proven on the production
  provider (not just claude-cli).
- **(b) saveDraft terminal + no-saveDraft** — agentStep takes the LAST `saveDraft` call
  (last-wins) and tolerates zero. gateStep's no-draft branch returns a completed output (never
  suspends, never hangs). Unit tests: two saveDraft calls → gate on the second's artifact; zero
  saveDraft calls → `completed`, RunObserver `finish`.
- **(c) Mastra storage tables isolated** — Mastra persists its run snapshots in **our Postgres**
  but in **its own tables** (Mastra's storage adapter init/migrations), kept OUT of our
  drizzle-kit migration set. `apps/inbox/server/pipeline/db/reset.ts` (test DB) initializes
  **both** storages (our drizzle migrate + Mastra storage init) so `aiworkflow_test` works.
  Mastra storage on Postgres preserves the step-4 restart-durability guarantee (a suspended run
  survives a server restart; our Gate row already does).

## Components & files

- **NEW `packages/providers/src/mastra-provider.ts`** — `createMastraProvider(opts: { approvalNames,
  surfaceTools, prompts?, runner: MastraRunner }): Provider`. Pure; the chunk→AG-UI mapper lives
  here (or a sibling `mastra-stream.ts` mirroring `claude-stream.ts` if it grows). Exports the
  `MastraRunner`/`MastraRun`/`MastraChunk` types. Added to `packages/providers/src/index.ts`.
- **NEW `packages/providers/src/mastra-provider.test.ts`** — conformance (`providerConformanceChecks`
  over a fake runner) + unit tests for the mapper, suspend→GATE_OPENED, last-wins/no-draft, abort.
- **NEW `apps/inbox/server/mastra/`** — `runner.ts` (builds the Agent + 2-step workflow + Postgres
  storage, adapts to `MastraRunner`), `tools.ts` (native read tools from `gmail-basic`; no-op
  capture tools for render/propose). Needs `@mastra/core`, `@ai-sdk/anthropic` (new server deps).
- **EDIT `apps/inbox/server/providers.ts`** — add a `mastra` factory; when `PROVIDER=mastra`,
  resolve `claude-cli` agents to it (env alias — descriptors keep `provider: 'claude-cli'`; no
  descriptor churn). Reads `ANTHROPIC_API_KEY` (fail-fast if missing under `PROVIDER=mastra`).
- **EDIT record/replay** — re-key the cassette step from `resolvedApprovalCount(input)` (message
  scan) to the **store's resolved-gate count**; wipe `.cassettes/` once (gitignored). (DoD item.)

## Testing & DoD

1. `providerConformanceChecks` green against `createMastraProvider({ …, runner: fakeRunner })` —
   the same four invariants the mock + claude-cli pass. **This is the two-unlike-providers proof.**
2. Unit: mapper (text/tool chunks → AG-UI, surface filtering, one messageId per contiguous text);
   suspend → exactly one `GATE_OPENED` with matching `toolCallId`; last-wins; no-draft → completed;
   `abort()` called on iterator.return.
3. `yarn typecheck` / `yarn test` / `yarn lint` / `yarn format:check` green.
4. **Live browser E2E** (`PROVIDER=mastra DEV_RECORD_REPLAY=record yarn dev`, `?spike=1`): qualify
   → propose → gate → **approve → real Gmail draft (server effect) → native resume → finished**;
   **reject → finished/rejected, zero ledger rows**; **cancel mid-run → finished/cancelled, stream
   killed** (caution a). Then `DEV_RECORD_REPLAY=1` replays it.
5. Default provider stays `claude-cli` with `PROVIDER` unset (regression: the existing claude-cli
   E2E still passes).

## Open implementation details (resolved during TDD, not blocking)

- Exact Mastra chunk field names (`payload.text` vs `delta`, tool-call arg streaming shape) —
  pin against the live API; the structural `MastraChunk` type absorbs minor differences.
- Whether `createRun` accepts an external runId — fallback map noted above.
- Mastra Postgres storage package/config (`@mastra/pg` or core storage) — server adapter detail.
