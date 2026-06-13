# Golden-set eval harness + two step-6 follow-ups — sub-project 7c-D

**Date:** 2026-06-13 · **Branch:** `feat/7c-packaging` · **Status:** design

## Goal

Give each workflow a **golden-set eval**: a deterministic, credential-free regression net that
runs the workflow's agents through the real pipeline on committed share-safe cassettes and asserts
the **structural** outcome (tree shape, gates, statuses, ledger, cards) — not the LLM's exact
prose. This earns the step-7 README claim *"golden-set eval harness per workflow"* and catches the
regression class unit tests miss: a prompt/wiring change that silently stops opening a gate,
proposes the wrong tool, dispatches the wrong number of children, or mis-shapes the proposed
artifact.

Folded into the same sub-project (they share the harness + fixtures): the **two step-6 follow-ups**
that were not browser-driven when the UI was re-pointed —

- **F1 — the 3-at-once server cap** is provably enforced, driven by a deliberately-blocking
  provider fixture so "2 active + queued 1 → auto-start on release" is *observable*, not only
  inferred from a fast-replay integration test where the gate releases slots instantly.
- **F2 — cross-workflow "Treat as lead → Lead inbox"** works end-to-end in the browser (a triage
  card's handoff button dispatches a nested lead-inbox child that runs).

## Non-goals (YAGNI)

- **No LLM-judge / semantic quality scoring** (decided with the user 2026-06-13). The eval asserts
  structure, not "is the draft good". A live `--judge` layer is post-beta.
- **No live-provider eval in CI.** The harness runs on the `demo` record-replay mode (committed
  cassettes); it never calls real `claude`/Mastra and needs no `ANTHROPIC_API_KEY`.
- **No new assertion DSL / snapshot framework.** Scenarios are plain TS objects; assertions are
  vitest `expect` on collected facts.
- **No scrubbing of real recordings into fixtures.** Golden cassettes are authored synthetic
  (invented names/emails/tickets), same hard rule as 7c-B. `scanCassette` gates them.
- **No new HTTP surface.** The harness drives `PipelineService` in-process; F2 reuses the existing
  dev `DEV_RECORD_REPLAY=1` browser path.
- **github-triage in the *deterministic* eval is a stretch** (§5), not a requirement — it is
  covered by F2 (browser) + existing integration tests; a synthetic triage cassette is added only
  if it does not balloon the sub-project.

## Decisions (locked with the user, 2026-06-13)

1. **Structural-on-replay, not LLM-judge.** (The scope-defining fork.) Deterministic, free,
   CI-safe; catches wiring/prompt-structure regressions.
2. **Golden fixtures = committed synthetic cassettes**, the *same* `apps/inbox/demo-cassettes/`
   set that `DEMO=1` already reads (`demoCassettesDir()`), extended to cover lead-inbox. The eval
   and the demo share one share-safe fixture set — no parallel corpus.
3. **Build order C1 → C2 → C3**, each ending in its own eval/browser run.

## Architecture

The harness goes through the **real production code path** minus two substitutions: the provider
is replayed (no LLM) and effects are faked (no Gmail/GitHub). Everything else — `dispatch` →
`WorkerPool` → `RunObserver` → `transition` → `GATE_OPENED` → gate insert → `resolveGate` →
`finish` — is the genuine `PipelineService`. That fidelity is what makes a structural assertion
meaningful: if the wiring regresses, the tree/gate/status facts change.

### 1. Eval runner — `apps/inbox/eval/runner.ts`

A pure function that runs one scenario and returns collected facts. It assembles a
`PipelineService` exactly as the demo server does, but in-process:

```ts
export type GoldenScenario = {
  name: string
  workflow: string            // e.g. 'lead-inbox'
  entryAgent: string          // wf__agent instance id of the START agent
  payload: unknown            // the dispatch payload (the WorkItem source)
  // gates are resolved in arrival order; default = approve. A scenario may script per-gate.
  gateScript?: (gate: GateFacts) => { decision: 'approved' | 'rejected'; form?: unknown }
}

export type RunFacts = {
  items: Array<{ id; agentId; parentId; status; resolution }>      // the WorkItem tree
  gates: Array<{ workItemId; kind; toolName; formKeys: string[] }> // shape, not text
  ledger: Array<{ key; ok: boolean; resultKeys: string[] }>
  cards: Array<{ workItemId; toolName }>                            // render specs that fired
}

export async function runGolden(scenario: GoldenScenario): Promise<RunFacts>
```

Wiring (reused, not rebuilt):

- **DB:** a fresh PGlite in-memory instance per scenario (`isDemo()`-style selection already exists
  in `@atizar/server` `client.ts`/`migrate.ts`). Migrate-on-create; no Docker, no shared state
  → scenarios are parallel-safe.
- **Provider:** the `demo` record-replay mode (`record-replay.ts`, `mode:'demo'`) reading
  `demoCassettesDir()`. A `DemoCassetteMissing` throw is a hard scenario failure (the fixture must
  exist) — surfaced as a clear test error naming the missing key.
- **Effects:** the workflows' existing demo fake-effects (email-inbox `saveDraft`/`applyActions`
  fake-success; lead-inbox `saveDraft` fake `draftId`). No real integration call.
- **Quiesce + gate loop:** the runner subscribes to the `eventBus` board topic and drives a loop:
  while any leaf is `awaiting_approval`, read its gate, apply `gateScript` (default approve) via
  `resolveGate`, continue; finish when every leaf is terminal (`finished`/`error`). A wall-clock
  guard (generous, e.g. 30s) fails the scenario rather than hanging CI.
- **Fact collection:** after quiesce, read the WorkItem tree + gates + `action_ledger` from the
  StateStore, and derive `cards` from the trace (registered render-tool calls). All structural.

### 2. Scenario sets — `apps/inbox/eval/<workflow>.golden.ts`

One file per workflow exporting `GoldenScenario[]`. Each scenario pairs a fixture (cassette key)
with an `expect` block asserted by the test file. Examples of the structural expectations:

- **lead-inbox:** START qualifier → qualifier finishes → (scripted) handoff dispatches one reply
  child nested under it → reply opens a `saveDraft` approval gate whose form has
  `{to, subject, body}` keys → scripted approve → ledger one `{ok:true, draftId}` row → both items
  `finished`. A reject variant → reply `finished`/`rejected`, zero ledger rows.
- **email-inbox:** START sorter → sorter machine-dispatches the expected fan-out (the four batch /
  reply children, asserted by count + agentId) → a batch agent (e.g. SPAM) opens an `applyActions`
  gate whose form has an `items` array → scripted approve → ledger one row, `byAction` shape →
  `finished`.

### 3. Test entry — `apps/inbox/eval/*.golden.test.ts` + `yarn eval`

Thin vitest files: `for (const s of scenarios) it(s.name, async () => expect(await runGolden(s))…)`.
Run via a new root script `"eval": "vitest run -c vitest.config.ts <eval glob>"`, and the same
files are picked up by `yarn test` (so the net runs in normal CI). Pipeline-DB hygiene note from
step 3 does **not** apply — the harness uses PGlite in-memory, not the shared `aiworkflow_test`
Postgres, so there is nothing to truncate and no cross-file clobber.

### 4. Fixtures — synthetic lead-inbox cassettes

email-inbox already has the five committed cassettes. Author **synthetic** lead-inbox cassettes
(`lead-inbox__qualifier.jsonl`, `lead-inbox__reply.jsonl`) into `apps/inbox/demo-cassettes/`,
invented data only, in the same AG-UI event shape the demo cassettes use (TOOL_CALL_START/ARGS/END,
TEXT_MESSAGE_CHUNK, GATE_OPENED at the approval tool). Run `scanCassette` over the new files; the
existing `demo:scan-cassettes` script (and the `guard-cassette-share` hook) cover them. These
fixtures double as DEMO content if lead-inbox is ever un-filtered from demo mode (not required
here).

### F1 — 3-at-once cap (Component 2)

A harness scenario using an **injected blocking provider** (a fake `Provider` whose `run()` parks
on a promise the test controls — NOT a cassette, since replayed cassettes stream instantly and
release slots before the cap is observable). Dispatch three items for a `maxInstances:2` agent;
assert the board model derived from the StateStore shows **2 running + 1 queued**; release one
parked run; assert the queued item auto-starts and lands `running`. This makes the locked
"Stop/cap per agent" decision provably enforced with an observable fixture, closing the step-6
honesty gap.

### F2 — cross-workflow "Treat as lead → Lead inbox" (Component 3)

A browser E2E, not a replay assertion (the follow-up explicitly wants the full UI flow):

1. Record a github-triage cassette: `DEV_RECORD_REPLAY=record`, run triage once (it reads the real
   GitHub board **read-only** — no mutation, per the hard rule), producing a triage card with a
   "Treat as lead" handoff button. This recorded cassette contains real board data → it stays in
   the **gitignored** `.cassettes/`, is **never committed**, and is not the golden fixture.
2. `DEV_RECORD_REPLAY=1 yarn dev`; in the browser: run triage → click "Treat as lead" → assert a
   child lead-inbox WorkItem is dispatched, nested under the triage item with the ↓ connector, and
   runs to its gate. Verifies `resolveDelivery`/`deliveryKey` + the `POST /api/deliver` path live
   (today only integration-tested).

## Testing / verification

- **C1:** `yarn eval` green for lead-inbox + email-inbox scenarios (approve and reject variants);
  `yarn test` + typecheck + lint + build green; `demo:scan-cassettes` clean on the new fixtures.
- **C2:** the cap scenario green (2 running + 1 queued → auto-start), deterministic.
- **C3:** browser flow verified per the `browser-verify` skill (stale-stack kill + ports free
  first); screenshot/snapshot evidence of the nested lead-inbox child.
- **Foundation:** run `check-foundation` — the harness touches providers (injected fake) and the
  framework/userland boundary (eval lives in `apps/inbox`, imports only `@atizar/*` + workflows).

## Build order

1. **C1** — runner + lead-inbox fixtures + scenario sets + `yarn eval`; eval green.
2. **C2** — blocking-provider cap scenario; green.
3. **C3** — record triage cassette, browser-verify the cross-workflow handoff.
4. Update `HANDOFF.md` 7c-D line to ✅ BUILT with an as-built note; `check-foundation`.

## Open questions / risks

- **Synthetic lead-inbox cassette fidelity.** The replayed events must carry a `GATE_OPENED` with a
  real `toolCallId` matching a `TOOL_CALL_START` (the conformance invariant) or `RunObserver` won't
  open the gate. Mitigation: copy the proven event shape from the email-inbox reply cassette,
  swap the data. Verify by running the scenario, not by eyeballing the JSONL.
- **Quiesce detection** must not race (a child dispatched same-tick as the parent finishes). The
  runner gates on the *derived* leaf statuses from the StateStore (the authoritative source), not
  on a board-event count — same lesson as the step-3 `instRef` synchronous-truth gotcha.
- **github-triage deterministic fixture (stretch).** If authoring a synthetic triage cassette is
  cheap once the runner exists, add a `github-triage.golden.ts`; if it fights the board-read tool
  surfacing, leave triage to F2 + integration tests and say so in the as-built note (no silent
  coverage gap).
