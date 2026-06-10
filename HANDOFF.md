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
3. **Server spine on Postgres**: StateStore (drizzle-kit + `schema_version`), dispatch chokepoint, `transition()` API with guards, WorkerPool, board SSE.
   - `docker-compose.yml` with a `postgres` service only; `DATABASE_URL` in `.env.local`; extend `predev` to start the container if it isn't running.
   - Drizzle schema (`work_items`, `gates`, `trace` PK `(work_item_id, seq)`, `action_ledger` PK `key`) + drizzle-kit migrations from the very first table (spec §1.7).
   - ONE `transition(workItemId, edge)` function owns every status change: `BEGIN` → `SELECT … FOR UPDATE` on the row (and the parent for finish/reopen, ascending-id lock order) → guard check → `UPDATE` → `COMMIT`. The `finished` entry guard lives HERE, once, for all five inbound edges (spec §1.2).
   - ONE `dispatch()` chokepoint mints the WorkItem id, checks one-time dedup (ledger/approved children only) + depth cap, enqueues. WorkerPool ports the pure logic from `apps/inbox/client/src/instancesCore.ts` (cap + queue, already unit-tested) — port, don't redesign.
   - RunObserver (from the spike, now real): consume `provider.run()`, append trace rows, GATE_OPENED → insert Gate + `transition(awaiting_approval)` + kill via provider; registered render tool → fill `card`; stream end → finalize status.
   - Race tests run against REAL Postgres (the compose container) in CI: concurrent finish-vs-finish and finish-vs-dispatch.
4. **Server-executed effects + Stop** (+ sweep, guards, Gate fields).
   - `defineAgent` gains `effects: string[]` (zod: `approvals ∩ effects = ∅`). Effect tools are REMOVED from the model's `allowedTools` (today `mcp__gmail__create_draft` leaks in at `apps/inbox/workflows/lead-inbox/server.ts`); the model only proposes the artifact in the approval-tool args.
   - `POST /api/gates/:id/resolve` body carries `{ formRev, decision, form }`: tx① check formRev (mismatch → 409) + mark resolved + INSERT `action_ledger` claim (key = `workItemId+gateId`); execute the integration call directly (`@platform/integrations/gmail-basic` createDraft — plain function call, no MCP child needed); tx② record the result; then `provider.resume()` primed with "the action was executed with <artifact>" (narrative only).
   - Cancel: `POST /api/workitems/:id/cancel` → `transition(cancelled)` + kill the executor handle + cascade to active children (ascending id); workflow-level cancel = same loop over the workflow's active items. Reuses the existing HITL kill path.
   - Startup sweep (before `listen`): `running` w/o live executor → `error('executor lost')`; `queued` → re-enqueue by `createdAt`.
   - Gate columns: `form_rev int`, `proposed_artifact jsonb` (keep BOTH versions), `comment text`, `assignee text null`, `expires_at timestamptz null` (no default, badge-only). Rewrite `reply.prompts.ts`: propose-don't-execute.
5. **Mastra provider** (production path) beside claude-cli (dev); re-key record/replay.
   - New `packages/providers/src/mastra-provider.ts`; needs `ANTHROPIC_API_KEY` (ask the user NOW, not before). Mastra emits AG-UI natively — `run()` is mostly passthrough; GATE_OPENED derives from the workflow suspend status (not a tool call); `resume()` = native `resume(runId, resumeData)`, NO kill-and-re-prime.
   - Keep a `workItemId ↔ runId` mapping in StateStore; do NOT store Mastra's step state (belief #2 boundary, spec §1.4).
   - Run the step-1 conformance suite against it — that's the two-unlike-providers proof.
   - record/replay: cassette step key changes from `resolvedApprovalCount(input)` (message scan) to the store's resolved-gate count; wipe `.cassettes/` once (gitignored fixtures).
6. **Re-point board/thread UI** to server state; delete `@copilotkit/*` deps.
   - Board reads `GET /api/board` `{items, gates, lastEventId}` + per-account SSE (coarse status events only, resume via `Last-Event-ID`); thread = step-2 trace endpoints. Keep `renderRegistry`, all cards, Smedja styles, `?dev=1`.
   - Approve/reject/cancel/edit = plain HTTP. DELETE (not port): `useAgentInstances`, `instancesCore` client copy, `statusFrom`, proxied agents, `useHumanInTheLoop`, `<CopilotKit>` tree.
   - Browser E2E checklist before merge (memory rule — EVERY flow): single run; 3-at-once (cap 2 + `queued: 1`); approve WITH an edited artifact (verify the edited text is what lands in Gmail); reject + re-run; cancel mid-run; reload mid-run; second tab coherence.
7. **Packaging**: zero-cred demo (`DEMO=1` → mock provider + SYNTHETIC cassettes authored fresh, scanCassette gate in CI), README 10-minute script, LICENSE (MIT vs Apache-2.0 — ask the user), `@platform/*` scope rename, golden-set eval per workflow, shared bearer token on all mutation routes (honest `resolvedBy`).

**Anticipated decisions, steps 3–7 (ANSWERED 2026-06-10 — decide-and-go, do not re-ask the user):**

- **Coexistence model for steps 3–5 (the big one):** the new pipeline is built BESIDE the old
  CopilotKit path, not into it. During steps 3–5 the new spine drives the lead-inbox flow through
  the spike's dev surface (dev page + trace/SSE endpoints); the old board stays untouched and
  working. The swap happens once, at step 6. Never half-migrate the old board mid-step, and do
  NOT write an old↔new adapter beyond what step 1 already shipped.
- **Code layout:** pipeline code lives in `apps/inbox/server/pipeline/` (PipelineService,
  StateStore, RunObserver, WorkerPool, transition, dispatch). Do NOT create `@platform/server` —
  package extraction is explicitly deferred until the boundary settles (ARCHITECTURE §9).
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

**Starting point for the next session = beta build order step 3** (Server spine on Postgres:
StateStore via drizzle-kit + `schema_version`, the `dispatch()` chokepoint, `transition()` with
guards, WorkerPool ported from `instancesCore.ts`, board SSE; the spike's RunObserver becomes
real — append Trace rows, GATE_OPENED → insert Gate + `transition(awaiting_approval)` + kill,
finalize on stream end). Steps 1 & 2 are ✅ BUILT & browser-verified on `feat/provider-contract-v2`.
Step 2 gives you the durable pieces to build ON: `foldEventsToMessages` (`@platform/core`), the
`/api/workitems/:id/{trace,stream}` endpoint shapes, and the per-WorkItem `seq` cursor — port the
in-memory RunObserver/store (`apps/inbox/server/dev-runs.ts`) onto Postgres rather than redesign.
`docker compose up -d postgres` is already wired into `predev` (DB up; step 3 is the first to use
it). Do NOT invest further in the `@copilotkit/*` client layer — it stays the dev surface until
step 6; the new work targets the server-authoritative spine and drives lead-inbox through the
spike's dev page + trace/SSE endpoints.

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
