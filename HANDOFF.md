# Handoff — where we are & what's next

Living session state: **current status + the next thing to build**. Changes every session.
For stable project context (conventions, gotchas, decisions, commands) see `CLAUDE.md`; for the
full chronological build history see `docs/BUILD-LOG.md`.

## ⏭️ Where we are now

### 🔒 ARCHITECTURE LOCKED (2026-06-09) → `docs/pipeline-updated-3.md`

The build spec for the first public beta, superseding `pipeline-updated.md`/`-2.md` and
absorbing the 50-agent audit (Notion: "Анализ архитектуры v3"). Locked decisions:
**server-executed effects** (model proposes + opens gates; the SERVER executes approved
actions through the action ledger, key = `workItemId+gateId`); **Stop/cancel per agent
instance AND per workflow**; **Mastra + Postgres ship IN the first beta** (claude-cli =
dev-only provider — also satisfies "no terminal-spawn in prod" verbatim); **machine dispatch
allowed / machine action never** (origin reserves `inbound`; no trigger code in beta);
**approval expiry = stale badge, never auto-resolve**; **thread = Trace render + per-WorkItem
SSE tail** (drop `@copilotkit/*` transport; KEEP AG-UI vocabulary + render registry + cards;
assistant-ui = named fallback renderer).

**Read order for a fresh agent:** this section → `docs/pipeline-updated-3.md` (the spec — §1.x
numbers below refer to it) → CLAUDE.md gotchas. Answers to questions you'd otherwise ask the
user: dev DB = Postgres in Docker ONLY (`docker compose up -d postgres`; app stays `yarn dev`
on the host — claude-cli needs the local binary + macOS-keychain auth, NEVER containerize the
dev server); SQLite is not used at all (locked decision); `ANTHROPIC_API_KEY` is needed only
at step 5 (Mastra) — do not ask for it earlier; Gmail OAuth already exists at `~/.gmail-mcp/`;
GitHub stays strictly read-only; every step ends with typecheck/test/lint green AND a browser
E2E pass (unit tests provably miss this codebase's bug class); one step = one branch.

**Build order (beta), with implementation hints:**

1. **Provider contract v2** (`resume?` + `GATE_OPENED`) + conformance suite — BEFORE any PipelineService code. — ✅ **BUILT** on `feat/provider-contract-v2` (2026-06-10), 187 unit tests + typecheck/lint/format green + live browser E2E (HITL approve→resume→draft saved; `GATE_OPENED` captured in the live cassette with the right shape). Spec → `docs/superpowers/specs/2026-06-10-provider-contract-v2-design.md`; plan → `docs/superpowers/plans/2026-06-10-provider-contract-v2.md`.
   - **As-built:** `@platform/core` gained `gate.ts` (`GATE_OPENED` CUSTOM-event helpers + zod `GateOpenedValueSchema`), `Provider.resume?` + `ResumeHandle`/`GateResolution` in `providers.ts`, and `conformance.ts` (`providerConformanceChecks` — 4 invariants). `claude-stream` emits `GATE_OPENED` at both approval suspend points; `claude-cli` + `mock` implement `resume()` and pass conformance. **The new run-envelope type was NOT added** — the additive surface keeps `RunAgentInput` (the `{workItemId,source,payload,origin}` envelope belongs to the dispatch chokepoint, step 3, not this contract). record/replay untouched (per answer (5)).
   - Where: `packages/core/src/providers.ts`. Keep `run(input) → AsyncIterable<BaseEvent>` untouched; add optional `resume?(handle, resolution) → AsyncIterable<BaseEvent>` (spec §1.4). [run-envelope: deferred to step 3 dispatch — see As-built.]
   - `GATE_OPENED` = an AG-UI `CUSTOM` event (typed helper in core). claude-cli synthesizes it inside `claude-stream.ts` exactly where approval-tool-call detection lives today; the orchestrator must listen ONLY for this signal, never for tool names.
   - Conformance suite = one vitest file parameterized over providers (mock now; claude-cli via the already-injected fake `spawn`): asserts stream shape, GATE_OPENED at the approval point, resume continues with the verbatim artifact. Mastra joins the same suite at step 5.
   - Don't break the running app: the current CopilotKit path keeps working until step 6 — add an adapter from the old `RunAgentInput` to the new envelope rather than rewiring the server now.
   - **Step-1 design decisions (ANSWERED 2026-06-10 — do not re-ask):**
     (1) Coexistence = **additive**: `run()` stays backward-compatible (still detects resume via messages), `resume()`/`GATE_OPENED` added beside it; `resume()` has no prod caller until step 3 — the conformance suite covers it.
     (2) `GATE_OPENED` = **AG-UI CUSTOM event** with a zod-typed value in `@platform/core`. Value = `{ gateKind, toolName, toolCallId, proposedArtifact }` — **NO `resumeHandle` inside the event**: events get recorded into cassettes (and the Trace table at step 3), so they must stay light and must not duplicate the transcript. The caller of `run()` already owns everything the handle needs — it mints and holds the handle itself.
     (3) `resume?(handle, resolution)` with `ResumeHandle = { runId, input }` is right for step 1 (opaque-token abstraction deferred until a provider needs it). Two notes: (a) full transcript-seeded resume (§3.1) arrives only at step 3 when Trace exists — until then claude-cli's resume re-primes from input + resolution exactly like today's mechanism, extracted into a shared helper; (b) make the resume PROMPT TEXT a parameter of that helper, not hardcoded "human approved" — at step 4 it changes to "the action was already executed by the server with <artifact>" (server-executed effects), and `GateResolution` will gain an optional `executedResult?` field then.
     (4) Conformance suite = provider-agnostic `runProviderConformance(makeProvider)` against claude-cli (fake spawn) + mock now, Mastra slot at step 5. Invariants as proposed (GATE_OPENED on approval tool; resume(approved) completes without re-gating; resume(rejected) terminates; surface filtering; one messageId per contiguous text).
     (5) record/replay **untouched at step 1** (keep `resolvedApprovalCount` keying; old cassettes simply lack GATE_OPENED, which is backward-tolerant). Re-key + wipe happens at step 5 with the envelope change.
2. **Week-0 spike: RunObserver + browser attach** — ✅ **BUILT & browser-verified** on `feat/provider-contract-v2` (2026-06-10). 200 unit tests + typecheck/lint/format green; all 4 PASS criteria verified in the browser on the `lead-inbox__reply` cassette (`DEV_RECORD_REPLAY=1`, true replay — cassette mtime unchanged). Spec → `docs/superpowers/specs/2026-06-10-runobserver-browser-attach-spike-design.md`; plan → `docs/superpowers/plans/2026-06-10-runobserver-browser-attach-spike.md`.
   - **As-built — what SURVIVES into steps 3/6:** (1) **`foldEventsToMessages`** in `@platform/core` (`packages/core/src/fold.ts`) — pure left-fold of AG-UI events → `Message[]` (the reduction CopilotKit did internally); the client pairs results with the existing `pairToolResults`. (2) The **read endpoint shapes**: `GET /api/workitems/:id/trace?from=seq` → `{id,status,done,nextSeq,events:[{seq,event}]}` and `GET /api/workitems/:id/stream` (SSE, `id:`=seq, `data:`=AG-UI event, named `event: status` on status change, honors `Last-Event-ID`). (3) The per-WorkItem monotonic `seq` cursor; the client orders/dedupes by `seq` (so duplicate/out-of-order SSE on reconnect is harmless — the server makes no ordering guarantee between backlog and live).
   - **As-built — THROWAWAY (deleted/replaced at step 3):** the in-memory `Map<id,WorkItemRun>` store + RunObserver consume loop (`apps/inbox/server/dev-runs.ts`); the dev start/resolve routes (`POST /api/dev/runs`, `POST /api/dev/workitems/:id/resolve`); the `?spike=1` client page (`apps/inbox/client/src/spike/TraceSpike.tsx`, mounted in `main.tsx`). Step 3 replaces the store with Postgres-backed Trace + the dispatch chokepoint; step 4 replaces resolve with gate-keyed `POST /api/gates/:id/resolve` (transition + ledger).
   - **As-built — durable refactor:** `buildProvider` extracted from `buildAgent` (`build-agent.ts`) so the RunObserver consumes the SAME wrapped provider (incl. record/replay) as the CopilotKit agents — one code path. `withRecordReplay` now also wraps `resume()` (Variant A, key = `resolvedApprovalCount(handle.input)+1`), exercising the real v2 `resume()` and reusing the recorded `step:1`.
   - **Browser E2E (all 4 PASS):** (1) attach mid-run → `renderLead` done + `saveDraft` running + gate banner with the proposed draft artifact, `awaiting_approval`; (2) reload mid-run (id rides in `?spike=1&id=…`) → re-attaches to the same live server run, full history restored, nothing lost; (3) Approve (plain POST) → the already-open SSE tail continues across the resume boundary (no reconnect), resume text appears, status flips to `done`; (4) reload after approve → full **stitched** history (one trace, two provider runs: `run()` 18 events + `resume()` 2 → `nextSeq` 20). **Loss boundary** = a SERVER restart (in-memory store) — exactly what step 3's Postgres Trace removes; not hardened now (2-day timebox).
   - **Lesson (spike bug found ONLY by the browser, fixed):** the terminal `done`/`error` status SSE write was fire-and-forget, then `cleanup()` synchronously resolved the `streamSSE` promise → the stream closed before the queued write flushed → the UI stayed `running` though the server was `done`. Fix: close only AFTER the terminal write resolves (stream writes are FIFO, so this also flushes the preceding event writes); same guard on the backlog already-done path. Invisible to typecheck/unit tests — only the browser E2E surfaced it. (`saveDraft` chip stays "running" is EXPECTED — the approval tool never gets a `TOOL_CALL_RESULT` under the HITL-kill model.)
   - Minimal: a dev-only route that calls `provider.run()` purely server-side, teeing events into an in-memory `trace[]` + an EventEmitter. Two read endpoints: `GET /api/workitems/:id/trace?from=seq` (JSON history) and an SSE tail (`text/event-stream`, `id:` = seq, `data:` = AG-UI event).
   - Client side: fold events → messages by reusing `AgentModal`'s existing pairing logic (`apps/inbox/client/src/components/AgentModal.tsx` walks messages + pairs tool results already).
   - Iterate on cassettes (`DEV_RECORD_REPLAY=1`), not live claude runs. PASS = open the browser MID-run and see history + live tail; reload mid-run loses nothing. FAIL = stop and redesign the thread plan before step 3.
   - **Resume replay from cassettes (ANSWERED 2026-06-10 — do not re-ask): wrap `resume()` in
     `withRecordReplay` too** (additive, same decorator at the same `build-agent` seam), key =
     `resolvedApprovalCount(handle.input) + 1` — reuses the already-recorded `step:1` and
     exercises the REAL v2 `resume()` (the legacy synthesized-transcript path is what step 3
     deletes — replaying through it would validate the wrong thing). Auto-mode semantics stay:
     no recorded step at that key → fall through to the real provider and record under it. Use
     cassettes recorded AFTER the step-1 branch (older ones lack `GATE_OPENED`).
   - **Spike boundary on approve (ANSWERED 2026-06-10 — do not re-ask): include approve→resume, minimally.** The spike must prove BOTH unproven client assumptions: (a) attach without CopilotKit, and (b) approve as a plain HTTP POST with the SAME open SSE tail continuing across the resume boundary — one WorkItem = one trace stitched from two provider runs is a load-bearing invariant of the thread design, and `resume()` already exists from step 1 (~20-30 lines: dev-only `POST .../resolve` flips an IN-MEMORY gate flag and calls `provider.resume()`, teeing into the same `trace[]` + emitter). HARD boundary — none of: `transition()`/guards, Gate table, ledger, formRev, server-executed effects (approve resumes, it executes nothing). Extra PASS line: after resolve, the already-open tail continues WITHOUT reconnecting, and a reload after approve shows the full stitched history. The 2-day timebox wins: if approve→resume threatens it, ship attach-only and note it.
3. **Server spine on Postgres**: StateStore (drizzle-kit + `schema_version`), dispatch chokepoint, `transition()` API with guards, WorkerPool, board SSE. — ✅ **BUILT & browser-verified** on `feat/provider-contract-v2` (2026-06-10). 226 unit tests (incl. real-PG integration + race tests) + typecheck/lint/format green; all 4 spike PASS criteria verified on the Postgres spine PLUS the new durability guarantee (restart mid-`awaiting_approval` → gate survives). Spec → `docs/superpowers/specs/2026-06-10-server-spine-postgres-design.md`; plan → `docs/superpowers/plans/2026-06-10-server-spine-postgres.md`. Commits `1012cd3`…`f4ac81c`.
   - **As-built — code layout** (`apps/inbox/server/pipeline/`): `db/{schema,client,migrate,reset}.ts` + `db/migrations/` (drizzle-kit); `stateStore.ts` (typed CRUD — the ONLY status writer is `transition`); `transition.ts` (`start|gate|resume|finish|fail` edges, `SELECT … FOR UPDATE`, leaf→root auto-finish walk = the finished entry guard, in one place); `dispatch.ts` (mint id + dedup-by-`source` + depth cap 5 + finish-vs-dispatch reopen); `workerPool.ts` (per-agent cap+queue ported from `instancesCore`); `eventBus.ts` (one EventEmitter, `board` + `workitem:<id>` topics); `runObserver.ts` (consume `provider.run`/`resume`, append Trace, GATE_OPENED → insert Gate + `transition(gate)` + release slot, render-tool → `card`, finalize); `pipelineService.ts` (façade); `routes.ts` (ported spike endpoint shapes); `sweep.ts` (startup reconciliation). `dev-runs.ts` (the spike store) is **deleted**.
   - **As-built — schema** = spec §3 verbatim. Status pgEnum carries the full §5 union; step 3 WIRES `queued→running→awaiting_approval→running→finished|error` only (`result/closed/awaiting_input` + cancel edges = step 4). `resolution` is a marker column. `form_rev`/`assignee`/`expires_at`/`action_ledger` are seams written at step 4.
   - **As-built — DB topology:** `client.ts` DEFAULTS `DATABASE_URL` to the compose creds so zero env setup is needed. **Migrate-on-boot** + a **startup sweep** (`running`→`error('executor lost')`, `queued` re-enqueued, `awaiting_approval` LEFT durable). `predev` now `docker compose up -d --wait postgres`.
   - **As-built — test isolation (IMPORTANT footgun fixed):** pipeline tests run against a SEPARATE `aiworkflow_test` DB (vitest `test.env.DATABASE_URL` + a `globalSetup` that creates+migrates it). The no-truncate test strategy (unique uuids/sources per test, membership-based board asserts → DB test files run parallel-safe) left rows in the shared DB; on the next dev boot the **startup sweep re-enqueued those `queued` rows and spawned REAL `claude`** (DEV_RECORD_REPLAY unset). Separate DBs remove it. **If you add pipeline tests, keep them on `aiworkflow_test` and DO NOT truncate in `beforeEach`** (clobbers parallel files).
   - **As-built — resolve is dev-grade (step-4 boundary held):** `POST /api/dev/workitems/:id/resolve` → `transition(resume)` + `provider.resume()` ONLY. NO formRev/ledger/server-executed effect (that is step 4); the model proposes, nothing is executed. The step-2 `withRecordReplay` resume wrapper replays `step:1` so approve→resume works under `DEV_RECORD_REPLAY=1`.
   - **For the step-4 agent:** the gate-keyed `POST /api/gates/:id/resolve` (formRev 409 + `action_ledger` claim + execute `@platform/integrations/gmail-basic` createDraft directly + `resume` primed with "executed with <artifact>") replaces the dev `/api/dev/workitems/:id/resolve`; `GateResolution` gains `executedResult?`; cancel edges + the full all-inbound-edges guard table extend `transition.ts`; the effect tool leaves the model allow-list (`apps/inbox/workflows/lead-inbox/server.ts`) and `reply.prompts.ts` becomes propose-don't-execute. The `transition()` guard mechanism + `action_ledger` table + `form_rev` column already exist.
   - `docker-compose.yml` with a `postgres` service only; `DATABASE_URL` in `.env.local`; extend `predev` to start the container if it isn't running.
   - Drizzle schema (`work_items`, `gates`, `trace` PK `(work_item_id, seq)`, `action_ledger` PK `key`) + drizzle-kit migrations from the very first table (spec §1.7).
   - ONE `transition(workItemId, edge)` function owns every status change: `BEGIN` → `SELECT … FOR UPDATE` on the row (and the parent for finish/reopen, ascending-id lock order) → guard check → `UPDATE` → `COMMIT`. The `finished` entry guard lives HERE, once, for all five inbound edges (spec §1.2).
   - ONE `dispatch()` chokepoint mints the WorkItem id, checks one-time dedup (ledger/approved children only) + depth cap, enqueues. WorkerPool ports the pure logic from `apps/inbox/client/src/instancesCore.ts` (cap + queue, already unit-tested) — port, don't redesign.
   - RunObserver (from the spike, now real): consume `provider.run()`, append trace rows, GATE_OPENED → insert Gate + `transition(awaiting_approval)` + kill via provider; registered render tool → fill `card`; stream end → finalize status.
   - Race tests run against REAL Postgres (the compose container) in CI: concurrent finish-vs-finish and finish-vs-dispatch.
4. **Server-executed effects + Stop** — ✅ **BUILT & browser-verified** on `feat/provider-contract-v2` (2026-06-10). 248 unit tests (incl. real-PG: ledger one-execution, formRev 409, cancel/reject edges, failing-effect→error) + typecheck/lint/format green; all 6 browser/runtime E2E flows verified (below). Spec → `docs/superpowers/specs/2026-06-10-server-executed-effects-stop-design.md`; plan → `docs/superpowers/plans/2026-06-10-server-executed-effects-stop.md`. Commits `43611b6`…`1ab2b0a` (incl. fixes: `e300153` qualifier-tools surfacing, `4b24bb5` cancelItem terminal guard, the double-release + failing-effect fix, and prettier).
   - **As-built — contract:** `@platform/core` `defineAgent` gained `effects: string[]` (zod **`effects ⊆ approvals`**) + `readonly: string[]`; `GateResolution.executedResult?` + `PromptStrategy.buildResume(args, executedResult?)`. `ServerBinding.effects: { [approvalTool]: (form, ctx) => Promise<result> }` (functions in the server layer, names in core — the `renders` pattern); `EffectFn` type in `server-binding.ts`. **Boot checks** (`apps/inbox/server/agent-checks.ts`, wired in `index.ts`): (1) effect bindings ⇔ `def.effects` both ways; (2) every allow-listed tool's bare name ∈ `readonly ∪ approvals ∪ keys(renders)` — unclassified ⇒ server refuses to start. The model's allow-list lost `mcp__gmail__create_draft`; `qualifier` declares `readonly: ['get_latest_email']`; `triage` got `readonly: ['list_my_tickets','get_ticket']`.
   - **As-built — effect execution:** `createDraft` was EXTRACTED from the Gmail MCP into a pure exported `@platform/integrations/gmail-basic/create-draft` (injectable `getGmail`; MCP wrapper + server both call it; `errText` moved to `format.mjs`). `POST /api/gates/:id/resolve` `{formRev, decision, form?, comment?}` → `PipelineService.resolveGate(gateId, …)`: formRev mismatch → **409**; `claimLedger` (INSERT ON CONFLICT DO NOTHING, key `workItemId:gateId`) licenses exactly ONE execution; the SERVER calls `effects[gate.toolName](editedForm, ctx)` → real `createDraft`; `setLedgerResult`; then `observer.resume` primed via the propose-don't-execute reply prompt (reads `executedResult.draftId`). **A failing effect (`{error}`) fails the work item (`transition(fail)`, HTTP 502) — never a false "saved".** A re-resolve after the gate closed is idempotent (returns the prior ledger result, no second execution).
   - **As-built — Stop:** `transition.ts` gained `cancel` (from queued/running/awaiting_approval/awaiting_input) + `reject` (from awaiting_approval) edges, each writing the `resolution` marker; the active-children deferral guard stays scoped to `finish`. RunObserver drives an explicit `AsyncIterator` registered in `Map<id, iterator>`; `cancel(id)` calls `iterator.return()` → the claude-cli generator's `finally` kills the subprocess; `consume`'s post-loop is **terminal-tolerant** (a concurrent cancel that already finalized the item is not overridden). `PipelineService.cancel`/`cancelWorkflow` cascade parent-first then ascending-id; `cancelItem` early-returns on already-terminal items and does NOT release the pool slot (queued never held one; running's slot is released by its own consume loop; awaiting_approval's was released at the gate) — fixes a double-release that could over-admit queued work. `WorkerPool.dequeue` removes a queued id on cancel. Routes: `/api/workitems/:id/cancel`, `/api/workflows/:id/cancel`, `GET /api/workitems/:id/gate`; the dev `/api/dev/workitems/:id/resolve` is GONE (the dev START `/api/dev/runs` stays for the spike until step 6).
   - **As-built — deviations from the plan's pseudo-code (all sound, verified):** (a) `resolveGate` does NOT itself `transition(resume)` — `observer.resume` owns that edge (avoids a double-transition); (b) the **reject** path does `transition(reject)` and does NOT call `observer.resume` (resume from `finished` would be illegal; the claude-cli rejected-branch is now reachable only via the legacy `run()` path — UI shows the `rejected` marker, no model narration); (c) no `setResolution` store method (the transition writes the marker).
   - **Browser/runtime E2E (all 6 PASS, `DEV_RECORD_REPLAY=1` + the trimmed `lead-inbox__reply` cassette):** (1) **edited approve → real Gmail draft** — edited the gate body, approved; DB: gate `resolved` with the edited `form.body`, `action_ledger` one row `{ok:true, draftId}`, work item `finished`; **fetched the real draft by id from Gmail → body contained the edited marker `7Q3Z`** (the load-bearing guarantee); thread showed the new resume narration "The Gmail draft was saved successfully." (no `create_draft`). (2) **reject** → `finished`/`rejected`, zero ledger rows. (3) **Stop mid-running** → caught at `running`; stream killed mid-flight (8/18 trace events), `finished`/`cancelled`, status not flipped back (terminal-tolerant). (4) **Stop at awaiting_approval** → `finished`/`cancelled`, gate `GET` → 404. (5) **restart durability** → killed+restarted the server mid-`awaiting_approval`; both gates SURVIVED (startup sweep leaves `awaiting_approval` durable), gate still fetchable. (6) **stale formRev → 409**, item not consumed (stays `awaiting_approval`). The `saveDraft` chip stays "running" (expected — HITL-kill means the approval tool never gets a `TOOL_CALL_RESULT`). Effect runs OUTSIDE record/replay → approve hits real Gmail (draft-only; the one test draft was deleted).
   - **Deferred to post-beta (decided, NOT built):** gate `capabilities` (editability derives from `kind`); runtime default-deny at the execution seam (only the boot-time classification kernel was taken — it is physically meaningful at the Mastra/server seam, step 5+); budget edge. **For the step-5 agent:** the `expires_at`/`assignee` Gate columns + stale badge are seams present in the schema but UI is post-beta; `reply.prompts.ts` is now propose-don't-execute; the conformance suite from step 1 is the Mastra definition-of-done.
5. **Mastra provider** (production path) beside claude-cli (dev). — ✅ **BUILT & browser-verified** on `feat/provider-contract-v2` (2026-06-10). 276 unit tests (incl. the Mastra conformance suite — the two-unlike-providers proof) + typecheck/lint/format green; live Mastra E2E (approve→real Gmail draft / reject / cancel) verified server-side AND in the browser (`?spike=1` replay). Spec → `docs/superpowers/specs/2026-06-10-mastra-provider-design.md`; plan → `docs/superpowers/plans/2026-06-10-mastra-provider.md`. Commits `26cee2c`…`845597b`.
   - **As-built — injected `MastraRunner` seam (fork 1):** `@platform/providers` gained `mastra-types.ts` (`MastraRunner`/`MastraRun`/`MastraRunResult`/`MastraChunk`), `mastra-stream.ts` (chunk→AG-UI mapper, mirrors `claude-stream`), `mastra-provider.ts` (`createMastraProvider` — pure, NO `@mastra/*` import). The real Mastra Agent + 2-step workflow + Postgres storage lives in `apps/inbox/server/mastra/{tools,runner}.ts`. Conformance runs on a fake runner (no API key); the live key is only for E2E.
   - **As-built — gate via propose tool (fork 2):** one generic workflow `agentStep → gateStep`. `saveDraft`/`renderLead`/`renderVerdict` are no-op capture tools (`execute: (inputData)=>inputData`); `get_latest_email` is a native read tool calling the **extracted** `@platform/integrations/gmail-basic/get-latest-email` (mirrors `createDraft`; the MCP `index.mjs` now delegates to it too). agentStep captures the LAST approval tool-call; gateStep `suspend()`s with it. The provider synthesizes `GATE_OPENED` from the observed approval call (refinement vs spec — robust to Mastra's suspend-payload shape).
   - **As-built — native resume (fork 3 / fork 4):** `resume()` = `createRun({ runId }) + resumeStream({ resumeData })` against the parked suspended snapshot (NO kill-and-re-prime). One **shared** `PostgresStore` (bounded pool `max 8`) across all agents — a per-agent store exhausted PG connections at boot. `ProviderConfig` gained `instructions` + `agentId` (threaded from `buildProvider`); `providers.ts` adds the `mastra` factory + `PROVIDER=mastra` alias (default stays `claude-cli`) + `ANTHROPIC_API_KEY` fail-fast + `MASTRA_MODEL` (default `claude-sonnet-4-6`); DB url reuses `client.ts` `databaseUrl`.
   - **THE bug the live E2E caught (cautions paid off):** the provider's `finally{run.abort()}` fired on a clean SUSPEND too, cancelling the parked Mastra run → resume failed _"This workflow run was not suspended"_. Fix: track `settled`; abort ONLY on interrupt (Stop/`iterator.return`), never on a clean suspend/finish (+2 unit tests). caution (a) cancel-mid-run, caution (b) last-wins/no-draft, caution (c) Mastra tables out of our drizzle set + `reset.ts`/test-globalSetup init — all built and verified.
   - **Deviations from the plan (sound):** record/replay re-key was **DEFERRED** — the message-scan step key already yields the correct 0/1 steps in the server-spine single-gate model (`input.messages` carries no resolved-approval transcript; re-keying would couple the dev decorator to StateStore + risk regressing claude-cli for zero behavioural gain). Cassettes were wiped. `/api/dev/runs` gained an optional `payload` (drives the gate on a fresh real run — throwaway, dies at step 6). **Pre-existing latent issue noted (NOT step-5):** `WorkerPool.resumeAcquire` calls `opts.run` → a benign `IllegalTransition: cannot "start" from "running"` is logged on every resume (the real resume runs via `observer.resume`'s own `consume`); harmless but worth cleaning at step 6.
   - **DX note:** the server does NOT auto-load `.env.local`; `PROVIDER=mastra` needs `ANTHROPIC_API_KEY` in the process env (`set -a; . ./.env.local; set +a` before `yarn dev`, or add `--env-file`). Worth wiring `.env.local` loading at step 6/7.
6. **Re-point board/thread UI** to server state; delete `@copilotkit/*` deps. — ✅ **BUILT & browser-verified** on `feat/provider-contract-v2` (2026-06-10). 277 unit tests + typecheck/lint/format/build green; the UI is fully server-driven and `@copilotkit/*` is gone from the import graph AND `package.json` (`@ag-ui/client` stays — the event vocabulary). Spec → `docs/superpowers/specs/2026-06-10-server-driven-ui-step6-design.md`; plan → `docs/superpowers/plans/2026-06-10-server-driven-ui-step6.md`.
   - **Scope discovery (the step-6 line glossed it):** server-side **handoff did not exist** — steps 3–5 only ever drove single agents via `/api/dev/runs`. But handoff is **human-gated** (a card button with a hardcoded `Destination`, NOT model-autonomous), so it became one `POST /api/deliver` endpoint + lifting the pure `resolveDelivery`/`deliveryKey` into `@platform/core` (`packages/core/src/delivery.ts`). The server resolves the destination and dispatches a CHILD work item (`parentId` = the card's work item); dedup-by-`source` is the chokepoint's existing job.
   - **As-built — server:** `POST /api/deliver` ({origin, dest, payload, parentId} → resolve + dispatch child, origin `agent`); `/api/dev/runs` promoted to `POST /api/dispatch` (human START); `PipelineService.deliver` (+ `descriptors` dep); `dispatch`/`deliver` now `publishBoard()` so a freshly-queued item shows immediately. The CopilotKit endpoint (`createCopilotEndpoint`) + `buildAgent` are DELETED — pipeline routes are the only transport.
   - **As-built — client:** four data hooks (`hooks/useBoard` snapshot+SSE-refetch, `hooks/useWorkItemThread` trace+SSE-tail+`foldEventsToMessages`, `hooks/useGate` gate+formRev approve/reject, `hooks/useDispatch` start/deliver/cancel); `boardModel.ts` maps server `WorkItem[]` → the EXISTING pure `pipelineModel`/`aggregate` (cap/queue now server-side); `status.mapStatus` (server union → display `Status`); `serverTypes.ts` (client mirror of the schema fields). `buildRenderToolCall` replaces CopilotKit `useRenderToolCall` (parse tool args → render spec). Approval is **gate-driven**: `HitlSpec.render` ctx changed to `{form, formRev, status, approve, reject}`; `ApprovalDialog` is now an editable textarea (the edited body is the load-bearing "edited text → Gmail" path); `ThreadModal` owns the per-item hooks (keyed by id so a reload remounts fresh) + renders the gate card from `useGate`. Handoff notes are DERIVED from board `parentId` topology (no client deliver state). The open work item id rides in `?open=<id>` so a reload re-attaches. A per-workitem **Stop** button was added to the thread (found missing during E2E — "Stop per agent" is a locked decision).
   - **DELETED:** `useAgentInstances`, `instancesCore` (client copy), `statusFrom`, `InstanceTools`, `useWorkflowRenders`, `LiveInstanceModal`, `spike/TraceSpike`, the `?spike=1` mount, the `<CopilotKit>` tree, `/api/dev/runs`, both `@copilotkit/*` deps. KEPT: `renderRegistry` + all cards, `RenderSpec`/`HitlSpec` (HITL ctx changed), `pipelineModel`/`aggregate`/`buckets`/`devMode`/`status`/`threadResults`, `WorkflowSwitcher`/`PipelineColumn`/`AgentCard`/`InstancePickerModal`, Smedja `styles.css`, `?dev=1`.
   - **Browser E2E (replay, `DEV_RECORD_REPLAY=1`):** ✅ **single run** (START → qualifier runs → Done); ✅ **handoff** (`/api/deliver` → reply child nested under the qualifier with the ↓ connector, parent reopened to Working, derived "→ Handed / ← Received" notes + "Open" jump); ✅ **approve WITH an edited artifact** — edited the gate body to insert `EDITED-MARKER-7Q3Z`, approved, **fetched the real Gmail draft by id → the edited body was present** (ledger one row `{ok,draftId}`, item `finished`, parent auto-finished); ✅ **reject** (`finished`/`rejected`, zero ledger rows); ✅ **cancel via the UI Stop button** (`finished`/`cancelled`, gate 404); ✅ **reload re-attach** (fresh navigation to `?open=<id>` rebuilds the full thread + gate from the trace/gate endpoints); ✅ **board SSE live coherence** (handoff/status updates appeared live without reload); ✅ **post-deps-removal smoke** (booted clean, single run works, no `@copilotkit` in node_modules). **NOT browser-driven this session (honest):** 3-at-once cap (covered by the `pipelineService` blocking-provider integration test — under fast replay the gate releases slots, so "2 active + queued 1" isn't reliably observable); cross-workflow "Treat as lead" (the contract resolution + schema validation are covered by the `pipelineService.deliver` integration test; a live triage run has no cassette and would hit the real GitHub board). Both are follow-ups for step 7's golden-set/eval pass.
7. **Extraction + packaging (the beta IS the framework — locked decision #7, 2026-06-10)**: FIRST extract `apps/inbox/server/pipeline/` → `@platform/server` and the board/thread UI → `@platform/react` (mechanical folder moves if the import discipline below held), then slim the demo app down to workflows/config that consume ONLY the public packages — the living proof of belief #3 (userland never imports internals). The beta deliverable = the monorepo of libraries + this thin demo app, NOT a clone-template app. Then: zero-cred demo (`DEMO=1` → mock provider + SYNTHETIC cassettes authored fresh, scanCassette gate in CI), README 10-minute script, LICENSE (MIT vs Apache-2.0 — ask the user), `@platform/*` scope rename, golden-set eval per workflow, shared bearer token on all mutation routes (honest `resolvedBy`). npm publish at launch vs monorepo-first is a launch-time call — the package BOUNDARY is the deliverable, the registry is logistics.

**Anticipated decisions, steps 3–7 (ANSWERED 2026-06-10 — decide-and-go, do not re-ask the user):**

- **Coexistence model for steps 3–5 (the big one):** the new pipeline is built BESIDE the old
  CopilotKit path, not into it. During steps 3–5 the new spine drives the lead-inbox flow through
  the spike's dev surface (dev page + trace/SSE endpoints); the old board stays untouched and
  working. The swap happens once, at step 6. Never half-migrate the old board mid-step, and do
  NOT write an old↔new adapter beyond what step 1 already shipped.
- **Code layout:** pipeline code lives in `apps/inbox/server/pipeline/` (PipelineService,
  StateStore, RunObserver, WorkerPool, transition, dispatch) **during steps 3–6**. Do NOT create
  `@platform/server` mid-build — extraction happens ONCE, at step 7, after the API stops churning
  (it IS a beta deliverable, not post-beta — locked decision #7).
  **Extraction discipline so the step-7 move is mechanical:** CONTRACTS/types/pure helpers go into
  `@platform/core` immediately (the steps-1/2 pattern: `gate.ts`, `conformance.ts`, `fold.ts`);
  implementation stays in the app, and `server/pipeline/` may import ONLY `@platform/*` + its own
  folder — never the rest of `apps/inbox` (no reaching into workflows/, client/, mcp/). Same rule
  for the new board/thread UI at step 6: components destined for `@platform/react` import only
  `@platform/*` + each other.
  **`@platform/react` boundary (decided 2026-06-10): machinery in, cards out.** The package ships
  the data hooks (useBoard / useWorkItemThread / useGate-with-formRev / useCancel), the chrome
  (workflow board/desktop, workflow SWITCHER tabs with delivery badges, pipeline column +
  instance tree, AgentCard type-cards, thread view, editable GateForm with approve/reject,
  Stop button, status/stale badges), the `registerCard` render-registry + primitives kit, and
  the theme. Litmus test: renders from the generic model (Workflow/Agent/WorkItem/Gate/status)
  → package; knows the vertical's payload (lead, ticket, draft) → userland card.
  **`@platform/react` beta component inventory (decided 2026-06-10):**
  _Board surface:_ WorkflowBoard (desktop grid), WorkflowSwitcher (tabs + delivery badges),
  PipelineColumn + InstanceTree (L-connectors, `queued: N`), AgentCard (type card: name, START,
  aggregate), StartButton/dialog (THE human-initiated dispatch gesture), InstancePicker, idle
  AgentDescription view (the P2 fix), DoneDrawer (finished/closed list with reopen — records
  leave the board but never vanish).
  _Thread surface:_ ThreadView (foldEventsToMessages + live tail + autoscroll), GateForm
  (editable artifact, approve/reject, formRev-409 → re-render flow), GateHistory (resolved
  gates as ✓ steps), SourcePanel (renders the WorkItem's source content NEXT to the proposed
  artifact — the prompt-injection mitigation; generic "what the agent worked from" frame),
  StopButton (workitem + workflow variants), RejectedState (comment + explicit re-run),
  ErrorState (retry/drop actions), CostBadge (cost/latencyMs/tokens fields), StatusBadge +
  StaleBadge, "Open in <workflow>" jump link.
  _Dev/observability:_ TraceLog — raw AG-UI event inspector behind `?dev=1` (seq, event type
  filter, tool args/results; the beta's run-inspector and the only observability surface),
  DevModeToggle, ToolChip (raw tool-call chip in dev mode).
  _Card construction kit (cards themselves are userland, the KIT is the package):_ CardShell —
  the generic card frame (head/title/kicker/badge/body/actions zone; today implicit in Smedja
  CSS that each card hand-assembles — extract it ONCE so userland cards inherit the look),
  primitives kit (Card, Field, Badge, Button, List), `registerCard` registry, and the in-card
  building blocks (GateForm, SourcePanel, CostBadge, StatusBadge). An approval card is literally
  CardShell + SourcePanel + GateForm; a userland card = CardShell + primitives + ~30 lines of
  vertical-specific fields.
  _Infra:_ ConnectionStatus (SSE state + "reconnecting → snapshot refetch" indicator — cheap
  and trust-critical).
  _Hooks:_ useBoard, useWorkItemThread, useGate, useCancel, useStart, useThreadResult (how a
  card reads a data-tool's result from the thread — today's ThreadResultsContext, ported),
  useDevMode, useConnectionState.
  _Deliberately NOT in the beta package:_ approvals-queue inbox view, notifications/email
  approve links, batch approve, analytics — post-beta (market table-stakes list).
  **Styling (decided 2026-06-10): plain CSS + design tokens as CSS custom properties.** The
  package exports `tokens.css` (all `--atz-*` variables: colors, surface, radius, font,
  spacing — documented) and `styles.css` (components, `atz-` prefixed classes, values ONLY via
  tokens). No Tailwind requirement, no CSS-in-JS, no build step — works in any bundler or a
  plain `<link>`; this is a port of the existing Smedja CSS, not a rewrite. Customization is
  three-layered: (1) integrator rebrand = override tokens (copy tokens.css, change values);
  (2) full control = every component accepts `className`, and the HOOKS are the headless layer
  (useBoard/useGate/etc. know no CSS — build your own UI without forking); (3) consumer-view
  branding (brand color / logo / name) = `editableBy: manager` leaf fields from config-as-data
  (ARCHITECTURE §3) injected into `:root` at runtime — config file in beta, per-account DB
  overrides later, the SAME mechanism as prompt editing. NOT doing: theme marketplace, dark
  mode (token structure permits it later), a Tailwind preset.
  Workflow-specific cards (LeadCard, TriageCard, ReplyDraftCard) are USERLAND — they stay in the
  demo app as exemplars of `registerCard`, never in the package. UI-framework-agnostic logic
  (foldEventsToMessages, status mapping) stays in `@platform/core` (pure TS), so a future
  `@platform/vue` would rewrite only the thin binding layer.
- **Step 3 micro-decisions:** Drizzle over `pg` (node-postgres) — don't bikeshed the driver;
  WorkItem id = `crypto.randomUUID()` ("deterministic at dispatch" in the spec means minted at an
  engine-controlled moment, NOT derived from model output — dedup uses `source`, never the id);
  `agentId` on WorkItem = the existing `wf__agent` instance id; status wire-strings exactly as in
  spec §5 (`queued|running|awaiting_approval|awaiting_input|result|finished|error|closed` +
  `resolution: cancelled|rejected` marker column, NOT extra statuses); Trace `seq` = in-memory
  per-run counter (RunObserver is the single writer per WorkItem — no SELECT max(seq) needed);
  executor handles (kill fns) live in an in-memory `Map<workItemId, handle>` — they are
  process-local by nature, the sweep covers restarts; EventBus = one in-process EventEmitter with
  `board` + `workitem:<id>` topics; port lead-inbox first, GitHub-triage second (it's read-only —
  porting it is mostly config).
- **Step 4 micro-decisions:** the server executes effects by importing
  `@platform/integrations/gmail-basic` DIRECTLY (plain function call — the stdio MCP child is for
  the claude CLI, not for the server; no loopback API needed); the approval tool's args ARE the
  initial Gate `form` AND `proposedArtifact`; `GateResolution` gains `executedResult?` now;
  stale badge = client-side age computation (no sweeper, no cron); cancel cascades to active
  descendants in ascending-id order and records `resolution: cancelled` per item; rewrite
  `reply.prompts.ts` to propose-don't-execute (the model never sees `create_draft` again).
  **Approval→effect binding (ANSWERED 2026-06-10 — do not re-ask): names in core, functions in
  the workflow ServerBinding** (the `renders` pattern). `defineAgent.effects: string[]` with
  validation **`effects ⊆ approvals`** (NOT the older `∩ = ∅` — that phrasing assumed effects
  were model-visible tools; in the binding model the model never sees an effect at all, and the
  integration MCP tool leaves the allow-list). ServerBinding:
  `effects: { saveDraft: (form, ctx: {workItemId, gateId}) => createDraft(form) }` — keyed by
  APPROVAL tool name, returns the result that becomes `executedResult` + trace entry.
  `buildAgent` enforces binding↔declaration exhaustiveness both ways AT BOOT (missing or extra
  binding → startup error, never a silent approve-time no-op). The ledger claim wraps the call
  once in the resolve route, not inside each binding. Spec updated: pipeline-updated-3 §1.1.
  **Step-4 scope on default-deny & capabilities (ANSWERED 2026-06-10 — do not re-ask):**
  capabilities (can_edit/can_respond/can_ignore) → POST-beta; editability derives from `kind`
  for now (approval = editable, choice/rate = not; the jsonb column is a later additive
  migration). RUNTIME default-deny at the execution seam → post-beta AND physically impossible
  under claude-cli anyway (the CLI executes MCP tools itself; the server sees calls
  detect-after-emit — the runtime check becomes meaningful at the Mastra/server seam). BUT take
  the ~20-line enforceable kernel INTO step 4: **boot-time tool classification** — every tool
  in an agent's allow-list must be declared `readonly` | `approvals` | `renders`; an
  unclassified tool = server refuses to start. Same fail-at-boot pattern as the effects-binding
  exhaustiveness check, and it is the README claim a public auditor will test ("add a mutating
  MCP tool undeclared → the framework won't boot", not "silently ran it ungated").
- **Step 5 direction (Mastra):** ask the user for `ANTHROPIC_API_KEY` at the START of this step
  (the only step-gated question). Map `defineAgent` → a Mastra workflow wrapping the agent step;
  a gate = suspend at the approval point with the proposed artifact as the suspend payload;
  `resume()` = Mastra's native `resume(runId, resumeData)`. Known frictions (from the audit —
  expect them, don't rediscover): Mastra signals suspension via run STATUS, not a tool call → the
  provider synthesizes `GATE_OPENED` from it; keep a `workItemId ↔ runId` map in StateStore; do
  NOT mirror Mastra's snapshot/step state into StateStore (belief #2). Big simplification
  available: by step 5 effects are server-side, so the Mastra agent needs only read tools +
  propose/render tools — wire `gmail-basic` read functions as native Mastra tools, no MCP.
  Definition of done = the step-1 conformance suite passes against it. Default provider stays
  `claude-cli` locally (env switch, e.g. `PROVIDER=mastra`).
  **Step-5 design APPROVED (2026-06-10 — do not re-ask), four forks:** (1) INJECT a
  `MastraRunner` interface into `@platform/providers/mastra-provider.ts` (the spawn-injection
  pattern; package stays isomorphic; conformance runs on a fake runner, no API key — live key
  only for E2E; the real Mastra assembly lives in `apps/inbox/server/`). (2) Proposal→gate =
  a no-op PROPOSE tool (`saveDraft`, args = the artifact) inside agentStep, then gateStep
  `suspend({proposedArtifact, toolName, toolCallId})` — keeps the conformance invariant that
  `GATE_OPENED.toolCallId` matches a real TOOL_CALL_START (structured-output alternative
  rejected). (3) `resume()` = native `run.resume({step, resumeData})`; approved branch = short
  confirming narrative (the server already executed the effect — propose-don't-execute),
  rejected = bail; PromptStrategy is legitimately ignored by Mastra. (4) Mastra snapshot
  storage on OUR Postgres but in ITS OWN tables; StateStore keeps only `workItemId ↔ runId`.
  **Three cautions to build in:** (a) `MastraRunner` MUST expose `abort()` — the step-4 Stop
  path kills via the provider, and cancel mid-run under `PROVIDER=mastra` must be in the
  browser E2E or the Stop button silently no-ops on the production provider; (b) `saveDraft`
  is the TERMINAL gesture of agentStep — last-call-wins if the model emits it twice, and the
  no-saveDraft path must finalize as a normal empty finish, never hang; (c) keep Mastra's
  tables OUT of our drizzle migration set (own prefix/schema; `reset.ts` for the test DB must
  init both storages). DoD additions: re-key record/replay (cassette step = store's
  resolved-gate count, wipe `.cassettes/` once) and live E2E for approve AND reject AND
  cancel.
- **Step 6 micro-decisions:** the pure `foldEventsToMessages(events) → messages` ALREADY EXISTS
  (built at step 2, `@platform/core`, unit-tested) — render both history and live tail through it
  (the `?spike=1` page already does); do NOT re-extract it. Extend
  `client/src/status.ts` to the server status union (server is now the source of truth);
  `pipelineModel` keeps working — feed it real `parentId` trees from the board snapshot; the Vite
  `/api` proxy carries SSE fine (no extra config beyond existing `changeOrigin`); delete
  `@copilotkit/*` deps in the FINAL commit of the step, only after the full browser checklist
  passes on the new path.
- **Step 7 micro-decisions:** demo DB = PGlite (Postgres-in-WASM via npm, same dialect, drizzle
  supports it) so `DEMO=1` needs no Docker; synthetic cassettes are authored from scratch with
  invented names/emails (NEVER scrub real recordings); bearer token = `AUTH_TOKEN` env checked by
  middleware on every mutating route (demo mode may default it); LICENSE is the user's call —
  one question, recommend MIT for adoption simplicity vs Apache-2.0 for the patent grant.
- **Ask the user ONLY about:** `ANTHROPIC_API_KEY` (step 5), LICENSE (step 7), and anything that
  would touch real outbound email (never send — draft-only is a product law). Everything else:
  decide, note the decision in HANDOFF as-built, move on.
- **Process invariants:** update this file's step line to ✅ BUILT + an "As-built" note after each
  step (step 1 set the pattern); use record/replay for iteration and FORCE REAL runs
  (`DEV_RECORD_REPLAY=record`) only to verify concurrent HITL (replay masks it — CLAUDE.md);
  before any browser verify, kill stale dev stacks + free ports per the CLAUDE.md gotcha; never
  switch git branches in subagents.

**Starting point for the next session = beta build order step 7** (extraction + packaging — the
beta IS the framework, locked decision #7). Steps 1–6 are ✅ BUILT & browser-verified on
`feat/provider-contract-v2` (NOT merged — same branch strategy). Step 7: FIRST extract
`apps/inbox/server/pipeline/` → `@platform/server` and the board/thread UI → `@platform/react`
(mechanical folder moves — the import discipline held: `server/pipeline/` imports only `@platform/*`

- its own folder; the new client hooks/components import only `@platform/*` + each other). The
  `@platform/react` boundary + beta component inventory + styling decisions are in the anticipated-
  decisions block above. Then: zero-cred demo (`DEMO=1` → PGlite + mock provider + SYNTHETIC cassettes,
  scanCassette CI gate), README 10-minute script, **LICENSE (ask the user — recommend MIT)**,
  `@platform/*` scope rename, golden-set eval per workflow, shared bearer token on mutation routes.
  **Two step-6 follow-ups for the step-7 eval pass** (NOT browser-driven this session): (1) the
  3-at-once server cap (`pipelineService` cap test passes with a blocking provider; under fast replay
  the gate releases slots so it's not browser-observable — drive it with a slow/blocking eval fixture);
  (2) the cross-workflow "Treat as lead → Lead inbox" full browser flow (resolution + schema validation
  are integration-tested; needs a github-triage cassette — record one, since a live triage run reads the
  real GitHub board). **Carried-over cheap cleanups (still open from step 5, deferred past step 6):**
  (a) `WorkerPool.resumeAcquire` re-invokes `opts.run` → a benign `IllegalTransition: cannot "start"
from "running"` logged on every resume — make `resumeAcquire` reserve the slot WITHOUT calling run;
  (b) wire `.env.local` loading into the dev server so `PROVIDER=mastra` "just works".
  **Provider knobs:** `PROVIDER=mastra`, `MASTRA_MODEL` (default `claude-sonnet-4-6`), `ANTHROPIC_API_KEY`
  (in the process env). The Mastra adapter is `apps/inbox/server/mastra/{tools,runner}.ts`; the pure
  provider is `@platform/providers/mastra-*`.

> **CONTINUATION NOTE (2026-06-10) — read me first.** Step 1 was **NOT merged to `master`**; by
> the user's call we keep building **on `feat/provider-contract-v2`** (so step 1 + step 2 share
> this branch — deviates from the usual "one step = one branch"; if you prefer, branch step 2 off
> this branch, not off `master`, since `master` lacks the v2 contract). Step 1 commits run
> `e4e80ac`…`d98d981`; `master` (`1374833`) has only the spec/plan/docker docs, NOT the contract
> code. Fast-iteration aid: a **live E2E this session recorded fresh cassettes** for
> `lead-inbox__qualifier` + `lead-inbox__reply` under `apps/inbox/.cassettes/` (gitignored, REAL
> Gmail data — never commit/share without `scanCassette`), so `DEV_RECORD_REPLAY=1 yarn dev`
> replays the full qualify→handoff→reply→approve→draft flow in ~seconds without burning real
> `claude` runs. The `lead-inbox__reply` cassette already contains a `GATE_OPENED` event — handy
> when wiring the step-2 RunObserver to react to it. `docker compose up -d postgres` is wired into
> `predev`; the DB is up but step 1 doesn't touch it (step 3 does).

> **CONTINUATION NOTE (2026-06-10, after step 2) — for the step-3 agent.** Steps 1 & 2 stay on
> `feat/provider-contract-v2` (NOT merged — same branch strategy). Step 2 commits run
> `f6b9a16`…`344e1e0`; final review = READY TO MERGE, no Critical/Important findings.
> **How to drive the spike surface (your step-3 verification harness):** `DEV_RECORD_REPLAY=1 yarn dev`,
> open `http://localhost:5173/?spike=1`, click **Start reply run** → it POSTs `/api/dev/runs`,
> writes the WorkItem id into the URL (`?spike=1&id=…`), renders the folded thread from the
> trace/SSE endpoints, and shows an Approve button at the gate. Reload re-attaches; Approve resumes.
> This is the dev surface the spec's anticipated-decisions block means by "the new spine drives
> lead-inbox through the spike's dev surface" — port the in-memory store in `dev-runs.ts` onto
> Postgres-backed Trace; keep the endpoint shapes + `seq` cursor + `foldEventsToMessages` as-is.
> **Preserve when porting:** the SSE handler closes only AFTER the terminal `done`/`error` status
> write flushes (else the UI strands on `running` — see the step-2 lesson above); replicate that in
> the real RunObserver's SSE. **Browser-verify gotcha hit this session (now in CLAUDE.md):** a stale
> Playwright-MCP Chrome holds the profile lock → `browser_navigate` errors "Browser is already in
> use"; kill `mcp-chrome-*` procs + remove the `SingletonLock` before driving the browser.

> **CONTINUATION NOTE (2026-06-10, after step 3) — for the step-4 agent.** Steps 1–3 stay on
> `feat/provider-contract-v2` (NOT merged — same branch strategy). Step 3 commits run
> `1012cd3`…`f4ac81c`. The spine is in `apps/inbox/server/pipeline/` (see the step-3 As-built
> above). **Drive it exactly as step 2:** `DEV_RECORD_REPLAY=1 yarn dev`, open
> `http://localhost:5173/?spike=1`, **Start reply run** → gate → **Approve** → `finished`. The
> dev resolve (`/api/dev/workitems/:id/resolve`) is what step 4's gate-keyed
> `/api/gates/:id/resolve` (formRev + ledger + execute + resume) replaces. **Two hard rules learned
> this session (don't relearn):** (1) pipeline tests run against `aiworkflow_test` (vitest
> `test.env` + `globalSetup`) — keep new DB tests there, NEVER truncate in `beforeEach` (clobbers
> parallel files); use unique uuids/sources + membership board asserts instead. (2) the startup
> sweep **re-enqueues `queued` rows on boot** → with stale rows + DEV_RECORD_REPLAY unset that
> spawns REAL `claude`; this is correct recovery behavior — keep the dev DB clean (`yarn workspace
inbox db:reset`) if leftovers accumulate. `client.ts` defaults `DATABASE_URL` to the compose
> creds; migrate-on-boot means a fresh clone + `yarn dev` just works. Verify gate the step ended on:
> 226 unit tests + typecheck/lint/format green + the 4 browser PASS criteria + durability
> (restart mid-`awaiting_approval` → gate survives).

(The "NEXT — docs/pipeline-plan.md" P1/P2/P3 items below are absorbed by the
server-authoritative model in updated-3 — keep for reference, do not build standalone.)

---

**On `master` (MERGED `45c5e1f`, BUILT, browser-verified):** **dev record/replay** — a
`Provider → Provider` decorator (`withRecordReplay`) toggled by `DEV_RECORD_REPLAY` that records
each real provider run to disk once and replays it instantly on every subsequent run. Recordings
are one JSONL file per `wf__agent` under `apps/inbox/.cassettes/` (gitignored), each line
`{step, event}`; the **step** is `resolvedApprovalCount(input)` (new pure helper in
`@platform/core`) — the number of human approvals already resolved, so HITL's multi-request
split is handled transparently. Mode toggle: `=1`/`=replay` → auto (replay if recorded, else
record); `=record` → force-overwrite; unset → pure production path. `CassetteStore` uses atomic
writes; a provider error does not write. `scanCassette` backs a mandatory agent share-safety scan
(now a hard rule in `CLAUDE.md`). The `buildAgent` wiring passes the `wf__agent` instance key as
the cassette key; the server is otherwise unchanged. Developer guide → `docs/dev-record-replay.md`;
spec → `docs/superpowers/specs/2026-06-08-dev-record-replay-design.md`; plan →
`docs/superpowers/plans/2026-06-08-dev-record-replay.md`; build narrative →
`docs/BUILD-LOG.md` §10.

### ✅ FIXED, MERGED & browser-verified — the two agent-instance bugs

Both bugs from the prior handoff are fixed and **merged to `master`** (commit `6d437ad`, merge
`14e06be`; working tree clean, pushed to `origin/master`), with **166 unit tests + typecheck +
lint green** and a full browser E2E pass. Nothing left to commit here.

- **✅ One-time deliveries spawned duplicate instances.** Clicking "Draft reply" 3× on ONE email spawned
  3 reply instances. Fix: a delivery now carries a `deliveryKey` derived from the source item
  (`deliveryKey(payload)` in `deliver.ts` — `thread:<id>` / `number:<n>` / `email:<from>|<subject>`),
  and `spawn` dedupes against live instances AND the queue (`liveDuplicate` in `instancesCore.ts`); a
  repeated delivery is a no-op (returns `{deduped:true}`, no duplicate note/badge). **Browser-verified:**
  3× Draft reply → exactly **1** reply instance (`1 active · 1 awaiting approval`).
- **✅ Second awaiting-approval instance's approve button was dead.** Root cause (source-verified in
  `@copilotkit`): one global `useHumanInTheLoop` holds ONE `resolvePromiseRef`; a second concurrent run
  overwrote the first's resolver. Fix: register HITL tools PER live instance under `agentId = localId`
  (`InstanceTools`, mounted one-per-instance) + wrap the open thread in
  `<CopilotChatConfigurationProvider agentId={localId}>` (`LiveInstanceModal` creates `useRenderToolCall`
  inside it). Render tools stay global; only HITL is per-instance. **Browser-verified with REAL runs**
  (`DEV_RECORD_REPLAY=record`, two distinct leads): both instances showed `status=executing respond=true`
  and **both** "Save draft" buttons fired `respond` → both resumed → both saved drafts → both torn down.
  Note: in `=replay` mode two instances share the cassette's `toolCallId`, which masks this as a false
  "second button dead" — a replay artifact (see CLAUDE.md); verify concurrent HITL with `=record`.

### ✅ FIXED — "cassettes don't work" was a stale-server collision

`DEV_RECORD_REPLAY` cassettes are correct; replay was being silently bypassed because a **stale dev
server held `:4000`**, so a freshly-started replay server hit `EADDRINUSE` (its `tsx watch` child
isn't matched by the `.bin/tsx` pkill pattern) and Vite kept proxying to the OLD server — which was
launched WITHOUT the env var → real `claude` every time. Fix: a **`predev`** script
(`apps/inbox/package.json`) frees `:4000`/`:5173` LISTEN sockets before every `yarn dev`, so the
fresh server always binds in the intended mode. **Verified:** a stale listener is killed and the new
server binds with 0 `EADDRINUSE`; a clean replay run completes in ~2s with the cassette mtime
unchanged (true replay, no real `claude`).

### 🧭 NEXT — `docs/pipeline-plan.md` (three more gaps, design-first)

Three issues surfaced this session are captured (with current model + options + open questions) in
the new **`docs/pipeline-plan.md`** — think the pipelines through there, then spin specifics into a
dated spec. Summary:

- **P1 (highest impact):** result-only worker instances (TRIAGE → FEATURE/BUG-FIX/REPLY-DRAFT)
  finalize `done` and are **torn down**, so their result card vanishes and the user can't act. The
  lifecycle has no "completed-with-a-result-to-show" state. Recommended fix anchor: a uniform RESULT
  lifecycle (`running → awaiting_approval | result | error → kept until dismissed`).
- **P2:** the green intro bubble shows even when idle — split `intro` (active) from `description`
  (idle type view); gate the running-intro on lifecycle.
- **P3:** a one-time action button (VerdictCard "Draft reply") stays active after use; dedup makes a
  re-click a no-op but the UI doesn't reflect it — reflect delivery state (by `deliveryKey`) on the card.

**On `master` (MERGED `5d13f3f`, BUILT, browser-verified):** **dynamic agent instances** — a
busy agent now spawns additional concurrent copies for new handed-off items instead of overwriting the
in-flight run. Each instance is a client-side **proxied agent** (`copilotkit.registerProxiedAgent`,
localId `wf__agent#<seq>`) created on demand, run, and `unregister`'d on finalize; the server is
unchanged (one agent per `wf__agent`). Concurrency is bounded per-agent by `defineAgent.maxInstances`
(default 2; `triage`+`qualifier` = 1); overflow waits in a per-agent queue that auto-drains on a freed
slot. The pipeline is rebuilt as an **instance tree** (`pipelineModel.buildPipeline`): repeated depth-2
`parent → [children grouped by agentId]` blocks — 1 instance = a single card, ≥2 = an agent header
(`N active`) + L-connected nested cards + a `queued: N` line; the right-grid "type" card shows the
aggregate (`N active · M awaiting approval`). Pure, unit-tested core: `instancesCore` (cap),
`statusFrom`, `aggregate`, `pipelineModel`; integration in `useAgentInstances` + `InboxView` +
`PipelineColumn` + `AgentCard`. **137 unit tests + typecheck/lint/prettier green.** **Browser-verified
E2E** on the real Magma board: routed 3 tickets at once → **2 active + `queued: 1`** (cap held against a
same-tick burst after a `synchronous instRef` fix), queue drained when a slot freed, single-instance
renders as one card, input agent kept, done workers torn down — **no page reload throughout**. Spec →
`docs/superpowers/specs/2026-06-08-agent-instances-design.md`; plan →
`docs/superpowers/plans/2026-06-08-agent-instances.md`; detail → `docs/BUILD-LOG.md` §9.
**Lesson logged (CLAUDE.md):** an "app reloads itself ~30s into a run" symptom was NOT a feature bug —
it was 5 stale dev stacks contending for `:5173` and tripping Vite's `vite:ws:disconnect → location.reload`
(the kill pattern in CLAUDE.md pointed at the wrong `node_modules` path; now fixed).
**Post-merge polish also landed & browser-verified:** idle agent cards open a type view (intro + START);
a handoff note carries an "Open <agent>" jump button; `awaiting_approval` instances are KEPT on finalize
(claude-cli HITL kills the process at the approval tool call — they must stay, not vanish); opening an
agent with ≥2 live instances shows an **instance picker** (cards, pick a copy) instead of one thread; the
pipeline parent→children connector is the prior centered `↓` with a bordered container over the children.
**Next for the following agent:** both 🐞 are now FIXED & merged (see the "✅ FIXED, MERGED"
section above) — the next thing to build is **beta build order step 1** (Provider contract v2),
not these bugs. Pre-existing cosmetic still open: the model sometimes narrates "Let me load the tool
schemas first" into the thread (deferred-polish list).

**On `master` (MERGED `8b67b83`, BUILT, browser-verified):** the **tool-result surfacing +
consumer-thread polish** pass. Root cause unified three symptoms: MCP tool RESULTS never
reached the client (`claude-stream` emitted only START/ARGS/END). Now the provider emits
`TOOL_CALL_RESULT` for surfaced tools, which (a) flips a tool chip Running→Done (the default
chip waits on a `toolMessage` that never arrived → stuck "Running") and (b) hands the data to
the client directly. On top: **dev mode** (`?dev=1`, persisted) — the consumer thread shows
ONLY generative-UI cards; internal data-fetch chips (`list_my_tickets`, `get_latest_email`)
are hidden unless dev mode is on (`AgentModal` filters by the registered render/HITL tool
names). **TRIAGE no longer couriers tickets through the model**: `render_triage` shrank to
`{origin, recommendations:[{number,route}]}` (tiny + fast); the TriageCard reads ticket DATA
from the surfaced `list_my_tickets` result via a `ThreadResultsContext`, merging the model's
route. Plus visual fixes: triage rows stack (title wraps, action buttons wrap, no overflow);
`ReplyDraftCard` uses the proper head/badge/kicker (label no longer overlaps the title); and
contiguous text deltas now share ONE `messageId` (AG-UI `TEXT_MESSAGE_CHUNK` opened a new
message per differing id → "Draf"/"ted a reply" split into two bubbles). 127 unit tests +
typecheck/lint/prettier green. **Browser-verified E2E** (real Magma board, real reply draft):
normal mode = clean cards (no `list_my_tickets` chip, no stuck Running); dev mode = the chip
shows and reads **Done**; triage card + reply card lay out correctly; the narration is one bubble.
**Next:** commit this, then pick from "Other next-ups" / "PLANNED NEXT" below.

**On `master` (MERGED `3a92241`, BUILT, browser-verified):** the **workflow-
separation** pass. Each workflow is now a **self-contained module** (`apps/inbox/workflows/<id>/`
descriptor+server+client) and workflows are **isolated boxes** that talk only through a typed
**published contract**. Highlights: `@platform/core` `defineWorkflow` + `instanceId` +
`Destination`; agent **roles `input`/`worker`** (input = user-startable + only cross-workflow target;
worker = handoff-only); **all agents of all workflows mounted idle** keyed by instance id (so the same
agent is reusable as independent copies and a cross-workflow target is always ready — no mount race);
one **`deliver`** seam that runs the target in the **background** with **no auto-open** and **no
auto-switch** (cross-workflow raises a tab **badge** + an "Open in <workflow>" button; the human
navigates); **origin-routed** handoff render tools so reused handoff-emitting agents route to the
right copy; a concrete demo — TRIAGE's "Treat as lead → Lead inbox" delivers a ticket to the
lead-inbox `lead` contract and the qualifier re-qualifies the handed lead. 120 unit tests +
typecheck/lint/prettier green. **Browser-verified E2E** (real Magma board read-only + real Gmail):
intra-handoff runs target w/ no auto-open; cross-workflow delivery → background run + badge + no
switch + Open-in; **state persists across workflow switches**. Detail → `docs/BUILD-LOG.md` §8;
spec → `docs/superpowers/specs/2026-06-08-workflow-separation-design.md`; plan →
`docs/superpowers/plans/2026-06-08-workflow-separation.md`.
**Next:** pick from "Other next-ups" / "PLANNED NEXT" below.

**Previously on `master` (MERGED, BUILT, browser-verified on the real board):** the **GitHub triage
workflow** — a second workflow beside the Lead inbox, built on the **real** Magma Board (GitHub
Projects v2, `matteappen` #8) via `gh`, **strictly read-only**. A **TRIAGE** agent (the only board
reader) lists the user's assigned tickets, buckets them by real Status + a "needs reply" flag,
and recommends a route; the manager routes one via the `handoff.ts` seam to **FEATURE /
BUG-FIX / REPLY-DRAFT**, which analyze/draft **purely from the handoff payload** (no GitHub access).
Detail → `docs/BUILD-LOG.md` §7; spec → `docs/superpowers/specs/2026-06-07-github-triage-workflow-design.md`;
plan → `docs/superpowers/plans/2026-06-07-github-triage-workflow.md`.

**Previously on `master` (MERGED `56c8454`, BUILT, browser-verified):** the **consumer desktop
re-skin** — Smedja design system on `apps/inbox/client`; flat two-card view → **two-panel desktop**
(left **Pipeline** column + right **Your agents** grid under the same thin `.comp-head`). Pipeline
shows only active agents (tinted, ↓-connected) and **keeps a handoff parent visible as Working
while its subagent runs**; reply is handoff-only. Detail → `docs/BUILD-LOG.md` §6.

**Recently built (deep dives → `docs/BUILD-LOG.md`):**

1. Vertical slice + reusable **`@platform/core`** layer (message layer, `Provider` contract,
   `defineAgent` passport). — §1
2. **`claude-cli` provider** — runs the real `claude` CLI as a subprocess behind the `Provider`
   seam; HITL = detect-tool-call-and-kill + stateless re-prime resume. — §2
3. **Gmail draft integration** — our own thin stdio Gmail MCP; reads latest email → draft reply on
   approval (never sends). — §3
4. **Two agents + manual handoff** (`56f07d0`) — LEAD QUALIFIER (only reader) → REPLY AGENT
   (writer); `handoff.ts` is the pure encode/decode seam; per-agent MCP allow-list = hard boundary. — §4
5. **`@platform/*` package split** — `core` + `providers` + `integrations` as yarn-classic
   workspace packages consumed as raw TS source. — §5
6. **Consumer desktop re-skin** (`56c8454`) — above. — §6
7. **GitHub triage workflow** (MERGED) — real read-only Magma Board, N-agent
   desktop + switcher. — §7
8. **Workflow separation** (`feat/workflow-separation`, browser-verified, unmerged) — self-contained
   workflow modules, `input`/`worker` roles, all-mounted-idle instance reuse, published-contract
   cross-workflow delivery, `deliver` seam with no auto-open/auto-switch. — §8
9. **Dynamic agent instances** (`feat/agent-instances`, browser-verified) — a busy agent spawns
   concurrent proxied copies (cap `maxInstances`, default 2; overflow queued), shown as a nested
   instance tree in the pipeline. — §9

## 🧭 PLANNED NEXT

- **Workflow-separation follow-ups it deferred** (all optional, nothing blocking): URL routing per
  workflow; per-workflow CopilotKit contexts (full render-tool isolation); Variant 2 type-matched
  contract discovery (source emits a typed parcel, system offers compatible workflows — no naming);
  a live demo reusing one agent across two workflows; clearing per-instance `handoffNotes` when an
  agent is re-seeded (cosmetic — a re-seeded agent still shows its prior "sent" note); show the
  workflow _label_ instead of the raw id in the "Open in" button / handoff notes.
- The GitHub data path is **real and read-only by construction**. A real-time refresh, broader
  scoping (beyond the single assignee), or Projects-v2 status writes are explicitly **out of scope**
  unless the read-only constraint is revisited (it is a hard rule — see CLAUDE.md / memory).

### Known issues / tech debt (GitHub triage)

- ✅ **FIXED (this session):** **`list_my_tickets` chip shows "Running" forever.** Root cause: the
  provider never surfaced tool RESULTS, so the default chip's `toolMessage` never arrived. Now
  `claude-stream` emits `TOOL_CALL_RESULT` → chip flips to Done. In normal mode the chip is hidden
  entirely (only cards show); dev mode (`?dev=1`) shows it, now correctly Done.
- ✅ **FIXED (this session):** **TRIAGE couriered every ticket through `render_triage`.** The robust
  fix landed: the client reads the `list_my_tickets` RESULT (now surfaced) via `ThreadResultsContext`,
  and `render_triage` carries only `{origin, recommendations}`. The model no longer re-emits ticket
  text → no latency/timeout scaling wall. The `MAX_TICKETS`/trim knobs now only bound the streamed
  result payload, not model latency.

## Other next-ups (suggested order)

1. **Finish the split — `@platform/react` + `@platform/server` extraction (deferred):** the
   client React layer and the Hono/BFF + spawn server layer still live in `apps/inbox/`. Extract
   when the app/framework boundary settles. The `@platform/*` scope is a **placeholder** — rename
   before any npm publish.
2. **Multi-provider / Mastra** (can interleave): add a `mastra` (or `claude-api`) factory beside
   `claude-cli` behind the existing `Provider` seam in `@platform/providers` — no seam change
   needed. Needs an API key.
3. _Polish (cosmetic, deferred):_ the model still narrates a bit ("I'll load the tool schemas…")
   AND the verdict prints as plain markdown paragraphs in the modal alongside the card — strip
   pre-tool / duplicate chatter client-side or via prompt. Tighten Gmail scope
   `gmail.modify`→`readonly`+`compose`.
