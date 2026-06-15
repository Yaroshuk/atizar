# Handoff — where we are & what's next

Living session state: **current status + the next thing to build**. Changes every session.
For stable project context (conventions, gotchas, decisions, commands) see `CLAUDE.md`; for the
full chronological build history see `docs/BUILD-LOG.md`.

## ⏭️ NEXT (start here — fresh session, 2026-06-14) — Re-run + trust/UX + library boundary (7 work-streams)

**Re-run semantics + trust/UX + library-boundary cleanup — 7 work-streams.** Spec (ALL decisions
LOCKED, foundation-checked CLEAR): `docs/superpowers/specs/2026-06-14-rerun-and-trust-ux-design.md`.
Background analysis: `docs/superpowers/specs/2026-06-14-workflow-rerun-semantics-BRIEF.md` + the
ATIZAR Notion page "Повторный запуск воркфлоу — сравнительный анализ". Authored while context was
fresh — **your job is to IMPLEMENT, not to re-decide.** WS1–WS7 numbers below refer to THIS spec.

**You run this AUTONOMOUSLY via subagents.** The user hands the session off and is away. Decisions
are made (the spec); if one turns out wrong mid-build, note it, pick the obvious fix, keep going.
Per work-stream: read its plan → `superpowers:subagent-driven-development` (a fresh implementer
subagent per task + a spec/quality review between tasks; `executing-plans` for inline batches) →
green gate → **browser-verify** → merge to `master` → update this block → next WS.

**▶ RUN PROGRESS (autonomous run, 2026-06-14) — remaining order: WS7 (last). 6 of 7 done.**
Baseline before the run: `chore(format)` commit `c18c781` cleaned 17 pre-existing prettier violations
so the per-WS `format:check` gate is meaningful (typecheck/test 454/lint were already green).

- **WS4 — ✅ DONE & merged** (`master` after merge: `71aecb0`). Operator Activity feed flipped to
  newest-at-top with top-pinned auto-follow + a "Newest first" cue; the dev Trace grouped view keeps
  its chronological `#1..#n` order (grouping iterates the un-reversed list). Pure presentation change
  in `packages/react/src/components/ActivityPanel/` (+ a render test). Green gate all green (typecheck
  / test 456 / lint / format / `@atizar/react` build with `.act-feed-cue` in `dist/react.css`).
  Browser-verified 6/6 steps PASS (cue present, newest-at-top holds live + across reload, scroll-down
  pauses auto-follow & scroll-up resumes, Trace `#1..#n` unchanged, 0 related console errors).
- **WS3 — ✅ DONE & merged** (`master` after merge: `d64966f`). Constrained `<Markdown>` primitive
  (react-markdown + remark-gfm, `skipHtml` + safe element allow-list, NO raw HTML / no rehype-raw /
  no dangerouslySetInnerHTML; links hardened `target=_blank rel=noopener noreferrer`; protocol-relative
  `//` URLs dropped — a phishing-vector fix surfaced in review) renders the assistant bubble + 5 card
  free-text fields; agent prompts tightened so bubbles are short plain sentences, not markdown
  restatements of card chips. Green gate green (typecheck / test 467 / lint / format / `@atizar/react`
  build). Browser-verified in the real bundle: `**bold**`→`<strong>`, lists→`<li>`, safe link hardened,
  protocol-relative link neutralized (empty href), 0 console errors; test cassette restored after.
- **WS5 — ✅ DONE & merged** (`master` after merge: `81febc9`). SourcePanel primitive (untrusted
  source rendered INERT — plain text, no markdown/HTML — beside the editable draft, labeled
  "Untrusted external content", hiding `origin`/`threadId` plumbing keys); incoming user-turn shown in
  the thread; SSE reconnect state on `useWorkItemThread` + `useBoard` with "Reconnecting…" chips
  (thread + board header); append-only durable `audit_log` table (migration `0002`) written on
  resolve/effect/reject, stamped with the resolver actor (`'shared-token'` under bearer, else null),
  surviving restart. Green gate green (typecheck / test 479 / lint / format / `@atizar/react` build).
  Browser-verified: P1 SourcePanel+user-turn+edit-approve at a real gate (edited body landed), P2 board
  "Reconnecting…" chip captured on SSE drop, P3 audit rows persisted across a server restart.
  ⚠ **Two user action items surfaced in browser-verify (do NOT block the track — the whole run is on
  `DEV_RECORD_REPLAY=1`):** (1) delete the test Gmail **draft** `r7666524379648912752` (thread
  `19ebbf9875f60e8c`, body contains `WS5-EDIT-MARK`) from the Drafts folder; (2) the Gmail **OAuth
  refresh token is EXPIRED** (`invalid_grant`) — a live (non-replay) Gmail demo needs re-auth.
- **WS2 — ✅ DONE & merged** (`master` after merge: `f51a060`). Client render/HITL registry now scoped
  by `(workflowId, toolName)`: `RenderSpec`/`HitlSpec` carry `workflowId`; pure `byWorkflow` +
  `renderableNamesFor` helpers in `@atizar/react`; `ThreadModal`/`BoardInner` resolve scoped to the
  active workflow; the aggregator stamps each workflow's specs + dedups WITHIN a workflow (the global
  `byName` drop is gone, so a reused agent keeps its own copy per workflow). `@atizar/react` stays
  workflow-agnostic (I5 — grep of the package src for workflow ids/card names is comments/tests only).
  Optional Task 7 done (typed `LEAD_INBOX_TOOLS as const`). Green gate green (typecheck / test 488 /
  lint / format / `@atizar/react` build). **check-foundation: CLEAR** (I5 strengthened, I7/I15 intact).
  Browser-verified PASS: all four workflows render their cards (VerdictCard+ApprovalDialog, TriageCard,
  SortSummaryCard), 0 render-collision warnings, reload re-resolves the card.
- **WS6 — ✅ DONE & merged** (`master` after merge: `3429320`). Killed magic strings: `@atizar/providers`
  exports `PROVIDERS` (typed const + `ProviderId` union — `as const`, NOT a TS enum; value stays the
  wire string, I7); the server registry keys off `PROVIDERS.*`; each workflow gained a `tools.ts`
  (`*_TOOLS as const`) + `cards.ts` (`*_CARDS as const`), and descriptors/client specs reference
  `t.*`/`c.*` instead of raw literals. `@atizar/core` stays provider-agnostic (`provider: z.string()`,
  no `@atizar/providers` import — I3/I5). Optional Task 6 (defineAgent generic) NOT done — the
  implementer subagent hit a 401 auth failure after committing Tasks 1-5 (a long-session token
  expiry, not a code problem); Task 6 is explicitly optional with a revert decision-gate, so it's
  cleanly skipped. Green gate green (typecheck / test 504 / lint / format / `yarn build`). Acceptance
  greps clean (no `provider:'claude-cli'` literal; no TS enum; core doesn't import providers).
  check-foundation CLEAR (I7/I3/I5). Boot smoke PASS (server boots, `/api/board` 200, 0 provider errors).
  ⚠ **Subagent auth note:** one implementer subagent died on `401 Invalid authentication credentials`
  ("run /login") after a ~6h hang — the macOS-keychain subscription token expired during a long pause.
  The MAIN loop's auth is fine (all my own calls work). If subagents keep 401-ing, re-auth may be
  needed; the run continues regardless (I verify directly when needed).
- **WS1 — ✅ DONE & merged** (`master` after merge: `fdcfe76`) — THE headline feature. A human re-START
  of an input agent now **supersedes** the prior finished scan root (status `closed`, resolution
  `superseded`, via a new `transition()` edge — I8) and mints the single new current root; the prior
  root drops out of the live Pipeline column but is **preserved** in Activity ("superseded by re-run"
  — I12, never destroyed, no child cascade). Dispatch dedup is scoped to OPEN items (a re-scan
  re-surfaces an un-actioned source; the `workItemId+gateId` effect ledger stays the double-action
  guard — I9). The "Working" mislabel is fixed (`pipelineModel.view()` relabels a parent to running
  only with a LIVE descendant). A `rerun: 'refresh' | 'history'` knob is declared on `WorkflowDescriptor`
  (I7); only `'refresh'` is wired (all 3 inputs declare it); `'history'` is a reserved commented branch
  point (spec §5 out-of-scope). Green gate green (typecheck / test 522 / lint / format / `@atizar/react`
  build). **check-foundation: CLEAR** (I8/I12/I1/I9/I7 all intact). Review Approved after one fix
  (narrowed the supersede `.catch` to `IllegalTransition` so a real DB error re-throws instead of
  silently leaving two roots). Browser-verified PASS: two sequential STARTs of email-inbox/github-triage/
  lead-inbox each leave exactly ONE live row labeled correctly (Done when finished, never finished-
  showing-Working); "superseded by re-run" Activity entries present (DB-confirmed closed/superseded);
  0 WS1 console errors.
  ⚠ **UX gap noted (NOT a WS1 regression — future track):** when an input agent has an `error` item,
  `aggregate.ts` counts `error` as active so `aggregateLabel` is non-empty, which HIDES the START
  button on the agent card (re-run still works via the thread panel / API). WS1's spec only covers
  re-run of a _finished_ root, so the error→re-run START-button path is out of scope here — worth a
  small follow-up (e.g. allow START when the only "active" item is an `error`).

**Plans (one per WS, TDD bite-sized, in `docs/superpowers/plans/`):**

- WS1 re-run semantics (refresh/supersede + open-scoped dedup + Working-label fix + `rerun` knob) → `2026-06-14-ws1-rerun-semantics.md` — ✅ **DONE & merged** (`fdcfe76`)
- WS2 render/HITL registry scoping per workflow → `2026-06-14-ws2-render-hitl-registry-scoping.md` — ✅ **DONE & merged** (`f51a060`)
- WS3 markdown rendering (+ prompt tightening) → `2026-06-14-ws3-markdown-rendering.md` — ✅ **DONE & merged** (`d64966f`)
- WS4 activity monitor newest-first → `2026-06-14-ws4-activity-newest-first.md` — ✅ **DONE & merged** (`71aecb0`)
- WS5 SourcePanel + trust hardening (user-turn, SSE reconnect, durable audit) → `2026-06-14-ws5-sourcepanel-trust-hardening.md` — ✅ **DONE & merged** (`81febc9`)
- WS6 type-safe declaration (kill magic strings; `PROVIDERS` from the library) → `2026-06-14-ws6-typed-declaration.md` — ✅ **DONE & merged** (`3429320`)
- WS7 app→library boundary migration → `2026-06-14-ws7-app-to-library-migration.md`

**Order (spec §3):** WS4 → WS3 → WS5 → WS2 → WS6 → WS1 → WS7. (Small/independent first; **WS2 before
WS6**; **WS7 last** so it relocates server code that WS1/WS5 already settled.) Mostly independent — if
you prefer WS1 first (the original ask), fine, but keep WS2-before-WS6 and WS7-last.

**Per-WS execution rules:**

- One branch off `master` per WS; **subagents must NOT switch branches** (read history via `git show <sha>:path`).
- TDD (`superpowers:test-driven-development`): failing test → implement → green, per unit.
- Green gate before "done": `yarn typecheck && yarn test && yarn lint && yarn format:check`
  (+ `yarn workspace @atizar/react build` for any `@atizar/react` change). From repo root.
- **Browser-verify EVERY user-visible flow** (this codebase's bugs are browser-only — use the
  `browser-verify` skill + `DEV_RECORD_REPLAY=1`). Esp.: WS1 = two sequential STARTs leave ONE input
  row labeled right (Working while running / Done when finished); WS5 = the full HITL approval flow
  with the SourcePanel visible.
- **Merge to `master` directly (no PR — beta), delete the branch, update this block.**
- **Foundation guard-rails (spec §0) are BINDING** for WS1/WS2/WS6/WS7 — run `check-foundation` if a
  change feels like it touches a belief/invariant; do NOT erode I8/I12/I1/I5/I7/I3. Key traps: WS1
  supersede = preserve-to-history (NEVER destroy) + all status via `transition()` + no empty-no-op;
  WS6 = typed const/union, NEVER a TS `enum`; WS7 = nothing Node/engine-bound into `@atizar/core`.
- Read `CLAUDE.md` "Don't-rediscover gotchas" first (SSE lifecycle / `useBoard` singleton /
  `camelCaseOnly` / stale-dev-server + Playwright recovery).

**Out of scope (spec §5):** the `'history'` rerun mode (only the branch point is declared);
model-level injection classifier; the "Revise/re-propose" gate edge + `MAX_GATES` loop guard (both
noted as future tracks from the 2026-06-13 architecture analysis — do NOT build here unless trivial).

---

### ✅ ARCHIVED — frontend overhaul (WS1–WS3): DONE & merged 2026-06-14

**Frontend overhaul — 3 workstreams.** Spec (decisions locked):
`docs/superpowers/specs/2026-06-14-frontend-overhaul-design.md`. The prior session finished the
`@atizar/react` block decomposition + CSS-module migration + Vite lib build + an SSE-lifecycle
bug-fix, merged all to `master`, and authored this spec while context was fresh. Your job: turn each
workstream into a plan and execute it.

- **WS1 — Conventions + structure: ✅ DONE & browser-verified** (2026-06-14, merged to `master`,
  branch deleted). Plan → `docs/superpowers/plans/2026-06-14-ws1-conventions-structure.md`;
  `check-foundation` = CLEAR. As-built: added the "Component file & folder structure" section to
  `docs/CONVENTIONS.md` (one-component-per-file incl. private wrappers, folder-per-component, CSS
  Modules incl. `apps/`); split `BoardApp.tsx` → `BoardApp/BoardApp.tsx` (wrapper) +
  `BoardApp/BoardInner.tsx` (the former private `Inner`, verbatim body); folderized ALL
  `@atizar/react` components (13) + primitives (9) from flat `Name.tsx`+`Name.module.scss` →
  `Name/Name.tsx`+`Name/Name.module.scss` (4 commits: primitives + 3 component batches), repointing
  the `src/index.ts` barrel + every importer (`.js` ESM specifiers; depth `../` gotcha). Build entry
  (`src/index.ts`) + dts/tsconfig/vitest globs are recursive so no config change needed.
  Green gate all pass (typecheck / test 446 / lint / format / `@atizar/react` build); browser-verified
  the board + a thread render FULLY styled (hashed module classes resolve, status pills/dots colored,
  text not split, 0 console errors). Userland-card `.module.scss` migration deferred to WS3 (per spec).
- **WS2 — Connections: ✅ DONE & browser-verified** (2026-06-14, merged to `master`, branch deleted).
  Plan → `docs/superpowers/plans/2026-06-14-ws2-connections.md`; `check-foundation` (descriptor
  contract) = CLEAR (realizes I7 config-as-data; type in core, OAuth wiring in server). As-built:
  (2a) added `WorkflowConnection` type + optional `connections?: WorkflowConnection[]` to
  `WorkflowDescriptor` in `@atizar/core`; lead-inbox + email-inbox declare
  `[{integration:'gmail',provider:'google'}]`, github-triage none; `apps/inbox/server/connections.ts`
  now exports a pure `deriveConnectionList(descriptors)` (union + default `connection:'default'` +
  dedupe by `(integration,connection)`) and sets `connectionList = deriveConnectionList(workflowDescriptors)`
  — stale/extra chips now impossible (`scopesFor` unchanged). (2b) reshaped `Connections` into ONE
  compact trigger (a new `link` Icon + summary status dot: teal=all-connected / amber=any-disconnected,
  - count when >1) that toggles a popover (`position:absolute`, z-index 40) listing one `ConnectionChip`
    per row; dismisses on outside-click + Escape. `AppHeader`/`useConnections`/connect-routes untouched.
    Green gate all pass (typecheck / test 451 / lint / format / build); browser-verified live:
    `/api/connections` returns the derived gmail row, the compact control + popover render & dismiss,
    green connected dot, 0 console errors, header width constant.
- **WS3 — Card redesign: ✅ DONE & browser-verified** (2026-06-14, merged to `master`, branch deleted).
  Plan → `docs/superpowers/plans/2026-06-14-ws3-card-redesign.md`. As-built: added a `CardShell`
  primitive to `@atizar/react` (`primitives/CardShell/` — shared frame: icon-badge + kicker/title
  header, body, aligned actions zone; `tone="attention"` = amber approval look, default = neutral
  card; unifies the old `.lead-card` + `.approval` frames). Rebuilt ALL 8 userland cards on CardShell,
  each now folder-per-component with a co-located `.module.scss` (`--atz-*` tokens only): ApprovalDialog
  (editable textarea preserved — edited-text→Gmail path intact), ReplyDraftCard, EmailBatchCard
  (per-row `<select>` → trailing IconButton cluster trash/mark-read/star/keep with `aria-pressed`
  single-select; added `trash`+`star` glyphs to Icon), TriageCard (stacked full-width buttons → ONE
  aligned action row per ticket, primary-vs-ghost hierarchy; added the missing `.pill.amber` rule),
  LeadCard/VerdictCard/SortSummaryCard/TicketResultCard. Removed the migrated `.approval*`/`.lead-*`/
  `.triage-*` families from the package `styles.css` (−375 lines, grep-guarded; kept shared
  `.btn*`/`.pill*`/`.status*`/`.dot*` which chrome uses). Card Props + render-spec wiring unchanged.
  Green gate all pass (typecheck / test 454 / lint / format / `@atizar/react` build); browser-verified
  (`DEV_RECORD_REPLAY=1`): TriageCard/VerdictCard/LeadCard/ApprovalDialog/EmailBatchCard/SortSummaryCard
  all render styled on CardShell, 0 console errors; **ApprovalDialog edit→approve → real Gmail draft**
  (resolved gate `form.body` has the edit marker, action ledger `ok=true` + draftId); EmailBatchCard
  per-row icon single-select verified (didn't Apply — avoids real inbox mutation). (ReplyDraftCard +
  TicketResultCard not individually screenshotted — render-only, same verified CardShell+`.reason`
  pattern.)

**🎉 All three frontend-overhaul workstreams are DONE & merged to `master`.** The spec
(`docs/superpowers/specs/2026-06-14-frontend-overhaul-design.md`) definition-of-done is met:
conventions written + codebase conforms; `connectionList` auto-derived; one compact connections
control; all in-thread cards redesigned on a shared `CardShell`; package `styles.css` free of
userland-card CSS. **Next session: pick up the packaging tail (step 7c) / email-inbox track per the
sections below.**

**How to run it (the user's instruction):** work autonomously, orchestrating subagents. Per workstream:
`writing-plans` → `subagent-driven-development` (fresh implementer per task + spec/quality review) →
**browser-verify** (DEV_RECORD_REPLAY=1 + cassettes — this codebase's bugs are browser-only) → green
gate (`yarn typecheck && yarn test && yarn lint && yarn format:check && yarn workspace @atizar/react build`)
→ **merge to `master` directly (no PR — beta)**, delete the branch, update this NEXT block. Run
`check-foundation` for WS1 (convention) + WS2a (descriptor contract); expected CLEAR. Read the spec's
"Execution rules" + `CLAUDE.md` gotchas (SSE / `useBoard` singleton / `camelCaseOnly`) first.

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
   - **As-built:** `@atizar/core` gained `gate.ts` (`GATE_OPENED` CUSTOM-event helpers + zod `GateOpenedValueSchema`), `Provider.resume?` + `ResumeHandle`/`GateResolution` in `providers.ts`, and `conformance.ts` (`providerConformanceChecks` — 4 invariants). `claude-stream` emits `GATE_OPENED` at both approval suspend points; `claude-cli` + `mock` implement `resume()` and pass conformance. **The new run-envelope type was NOT added** — the additive surface keeps `RunAgentInput` (the `{workItemId,source,payload,origin}` envelope belongs to the dispatch chokepoint, step 3, not this contract). record/replay untouched (per answer (5)).
   - Where: `packages/core/src/providers.ts`. Keep `run(input) → AsyncIterable<BaseEvent>` untouched; add optional `resume?(handle, resolution) → AsyncIterable<BaseEvent>` (spec §1.4). [run-envelope: deferred to step 3 dispatch — see As-built.]
   - `GATE_OPENED` = an AG-UI `CUSTOM` event (typed helper in core). claude-cli synthesizes it inside `claude-stream.ts` exactly where approval-tool-call detection lives today; the orchestrator must listen ONLY for this signal, never for tool names.
   - Conformance suite = one vitest file parameterized over providers (mock now; claude-cli via the already-injected fake `spawn`): asserts stream shape, GATE_OPENED at the approval point, resume continues with the verbatim artifact. Mastra joins the same suite at step 5.
   - Don't break the running app: the current CopilotKit path keeps working until step 6 — add an adapter from the old `RunAgentInput` to the new envelope rather than rewiring the server now.
   - **Step-1 design decisions (ANSWERED 2026-06-10 — do not re-ask):**
     (1) Coexistence = **additive**: `run()` stays backward-compatible (still detects resume via messages), `resume()`/`GATE_OPENED` added beside it; `resume()` has no prod caller until step 3 — the conformance suite covers it.
     (2) `GATE_OPENED` = **AG-UI CUSTOM event** with a zod-typed value in `@atizar/core`. Value = `{ gateKind, toolName, toolCallId, proposedArtifact }` — **NO `resumeHandle` inside the event**: events get recorded into cassettes (and the Trace table at step 3), so they must stay light and must not duplicate the transcript. The caller of `run()` already owns everything the handle needs — it mints and holds the handle itself.
     (3) `resume?(handle, resolution)` with `ResumeHandle = { runId, input }` is right for step 1 (opaque-token abstraction deferred until a provider needs it). Two notes: (a) full transcript-seeded resume (§3.1) arrives only at step 3 when Trace exists — until then claude-cli's resume re-primes from input + resolution exactly like today's mechanism, extracted into a shared helper; (b) make the resume PROMPT TEXT a parameter of that helper, not hardcoded "human approved" — at step 4 it changes to "the action was already executed by the server with <artifact>" (server-executed effects), and `GateResolution` will gain an optional `executedResult?` field then.
     (4) Conformance suite = provider-agnostic `runProviderConformance(makeProvider)` against claude-cli (fake spawn) + mock now, Mastra slot at step 5. Invariants as proposed (GATE_OPENED on approval tool; resume(approved) completes without re-gating; resume(rejected) terminates; surface filtering; one messageId per contiguous text).
     (5) record/replay **untouched at step 1** (keep `resolvedApprovalCount` keying; old cassettes simply lack GATE_OPENED, which is backward-tolerant). Re-key + wipe happens at step 5 with the envelope change.
2. **Week-0 spike: RunObserver + browser attach** — ✅ **BUILT & browser-verified** on `feat/provider-contract-v2` (2026-06-10). 200 unit tests + typecheck/lint/format green; all 4 PASS criteria verified in the browser on the `lead-inbox__reply` cassette (`DEV_RECORD_REPLAY=1`, true replay — cassette mtime unchanged). Spec → `docs/superpowers/specs/2026-06-10-runobserver-browser-attach-spike-design.md`; plan → `docs/superpowers/plans/2026-06-10-runobserver-browser-attach-spike.md`.
   - **As-built — what SURVIVES into steps 3/6:** (1) **`foldEventsToMessages`** in `@atizar/core` (`packages/core/src/fold.ts`) — pure left-fold of AG-UI events → `Message[]` (the reduction CopilotKit did internally); the client pairs results with the existing `pairToolResults`. (2) The **read endpoint shapes**: `GET /api/workitems/:id/trace?from=seq` → `{id,status,done,nextSeq,events:[{seq,event}]}` and `GET /api/workitems/:id/stream` (SSE, `id:`=seq, `data:`=AG-UI event, named `event: status` on status change, honors `Last-Event-ID`). (3) The per-WorkItem monotonic `seq` cursor; the client orders/dedupes by `seq` (so duplicate/out-of-order SSE on reconnect is harmless — the server makes no ordering guarantee between backlog and live).
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
   - **For the step-4 agent:** the gate-keyed `POST /api/gates/:id/resolve` (formRev 409 + `action_ledger` claim + execute `@atizar/integrations/gmail-basic` createDraft directly + `resume` primed with "executed with <artifact>") replaces the dev `/api/dev/workitems/:id/resolve`; `GateResolution` gains `executedResult?`; cancel edges + the full all-inbound-edges guard table extend `transition.ts`; the effect tool leaves the model allow-list (`apps/inbox/workflows/lead-inbox/server.ts`) and `reply.prompts.ts` becomes propose-don't-execute. The `transition()` guard mechanism + `action_ledger` table + `form_rev` column already exist.
   - `docker-compose.yml` with a `postgres` service only; `DATABASE_URL` in `.env.local`; extend `predev` to start the container if it isn't running.
   - Drizzle schema (`work_items`, `gates`, `trace` PK `(work_item_id, seq)`, `action_ledger` PK `key`) + drizzle-kit migrations from the very first table (spec §1.7).
   - ONE `transition(workItemId, edge)` function owns every status change: `BEGIN` → `SELECT … FOR UPDATE` on the row (and the parent for finish/reopen, ascending-id lock order) → guard check → `UPDATE` → `COMMIT`. The `finished` entry guard lives HERE, once, for all five inbound edges (spec §1.2).
   - ONE `dispatch()` chokepoint mints the WorkItem id, checks one-time dedup (ledger/approved children only) + depth cap, enqueues. WorkerPool ports the pure logic from `apps/inbox/client/src/instancesCore.ts` (cap + queue, already unit-tested) — port, don't redesign.
   - RunObserver (from the spike, now real): consume `provider.run()`, append trace rows, GATE_OPENED → insert Gate + `transition(awaiting_approval)` + kill via provider; registered render tool → fill `card`; stream end → finalize status.
   - Race tests run against REAL Postgres (the compose container) in CI: concurrent finish-vs-finish and finish-vs-dispatch.
4. **Server-executed effects + Stop** — ✅ **BUILT & browser-verified** on `feat/provider-contract-v2` (2026-06-10). 248 unit tests (incl. real-PG: ledger one-execution, formRev 409, cancel/reject edges, failing-effect→error) + typecheck/lint/format green; all 6 browser/runtime E2E flows verified (below). Spec → `docs/superpowers/specs/2026-06-10-server-executed-effects-stop-design.md`; plan → `docs/superpowers/plans/2026-06-10-server-executed-effects-stop.md`. Commits `43611b6`…`1ab2b0a` (incl. fixes: `e300153` qualifier-tools surfacing, `4b24bb5` cancelItem terminal guard, the double-release + failing-effect fix, and prettier).
   - **As-built — contract:** `@atizar/core` `defineAgent` gained `effects: string[]` (zod **`effects ⊆ approvals`**) + `readonly: string[]`; `GateResolution.executedResult?` + `PromptStrategy.buildResume(args, executedResult?)`. `ServerBinding.effects: { [approvalTool]: (form, ctx) => Promise<result> }` (functions in the server layer, names in core — the `renders` pattern); `EffectFn` type in `server-binding.ts`. **Boot checks** (`apps/inbox/server/agent-checks.ts`, wired in `index.ts`): (1) effect bindings ⇔ `def.effects` both ways; (2) every allow-listed tool's bare name ∈ `readonly ∪ approvals ∪ keys(renders)` — unclassified ⇒ server refuses to start. The model's allow-list lost `mcp__gmail__create_draft`; `qualifier` declares `readonly: ['get_latest_email']`; `triage` got `readonly: ['list_my_tickets','get_ticket']`.
   - **As-built — effect execution:** `createDraft` was EXTRACTED from the Gmail MCP into a pure exported `@atizar/integrations/gmail-basic/create-draft` (injectable `getGmail`; MCP wrapper + server both call it; `errText` moved to `format.mjs`). `POST /api/gates/:id/resolve` `{formRev, decision, form?, comment?}` → `PipelineService.resolveGate(gateId, …)`: formRev mismatch → **409**; `claimLedger` (INSERT ON CONFLICT DO NOTHING, key `workItemId:gateId`) licenses exactly ONE execution; the SERVER calls `effects[gate.toolName](editedForm, ctx)` → real `createDraft`; `setLedgerResult`; then `observer.resume` primed via the propose-don't-execute reply prompt (reads `executedResult.draftId`). **A failing effect (`{error}`) fails the work item (`transition(fail)`, HTTP 502) — never a false "saved".** A re-resolve after the gate closed is idempotent (returns the prior ledger result, no second execution).
   - **As-built — Stop:** `transition.ts` gained `cancel` (from queued/running/awaiting_approval/awaiting_input) + `reject` (from awaiting_approval) edges, each writing the `resolution` marker; the active-children deferral guard stays scoped to `finish`. RunObserver drives an explicit `AsyncIterator` registered in `Map<id, iterator>`; `cancel(id)` calls `iterator.return()` → the claude-cli generator's `finally` kills the subprocess; `consume`'s post-loop is **terminal-tolerant** (a concurrent cancel that already finalized the item is not overridden). `PipelineService.cancel`/`cancelWorkflow` cascade parent-first then ascending-id; `cancelItem` early-returns on already-terminal items and does NOT release the pool slot (queued never held one; running's slot is released by its own consume loop; awaiting_approval's was released at the gate) — fixes a double-release that could over-admit queued work. `WorkerPool.dequeue` removes a queued id on cancel. Routes: `/api/workitems/:id/cancel`, `/api/workflows/:id/cancel`, `GET /api/workitems/:id/gate`; the dev `/api/dev/workitems/:id/resolve` is GONE (the dev START `/api/dev/runs` stays for the spike until step 6).
   - **As-built — deviations from the plan's pseudo-code (all sound, verified):** (a) `resolveGate` does NOT itself `transition(resume)` — `observer.resume` owns that edge (avoids a double-transition); (b) the **reject** path does `transition(reject)` and does NOT call `observer.resume` (resume from `finished` would be illegal; the claude-cli rejected-branch is now reachable only via the legacy `run()` path — UI shows the `rejected` marker, no model narration); (c) no `setResolution` store method (the transition writes the marker).
   - **Browser/runtime E2E (all 6 PASS, `DEV_RECORD_REPLAY=1` + the trimmed `lead-inbox__reply` cassette):** (1) **edited approve → real Gmail draft** — edited the gate body, approved; DB: gate `resolved` with the edited `form.body`, `action_ledger` one row `{ok:true, draftId}`, work item `finished`; **fetched the real draft by id from Gmail → body contained the edited marker `7Q3Z`** (the load-bearing guarantee); thread showed the new resume narration "The Gmail draft was saved successfully." (no `create_draft`). (2) **reject** → `finished`/`rejected`, zero ledger rows. (3) **Stop mid-running** → caught at `running`; stream killed mid-flight (8/18 trace events), `finished`/`cancelled`, status not flipped back (terminal-tolerant). (4) **Stop at awaiting_approval** → `finished`/`cancelled`, gate `GET` → 404. (5) **restart durability** → killed+restarted the server mid-`awaiting_approval`; both gates SURVIVED (startup sweep leaves `awaiting_approval` durable), gate still fetchable. (6) **stale formRev → 409**, item not consumed (stays `awaiting_approval`). The `saveDraft` chip stays "running" (expected — HITL-kill means the approval tool never gets a `TOOL_CALL_RESULT`). Effect runs OUTSIDE record/replay → approve hits real Gmail (draft-only; the one test draft was deleted).
   - **Deferred to post-beta (decided, NOT built):** gate `capabilities` (editability derives from `kind`); runtime default-deny at the execution seam (only the boot-time classification kernel was taken — it is physically meaningful at the Mastra/server seam, step 5+); budget edge. **For the step-5 agent:** the `expires_at`/`assignee` Gate columns + stale badge are seams present in the schema but UI is post-beta; `reply.prompts.ts` is now propose-don't-execute; the conformance suite from step 1 is the Mastra definition-of-done.
5. **Mastra provider** (production path) beside claude-cli (dev). — ✅ **BUILT & browser-verified** on `feat/provider-contract-v2` (2026-06-10). 276 unit tests (incl. the Mastra conformance suite — the two-unlike-providers proof) + typecheck/lint/format green; live Mastra E2E (approve→real Gmail draft / reject / cancel) verified server-side AND in the browser (`?spike=1` replay). Spec → `docs/superpowers/specs/2026-06-10-mastra-provider-design.md`; plan → `docs/superpowers/plans/2026-06-10-mastra-provider.md`. Commits `26cee2c`…`845597b`.
   - **As-built — injected `MastraRunner` seam (fork 1):** `@atizar/providers` gained `mastra-types.ts` (`MastraRunner`/`MastraRun`/`MastraRunResult`/`MastraChunk`), `mastra-stream.ts` (chunk→AG-UI mapper, mirrors `claude-stream`), `mastra-provider.ts` (`createMastraProvider` — pure, NO `@mastra/*` import). The real Mastra Agent + 2-step workflow + Postgres storage lives in `apps/inbox/server/mastra/{tools,runner}.ts`. Conformance runs on a fake runner (no API key); the live key is only for E2E.
   - **As-built — gate via propose tool (fork 2):** one generic workflow `agentStep → gateStep`. `saveDraft`/`renderLead`/`renderVerdict` are no-op capture tools (`execute: (inputData)=>inputData`); `get_latest_email` is a native read tool calling the **extracted** `@atizar/integrations/gmail-basic/get-latest-email` (mirrors `createDraft`; the MCP `index.mjs` now delegates to it too). agentStep captures the LAST approval tool-call; gateStep `suspend()`s with it. The provider synthesizes `GATE_OPENED` from the observed approval call (refinement vs spec — robust to Mastra's suspend-payload shape).
   - **As-built — native resume (fork 3 / fork 4):** `resume()` = `createRun({ runId }) + resumeStream({ resumeData })` against the parked suspended snapshot (NO kill-and-re-prime). One **shared** `PostgresStore` (bounded pool `max 8`) across all agents — a per-agent store exhausted PG connections at boot. `ProviderConfig` gained `instructions` + `agentId` (threaded from `buildProvider`); `providers.ts` adds the `mastra` factory + `PROVIDER=mastra` alias (default stays `claude-cli`) + `ANTHROPIC_API_KEY` fail-fast + `MASTRA_MODEL` (default `claude-sonnet-4-6`); DB url reuses `client.ts` `databaseUrl`.
   - **THE bug the live E2E caught (cautions paid off):** the provider's `finally{run.abort()}` fired on a clean SUSPEND too, cancelling the parked Mastra run → resume failed _"This workflow run was not suspended"_. Fix: track `settled`; abort ONLY on interrupt (Stop/`iterator.return`), never on a clean suspend/finish (+2 unit tests). caution (a) cancel-mid-run, caution (b) last-wins/no-draft, caution (c) Mastra tables out of our drizzle set + `reset.ts`/test-globalSetup init — all built and verified.
   - **Deviations from the plan (sound):** record/replay re-key was **DEFERRED** — the message-scan step key already yields the correct 0/1 steps in the server-spine single-gate model (`input.messages` carries no resolved-approval transcript; re-keying would couple the dev decorator to StateStore + risk regressing claude-cli for zero behavioural gain). Cassettes were wiped. `/api/dev/runs` gained an optional `payload` (drives the gate on a fresh real run — throwaway, dies at step 6). **Pre-existing latent issue noted (NOT step-5):** `WorkerPool.resumeAcquire` calls `opts.run` → a benign `IllegalTransition: cannot "start" from "running"` is logged on every resume (the real resume runs via `observer.resume`'s own `consume`); harmless but worth cleaning at step 6.
   - **DX note:** the server does NOT auto-load `.env.local`; `PROVIDER=mastra` needs `ANTHROPIC_API_KEY` in the process env (`set -a; . ./.env.local; set +a` before `yarn dev`, or add `--env-file`). Worth wiring `.env.local` loading at step 6/7.
6. **Re-point board/thread UI** to server state; delete `@copilotkit/*` deps. — ✅ **BUILT & browser-verified** on `feat/provider-contract-v2` (2026-06-10). 277 unit tests + typecheck/lint/format/build green; the UI is fully server-driven and `@copilotkit/*` is gone from the import graph AND `package.json` (`@ag-ui/client` stays — the event vocabulary). Spec → `docs/superpowers/specs/2026-06-10-server-driven-ui-step6-design.md`; plan → `docs/superpowers/plans/2026-06-10-server-driven-ui-step6.md`.
   - **Scope discovery (the step-6 line glossed it):** server-side **handoff did not exist** — steps 3–5 only ever drove single agents via `/api/dev/runs`. But handoff is **human-gated** (a card button with a hardcoded `Destination`, NOT model-autonomous), so it became one `POST /api/deliver` endpoint + lifting the pure `resolveDelivery`/`deliveryKey` into `@atizar/core` (`packages/core/src/delivery.ts`). The server resolves the destination and dispatches a CHILD work item (`parentId` = the card's work item); dedup-by-`source` is the chokepoint's existing job.
   - **As-built — server:** `POST /api/deliver` ({origin, dest, payload, parentId} → resolve + dispatch child, origin `agent`); `/api/dev/runs` promoted to `POST /api/dispatch` (human START); `PipelineService.deliver` (+ `descriptors` dep); `dispatch`/`deliver` now `publishBoard()` so a freshly-queued item shows immediately. The CopilotKit endpoint (`createCopilotEndpoint`) + `buildAgent` are DELETED — pipeline routes are the only transport.
   - **As-built — client:** four data hooks (`hooks/useBoard` snapshot+SSE-refetch, `hooks/useWorkItemThread` trace+SSE-tail+`foldEventsToMessages`, `hooks/useGate` gate+formRev approve/reject, `hooks/useDispatch` start/deliver/cancel); `boardModel.ts` maps server `WorkItem[]` → the EXISTING pure `pipelineModel`/`aggregate` (cap/queue now server-side); `status.mapStatus` (server union → display `Status`); `serverTypes.ts` (client mirror of the schema fields). `buildRenderToolCall` replaces CopilotKit `useRenderToolCall` (parse tool args → render spec). Approval is **gate-driven**: `HitlSpec.render` ctx changed to `{form, formRev, status, approve, reject}`; `ApprovalDialog` is now an editable textarea (the edited body is the load-bearing "edited text → Gmail" path); `ThreadModal` owns the per-item hooks (keyed by id so a reload remounts fresh) + renders the gate card from `useGate`. Handoff notes are DERIVED from board `parentId` topology (no client deliver state). The open work item id rides in `?open=<id>` so a reload re-attaches. A per-workitem **Stop** button was added to the thread (found missing during E2E — "Stop per agent" is a locked decision).
   - **DELETED:** `useAgentInstances`, `instancesCore` (client copy), `statusFrom`, `InstanceTools`, `useWorkflowRenders`, `LiveInstanceModal`, `spike/TraceSpike`, the `?spike=1` mount, the `<CopilotKit>` tree, `/api/dev/runs`, both `@copilotkit/*` deps. KEPT: `renderRegistry` + all cards, `RenderSpec`/`HitlSpec` (HITL ctx changed), `pipelineModel`/`aggregate`/`buckets`/`devMode`/`status`/`threadResults`, `WorkflowSwitcher`/`PipelineColumn`/`AgentCard`/`InstancePickerModal`, Smedja `styles.css`, `?dev=1`.
   - **Browser E2E (replay, `DEV_RECORD_REPLAY=1`):** ✅ **single run** (START → qualifier runs → Done); ✅ **handoff** (`/api/deliver` → reply child nested under the qualifier with the ↓ connector, parent reopened to Working, derived "→ Handed / ← Received" notes + "Open" jump); ✅ **approve WITH an edited artifact** — edited the gate body to insert `EDITED-MARKER-7Q3Z`, approved, **fetched the real Gmail draft by id → the edited body was present** (ledger one row `{ok,draftId}`, item `finished`, parent auto-finished); ✅ **reject** (`finished`/`rejected`, zero ledger rows); ✅ **cancel via the UI Stop button** (`finished`/`cancelled`, gate 404); ✅ **reload re-attach** (fresh navigation to `?open=<id>` rebuilds the full thread + gate from the trace/gate endpoints); ✅ **board SSE live coherence** (handoff/status updates appeared live without reload); ✅ **post-deps-removal smoke** (booted clean, single run works, no `@copilotkit` in node_modules). **NOT browser-driven this session (honest):** 3-at-once cap (covered by the `pipelineService` blocking-provider integration test — under fast replay the gate releases slots, so "2 active + queued 1" isn't reliably observable); cross-workflow "Treat as lead" (the contract resolution + schema validation are covered by the `pipelineService.deliver` integration test; a live triage run has no cassette and would hit the real GitHub board). Both are follow-ups for step 7's golden-set/eval pass.
7. **Extraction + packaging (the beta IS the framework — locked decision #7, 2026-06-10)**: FIRST extract `apps/inbox/server/pipeline/` → `@atizar/server` and the board/thread UI → `@atizar/react` (mechanical folder moves if the import discipline below held), then slim the demo app down to workflows/config that consume ONLY the public packages — the living proof of belief #3 (userland never imports internals). The beta deliverable = the monorepo of libraries + this thin demo app, NOT a clone-template app. Then: zero-cred demo (`DEMO=1` → mock provider + SYNTHETIC cassettes authored fresh, scanCassette gate in CI), README 10-minute script, LICENSE (MIT vs Apache-2.0 — ask the user), `@atizar/*` scope rename, golden-set eval per workflow, shared bearer token on all mutation routes (honest `resolvedBy`). npm publish at launch vs monorepo-first is a launch-time call — the package BOUNDARY is the deliverable, the registry is logistics.
   - **Sub-step 7a — `@atizar/server` extraction: ✅ BUILT & browser-verified** on `feat/provider-contract-v2` (2026-06-10), commits `6713ba9`…`e7123e5`. Plan → `docs/superpowers/plans/2026-06-10-extract-platform-server.md`. `check-foundation` verdict = CLEAR (realizes I5; no engine import added to core).
     - **As-built:** `EffectFn` (a pure server-effect contract type) relocated `apps/inbox/workflows/server-binding.ts` → `@atizar/core` (`packages/core/src/effects.ts`) FIRST — that was the ONLY out-of-folder import in `server/pipeline/`, so the move was then violation-free. `apps/inbox/server/pipeline/*` (23 src files: StateStore, dispatch, transition, WorkerPool, RunObserver, eventBus, pipelineService, routes, sweep, drizzle schema+migrations, 9 tests) `git mv`'d wholesale → `packages/server/src/*`. New package follows the no-build `@atizar/*` pattern (`exports` → `./src/index.ts` + a `./db/schema` subpath for drizzle-kit; package-local `outDir`/`tsBuildInfoFile` per the TS5055 gotcha). Barrel re-exports the app-consumed surface (`db`, `databaseUrl`, `runMigrations`, `resetDb`, `startupSweep`, `makePipelineService`, `createPipelineRoutes`, `PipelineService`/`AgentRuntime`/`Db` types). App import sites repointed: `server/index.ts` (6→1 barrel import), `server/providers.ts` (`databaseUrl`).
     - **3 config touchpoints that broke on the move (all fixed):** drizzle.config schema/out paths; vitest `globalSetup` path; `apps/inbox` `db:migrate`/`db:reset` scripts (now `tsx -e "import('@atizar/server')…"`). The migrations-folder path in `migrate.ts` + `test-global-setup.ts` is now resolved from `import.meta.url` (cwd-independent) instead of a cwd-relative string.
     - **Boundary smell flagged (NOT fixed — for a future @atizar/server test-harness cleanup):** `packages/server/src/db/test-global-setup.ts` imports `@mastra/pg` (to init Mastra's tables in the shared test DB) — a concrete engine inside a framework package's TEST infra. Test-only, not runtime, not in `@atizar/core` → no invariant violated, but the package's test harness shouldn't know Mastra (an `apps/inbox` concern); also `@mastra/pg` is undeclared in the package's deps (resolves via hoisting). Clean up when the package's test-DB setup is designed for standalone consumers.
     - **Browser/runtime E2E verified (`DEV_RECORD_REPLAY=1`, lead-inbox cassettes):** board loads (routes mounted + migrate-on-boot); single run START→qualifier Working→Done (UI); gate opens (`GATE_OPENED`→Gate insert→`awaiting_approval`); **approve WITH an edited body → real Gmail draft fetched by id contained the edit `[EDITED-MARKER-7Q3Z]`** (UI approve; ledger one `{ok,draftId}` row, gate `resolved`, item `finished`; test draft deleted); reject→`finished`/`rejected`, 0 ledger (API); cancel at `awaiting_approval`→`finished`/`cancelled`, gate 404 (API); reload re-attach (fresh nav to `?open=<id>` rebuilt thread+gate from endpoints); `db:reset`/`db:migrate`/`db:generate` scripts work on the moved paths. (Pre-existing robustness gap noticed, NOT 7a's scope: the resolve route does not strictly validate `decision` against `'approved'|'rejected'` — an unknown value falls through to the approve/execute branch; the browser `useGate` always sends the right enum, but a malformed direct POST would execute. Worth a zod parse on the route later.)
   - **Sub-step 7b — `@atizar/react` extraction: NEXT, and NOT purely mechanical.** Audit (this session): "machinery in, cards out" holds cleanly EXCEPT `ThreadModal` imports the demo's `renderRegistry` + `workflows` aggregator, and the locked component inventory names `WorkflowBoard`/`registerCard` as PACKAGE primitives — so the card-injection API (how the package receives userland cards + render/HITL specs: a `registerCard` registry vs props/context) is a real design fork. **Start 7b with a short brainstorm on that injection API** before moving files (`registerCard` is the documented intended primitive — confirm and lock it). Then it's a folder move like 7a (hooks/, chrome components, models, renderSpecs, buildRenderToolCall, styles.css → `@atizar/react`; LeadCard/TriageCard/ReplyDraftCard/VerdictCard/TicketResultCard/ApprovalDialog + the registry + `workflows.ts` + App shell stay in the demo as userland). `IconName` lives in `components/Icon.tsx`; since Icon + the models both go into the package, no extraction needed. Then 7c = slim demo + packaging tail (DEMO=1/PGlite, README, LICENSE [ask user], scope rename, eval, bearer token).
     - **7b injection API (ANSWERED 2026-06-10, check-foundation: CLEAR — do not re-ask):**
       (1) **Typed-spec injection via props + one package `<Provider>` context** (e.g.
       `<WorkflowBoard renders hitl meta workflows/>` wrapped once), NOT a global mutable
       `registerCard` singleton — `registerCard` in the inventory named the CAPABILITY (userland
       plugs cards in), and injection IS that mechanism; React-idiomatic, StrictMode/test-safe,
       two boards with different configs for free. (2) **Collapse the string-name registry**:
       `RenderSpec`/`HitlSpec` TYPES live in `@atizar/react`; userland instances reference card
       components DIRECTLY; `renderRegistry.tsx` is deleted. This makes `renders` mirror the
       `effects` pattern — names in core (classification, I15), implementations in a binding
       outside (ServerBinding = effect fns; client spec binding = components). Foundation check:
       core stays React-free (types are in the react package, not core), I15 keys untouched, I5
       strengthened. **Two conditions:** `defineAgent.renders` in core is NOT touched this step
       (keys feed I15 + server card-filling; the component-name VALUES become vestigial labels —
       a possible Record→array tidy happens at the §3 ARCHITECTURE doc level, explicitly via
       check-foundation, post-extraction, never silently); and the context comes from ONE
       package-level Provider so userland doesn't thread specs into every component.
     - **Sub-step 7b — `@atizar/react` extraction: ✅ BUILT & browser-verified** on `feat/provider-contract-v2` (2026-06-10), commits `ea64d0e`…`e61dd1e`. Spec → `docs/superpowers/specs/2026-06-10-extract-platform-react-design.md`; plan → `docs/superpowers/plans/2026-06-10-extract-platform-react.md`. `check-foundation` = CLEAR. 277 unit tests + typecheck/lint/build/format(my files) green.
       - **As-built:** machinery `git mv`'d → `packages/react/src/` (hooks/{useBoard,useDispatch,useGate,useWorkItemThread}; models aggregate/boardModel/pipelineModel/status/statusDisplay/serverTypes/devMode/threadResults; chrome Icon/AgentCard/AgentModal/PipelineColumn/WorkflowSwitcher/InstancePickerModal/ThreadModal; `InboxView`→`WorkflowBoard`; renderSpecs(types)/buildRenderToolCall; styles.css; the 4 machinery test files). New `workflowsContext.tsx` (`WorkflowsProvider`+`useWorkflowsConfig`). Barrel exports WorkflowBoard, WorkflowsProvider/useWorkflowsConfig, WorkflowsConfig + AgentMeta/DeliverFn/RenderSpec/HitlSpec types, buildRenderToolCall, useThreadResult/ThreadResultsContext, Icon/IconName, and the 4 hooks. `package.json` exports `.` + `./styles.css`; `react`/`react-dom` are peerDeps.
       - **The injection, as built (matches the locked decision):** `RenderSpec`/`HitlSpec` render closures lost the `registry` param + `renderRegistry.tsx` is DELETED — userland workflow client modules (`workflows/{lead-inbox,github-triage}/client.tsx`) now import their cards DIRECTLY (`<LeadCard/>`, not `registry['LeadCard']`) and import the spec types + `useThreadResult` from `@atizar/react`. `buildRenderToolCall(renderSpecs, deliver)` + `ThreadModal` read `renders`/`hitl` from `useWorkflowsConfig()`. `WorkflowBoard` takes `config: WorkflowsConfig` and wraps its tree in ONE `WorkflowsProvider`. Demo: `App = () => <WorkflowBoard config={workflowsConfig}/>`; `client/src/workflows.ts` builds `workflowsConfig` (dedupe-by-toolName) from the workflow modules; `main.tsx` imports `@atizar/react/styles.css`.
       - **Correction to the inventory:** `buckets.ts` (`TriageTicket`/`groupByStatus`) is **vertical-specific** (only TriageCard + github-triage/client use it) — it STAYS userland, NOT in the package. `deliver.ts` (an unused `@atizar/core` re-export) was deleted.
       - **Browser E2E (`DEV_RECORD_REPLAY=1`, lead-inbox cassettes, through `@atizar/react`):** app loads + **fully STYLED** (CSS export resolved); single run START→qualifier thread renders; reply gate → **LeadCard + ApprovalDialog render via the injected context + direct card refs**; **approve WITH an edited body (UI Save draft) → real Gmail draft fetched by id contained `[REACT-EDIT-9K2W]`** (ledger one row, item `finished`; test draft deleted); **reject via the UI button** → `finished`/`rejected`, 0 ledger; **cancel via the UI Stop button** → `finished`/`cancelled`, gate 404; reload re-attach (`?open=<id>`); 0 console errors (no `WorkflowsProvider`/import faults). NOT browser-driven (honest, same as prior steps): github-triage live run (read-only, no cassette) — the triage render path's context wiring is covered by typecheck + the renderLead/renderVerdict unit tests through the package's `buildRenderToolCall`.

**Anticipated decisions, steps 3–7 (ANSWERED 2026-06-10 — decide-and-go, do not re-ask the user):**

- **Coexistence model for steps 3–5 (the big one):** the new pipeline is built BESIDE the old
  CopilotKit path, not into it. During steps 3–5 the new spine drives the lead-inbox flow through
  the spike's dev surface (dev page + trace/SSE endpoints); the old board stays untouched and
  working. The swap happens once, at step 6. Never half-migrate the old board mid-step, and do
  NOT write an old↔new adapter beyond what step 1 already shipped.
- **Code layout:** pipeline code lives in `apps/inbox/server/pipeline/` (PipelineService,
  StateStore, RunObserver, WorkerPool, transition, dispatch) **during steps 3–6**. Do NOT create
  `@atizar/server` mid-build — extraction happens ONCE, at step 7, after the API stops churning
  (it IS a beta deliverable, not post-beta — locked decision #7).
  **Extraction discipline so the step-7 move is mechanical:** CONTRACTS/types/pure helpers go into
  `@atizar/core` immediately (the steps-1/2 pattern: `gate.ts`, `conformance.ts`, `fold.ts`);
  implementation stays in the app, and `server/pipeline/` may import ONLY `@atizar/*` + its own
  folder — never the rest of `apps/inbox` (no reaching into workflows/, client/, mcp/). Same rule
  for the new board/thread UI at step 6: components destined for `@atizar/react` import only
  `@atizar/*` + each other.
  **`@atizar/react` boundary (decided 2026-06-10): machinery in, cards out.** The package ships
  the data hooks (useBoard / useWorkItemThread / useGate-with-formRev / useCancel), the chrome
  (workflow board/desktop, workflow SWITCHER tabs with delivery badges, pipeline column +
  instance tree, AgentCard type-cards, thread view, editable GateForm with approve/reject,
  Stop button, status/stale badges), the `registerCard` render-registry + primitives kit, and
  the theme. Litmus test: renders from the generic model (Workflow/Agent/WorkItem/Gate/status)
  → package; knows the vertical's payload (lead, ticket, draft) → userland card.
  **`@atizar/react` beta component inventory (decided 2026-06-10):**
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
  (foldEventsToMessages, status mapping) stays in `@atizar/core` (pure TS), so a future
  `@atizar/vue` would rewrite only the thin binding layer.
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
  `@atizar/integrations/gmail-basic` DIRECTLY (plain function call — the stdio MCP child is for
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
  `MastraRunner` interface into `@atizar/providers/mastra-provider.ts` (the spawn-injection
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
  (built at step 2, `@atizar/core`, unit-tested) — render both history and live tail through it
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

### 🆕 ACTIVE TRACK (2026-06-11) — email-inbox workflow BEFORE the packaging tail

By the user's call, a new flagship demo workflow is built before sub-step 7c, so the framework is
stress-tested by a real new consumer (new integration, machine dispatch, batch gates, UI chrome)
before packaging. 7c (slim demo + packaging) resumes AFTER this track, with email-inbox as the
demo. Spec → `docs/superpowers/specs/2026-06-11-email-inbox-workflow-design.md` (sorter
machine-dispatches a REPLY instance per email + READER/SPAM/IMPORTANT batch agents; batch gates
with per-row trash/read/star/keep; all Gmail mutations are server-executed effects). Build stages
→ spec §6.

- **Stage 1 — gmail-viewer integration + write-integration skill: ✅ BUILT** on `feat/gmail-viewer`
  (2026-06-11, off `master`; commits `8e0fc6d`…`061b65e` + `c70ab81` + the stage-1 docs commit).
  Plan → `docs/superpowers/plans/2026-06-11-gmail-viewer-integration.md`. 291 unit tests +
  typecheck/lint green; all gmail-viewer files Prettier-clean.
  - **As-built:** `@atizar/integrations/gmail-viewer/*` — `list-unread` (unread inbox window,
    metadata-only, capped 25, hours round up to whole days for Gmail search), `get-email` (full
    body by id, reuses gmail-basic's `parseLatestMessage`), `modify` (markRead/trash/star,
    best-effort batch: per-row `{messageId,error}` collected, wholesale `{error}` on client
    failure; `trash` = reversible Gmail Trash, NOT permanent delete), `check-credentials`
    (re-export). The health check lives in **gmail-basic** (`check-credentials.mjs`, shared OAuth
    client + account) and gmail-viewer re-exports it; the `.d.ts` re-export uses a `.js` specifier
    (TS resolves to the sibling decl). Read-only stdio MCP `index.mjs` exposes ONLY `list_unread`
    - `get_email` — mutations are NEVER model-visible (verified). 10 subpath exports in
      `package.json`.
  - **Skills:** `write-integration` (L1 Task skill, first of its genre — `.claude/skills/`); first
    A7 consumer skill shipped INSIDE the package
    (`packages/integrations/skills/gmail-viewer/SKILL.md`).
  - **Live read-only smoke PASS** (real creds): health ok (`sjuser95@gmail.com`); `listUnread` 7d
    → 25; `getEmail` first body → 201 chars. Mutations are unit-tested only — their live
    verification is stage 3's browser E2E.
  - **Known pre-existing (NOT this stage):** repo-wide `yarn format:check` is red on two docs the
    user maintains in parallel (`.claude/skills/README.md`, `.claude/skills/check-foundation/SKILL.md`)
    — `README.md` failed Prettier already at `57481e6`, before stage-1 touched it; left alone per
    the parallel-docs rule.
- **Stage 2 — core/server capabilities: ✅ BUILT** on `feat/gmail-viewer` (2026-06-11). 318 unit
  tests + typecheck/lint/prettier-clean green. Plan →
  `docs/superpowers/plans/2026-06-11-email-inbox-stage2-core-server.md`.
  - **F9 — thin integration contract (types-only):** `HealthCheck`/`ReadResult<T>`/`BatchActionResult`
    in `@atizar/core`; gmail-basic + gmail-viewer `.d.ts` retyped against them;
    `write-integration` + `gmail-viewer` skills + `docs/AGENTIC.md` reference the contract.
  - **F1 — workflow-level prompt (mechanism):** `composeInstructions()` helper +
    `defineWorkflow.prompt` field in core; threaded into `buildProvider` via a composed-instructions
    param (Mastra path wired). **Mechanism only** — the claude-cli prompt-strategy composition for
    the email-inbox `server.ts` is Stage 3. Zero regression on lead-inbox (no prompt field).
  - **F2 — machine dispatch:** `defineAgent.dispatches` tool class (subset of `tools`); boot
    classifier accepts `dispatches` (unclassified tool still refuses to boot); RunObserver detects a
    dispatch tool call → `deliver`s a child work item (origin agent, validated against `handoffs`),
    bad target = trace warning, never an action (I2); conformance suite asserts surfaced dispatch
    tool calls pair START/END. **Foundation note:** `ARCHITECTURE.md` I15 updated to enumerate
    `dispatches` alongside `readonly`/`approvals`/`renders`/`effects` (protected-doc edit, done
    with explicit check-foundation confirmation).
  - **F3 — credential-health surface:** `ServerBinding.health` + `aggregateHealth`/`providerHealth`
    helpers; `computeAgentHealth`/`refreshHealth` in the app; `GET /api/health` (on-demand refresh);
    `agentHealth` on the board snapshot (cheap cached read). Boot logs a one-line health summary,
    never throws. **UI badge is Stage 4.**
  - **F4 — activity feed:** in-memory ring buffer + `activity` bus topic; recorded at
    dispatch/deliver/resolveGate/cancel + runObserver running/gate/finished/error seams;
    `getActivity()`/`subscribeActivity()` façade; `GET /api/activity` + `/api/activity/stream`
    (SSE). **Panel UI is Stage 4.**
  - **F6 — singleton START guard + cancel-all:** duplicate HUMAN start of a `maxInstances:1` agent
    → 409 (machine dispatch unaffected); `POST /api/cancel-all` reuses the cancelWorkflow cascade.
- **Stage 3 — email-inbox workflow: ✅ BUILT & browser-verified** on `feat/gmail-viewer`
  (2026-06-11). 330 unit tests + typecheck/lint/build green; all six target browser E2E flows PASS
  on the claude-cli provider (live record → true replay; cassette mtimes unchanged). Plan →
  `docs/superpowers/plans/2026-06-11-email-inbox-stage3-workflow.md`. `check-foundation` = CLEAR
  (I2/I9/I15 upheld — see below).
  - **As-built — module** (`apps/inbox/workflows/email-inbox/`): `descriptor.ts` (sorter +
    reply + reader/spam/important via a shared `batchAgent` factory; `EmailRefSchema`/
    `EmailBatchSchema`/`ReplyPayloadSchema`; `emailInbox` carries a workflow-level `prompt`),
    `apply-actions.ts` (the `applyEmailActions` batch effect — groups rows by action, one
    gmail-viewer batch mutation per group, `keep`=no-op, best-effort per-row failures, wholesale
    `{error}` aborts → fails the item, never a false "applied"; gmail fns injected), `prompts.ts`
    (claude-cli `PromptStrategy` for sorter/reply/batch — **this is where F1's claude-cli prompt
    path is finally wired**: `composeInstructions(emailInbox.prompt, agent.instructions)` in
    `server.ts`), `server.ts` (allow-lists + `effects` + `health`), `client.tsx` (meta +
    `renderSort` RenderSpec + `applyActions` HitlSpec; reuses lead-inbox's `renderLead`/`saveDraft`
    via the aggregator's dedup-by-toolName). One line added to each of the three aggregators.
  - **As-built — the batch gate** = ONE `applyActions` approval whose tool-args ARE the editable
    form (`{items:[{messageId,from,subject,action}]}`); `EmailBatchCard` (userland, `client/src/
components/`) renders one row per email with a per-row action `<select>` (read/trash/star/keep);
    the edited rows flow to `approve(form)`; the SERVER runs `applyEmailActions` on approval (the
    `effects` binding), ledger-keyed once. `SortSummaryCard` renders the sorter's `renderSort`.
  - **As-built — machine dispatch** = the sorter's `route_emails` (`dispatches` class); the model
    CALLS it, the Stage-2 RunObserver turns the observed call into a CHILD work item (origin
    `agent`, payload = the args minus `to`, validated against `handoffs`). MCP additions
    (`apps/inbox/mcp/inbox-tools.mjs`): `renderSort`/`route_emails`/`applyActions` are PURE echo
    surfaces — none performs a Gmail action; the gmail-viewer stdio MCP server is wired in
    `claude-spawn.ts` (exposes ONLY `list_unread`+`get_email` to the model — mutations are never
    model-visible).
  - **Browser E2E (claude-cli, record→replay):** (1) **sort + machine dispatch** — START sorter →
    `list_unread` → one `route_emails` (all 5 promo emails → reader) → `renderSort` summary card →
    reader child nested under the sorter with the ↓ connector (machine dispatch visible); sorter
    stays "Working" (deferred — has a live child). (2) **batch approve WITH an edited row** — edited
    IFTTT read→star, Applied → DB gate `resolved` with the edited form, `action_ledger` one row
    `{applied:5,failed:[],byAction:{read:1,star:1,trash:3}}`, item `finished`; **verified via the
    Gmail API the real actions happened** (3 trashed, 1 starred, 1 marked-read — the edited star
    landed), then **UNDID all** (untrash+re-add INBOX, unstar, restore UNREAD → exact before-state).
    (3) **reply approve → real draft** — reply child read the body (get_email) + drafted + saveDraft
    gate; edited the body (`[EDIT-MARKER-9X4Q]`), approved → **fetched the real Gmail draft by id →
    the edit was present**, ledger one row, item finished; test draft deleted. (4) **reject** a
    batch gate → `finished`/`rejected`, **zero ledger rows**, no Gmail change. (5) **Stop** — per-item
    Stop at `awaiting_approval` → `finished`/`cancelled`, gate 404; `POST /api/cancel-all` → the
    deferred sorter → `cancelled`. (6) **singleton 409** — second START of the `maxInstances:1` sorter
    while one is active → **409 "already running"** (F6 guard at runtime).
  - **Cassettes recorded** (gitignored, REAL data — never commit): `email-inbox__{sorter,reader,reply}`.
  - **Two findings (NOT foundation violations — follow-ups, NOT fixed this stage):**
    (a) **Parent stays "running" when its only child terminates via reject/cancel** (not a normal
    `finish`): the leaf→root auto-finish walk in `transition.ts` is scoped to the `finish` edge, so
    `reject`/`cancel` of a child don't re-trigger the parent's finish check — the sorter sits
    deferred-`running` until itself cancelled (cleared by `cancel-all`). First surfaced by Stage 3's
    parent-dispatches-children topology; a framework lifecycle wrinkle, not an invariant breach (the
    item stays visible/audited/stoppable). Fix = also run the parent finish-walk on a child's
    terminal `reject`/`cancel`. (b) **Flow "re-route a batch row to reply" is NOT wired** — the batch
    agents declare `handoffs:['reply']` but `HitlSpec.render` ctx has no `deliver` (only `RenderSpec`
    gets it), and `EmailBatchCard` has no per-row "Draft reply" button, so that handoff is currently
    inert. Wiring it needs a small `@atizar/react` addition (deliver-from-a-HITL-card) → its own
    step + `check-foundation`.
    **For Stage 4 (UI chrome):** the F3 health badge, F6 START-disable, F7 "Delegating"/"Done" pipeline
    states, the ActivityLog panel, and the polished EmailBatchCard styling (it currently reuses the
    approval/lead Smedja classes + raw `.batch-row*` classes that have no CSS yet) are all Stage 4.
- **Stage 3b — email-inbox on the Mastra production provider: ✅ BUILT & live-verified** on
  `feat/gmail-viewer` (2026-06-11). 334 unit tests + typecheck/lint/build green; all six flows
  verified on a LIVE `PROVIDER=mastra` run (real Anthropic API + real Gmail) AND claude-cli
  regression confirmed. Plan → `docs/superpowers/plans/2026-06-11-email-inbox-stage3b-mastra.md`.
  `check-foundation` = CLEAR (I4 strengthened — two unlike providers run the SAME flagship workflow).
  - **As-built — one prompt source (A1):** the Mastra runner's hardcoded lead-inbox `buildPrompt`
    (+ its `decodeHandoff`/`HandoffPayloadSchema` imports) is DELETED; `MastraRunnerConfig` gained
    `prompts: PromptStrategy` and `start()` builds the first-turn prompt from `cfg.prompts.buildFirst(input)`
    — the SAME object claude-cli uses (`config.prompts` threaded through `mastraFactory`). claude-cli +
    Mastra now share ONE prompt source per workflow (`workflows/<id>/prompts`); there is no
    Mastra-specific prompt path. The gateStep narrative was neutralized ("The action was approved and
    applied." / "…rejected; nothing was applied.") so it fits any effect, not just the draft.
  - **As-built — tools (B1/B2):** `mastra/tools.ts` gained `listUnreadTool`/`getEmailTool` (real reads
    → the gmail-viewer functions) + `routeEmailsTool`/`renderSortTool`/`applyActionsTool` (capture
    surfaces); `ALL_TOOLS` extended. A **fail-fast** throws on an unregistered tool name (B2) instead
    of building an Agent with `undefined` tools.
  - **As-built — github-triage stays claude-cli-only (the B2 fail-fast surfaced this):** under
    `PROVIDER=mastra` EVERY workflow's agents resolve through the Mastra factory at boot, so the
    github-triage tools (never Mastra-ready — they read the private board via `gh`) had to be
    registered or the fail-fast aborts the whole server. The 3 render tools are capture surfaces; the
    2 reads (`list_my_tickets`/`get_ticket`) are HONEST "not supported on the Mastra provider" stubs.
    **Follow-up:** wire the real `gh` reads as Mastra tools if github-triage should run on Mastra
    (it's read-only, so safe).
  - **Live Mastra E2E (PROVIDER=mastra, real LLM + real Gmail, all 6 PASS):** (1) **sort + machine
    dispatch** — the sorter `list_unread` → `route_emails` per group → THREE children (spam/reader/
    important) nested in the pipeline + `renderSort` (machine dispatch on the prod provider — the
    keystone). (2) **batch approve with an edited row** — edited reader's IFTTT read→star, Applied →
    real Gmail STARRED + ledger `{applied:1,byAction:{star:1}}`, item finished; undone. (3) **reply
    approve → real draft** — the reply child reached the saveDraft gate, edited body
    (`[MASTRA-EDIT-5T8K]`) approved → **the real Gmail draft contained the edit** (native Mastra
    resume), draft deleted. (4) **reject** important → finished/rejected, Sportmonks unchanged, zero
    ledger. (5) **cancel-mid-run (the load-bearing Mastra check)** — Stopped `spam` while running →
    cancelled, while the SUSPENDED `reader` gate SURVIVED untouched (the beta's `abort()`-only-on-
    interrupt guard holds: a clean suspend is never aborted). (6) **singleton 409** — a second START
    while the sorter's executor is active → 409 (provider-agnostic WorkerPool guard).
  - **THE bug the live Mastra E2E caught + fixed:** with the shared prompt, `claude-sonnet-4-6`
    (Mastra) narrated the reply in PROSE and asked "save to Gmail?" instead of calling `saveDraft`,
    so the gate never opened. Fixed by hardening the email-inbox reply prompt to the mandatory-
    saveDraft discipline (numbered tool steps + "calling saveDraft IS how you ask — do NOT ask in
    prose"), the same language the old hardcoded Mastra prompt carried. Re-verified: the reply child
    reaches the gate on Mastra. (claude-cli replay unaffected — the cassette replays events, not the
    prompt text; the claude-cli reply→approve→draft regression re-passed.)
  - **Two pre-existing findings carried from Stage 3 (NOT 3b-introduced, still open):** (a) a parent
    work item stays "running" when its only children terminate via reject/cancel (the leaf→root
    auto-finish walk is scoped to the `finish` edge); (b) the singleton 409 guard has a TOCTOU race —
    two TRULY-concurrent STARTs both pass (sequential double-start correctly 409s). Both are
    provider-agnostic dispatch-layer behaviors.
  - **Final review = READY-TO-MERGE** (no Critical/Important). Two MINOR pre-existing/cosmetic
    follow-ups noted, not fixed (fixing M1 would need a re-run of the live Mastra E2E for a harmless
    redundancy): (M1) on the Mastra turn the composed instructions ride in BOTH `Agent.instructions`
    and the leading line of `buildFirst`'s prompt — a benign duplication (the old hardcoded prompt
    did the same); (M2) the github-triage descriptor lists its read tools in `tools` (not `readonly`),
    so `mastraFactory` classifies them as render/propose — no functional effect (they're stubs),
    align it when github-triage gets real Mastra reads. **Next (by the user's call 2026-06-11) =
    the integration auth contract track below, NOT Stage 4 (UI chrome) — Stage 4 is parked.**

### 🆕 ACTIVE TRACK (2026-06-11) — integration authentication contract

By the user's call, the credential/connection mechanism is built next (ahead of email-inbox Stage 4
UI chrome, which is parked). Today an integration reads its own secret files (`gmail-client.mjs` →
`~/.gmail-mcp/*.json`) — not production-ready. This track inverts it: an integration **declares**
its `AuthSpec` and **receives** a resolved credential; the framework owns provisioning, encrypted
Postgres storage, and an OAuth "Connect" flow; the `ATIZAR_` env namespace stops framework vars
colliding with a developer's own. Spec → `docs/superpowers/specs/2026-06-11-integration-auth-contract-design.md`
(§7 = 5 sub-stages). Validated at the end by deleting + rewriting the gmail integration through the
updated `write-integration` skill.

- **Sub-stage 1 — contract types + `ATIZAR_` env namespace: ✅ BUILT** on `feat/gmail-viewer`
  (2026-06-11), commits `b917c9f`…`0e81010`. Plan →
  `docs/superpowers/plans/2026-06-11-integration-auth-substage1-contract-env.md`. 354 unit tests
  (344 + 10 new) + typecheck/lint green; touched files Prettier-clean. `check-foundation` = CLEAR
  (I3 purity held — core imports nothing; I5 reinforced — open `kind`; I7 aligned — secrets by name).
  - **As-built:** `@atizar/core` `integration-auth.ts` — `AuthSpec` (OPEN `kind`: `none`/`apiKey`/
    `oauth2`/`{kind:string;…}` escape hatch — a custom auth method needs NO core edit), `ResolvedCredential`
    (per-kind payload), `CredentialResolver` (`(ctx:{integration,connectionId,auth}) => Promise<cred|null>`;
    `null` = not connected), `isOAuth2` guard. Sibling of `integration.ts`, pure (no fs/env/engine).
  - `@atizar/server` `env.ts` — `atizarEnv`, the SINGLE reader of `ATIZAR_*` (never scattered as raw
    `process.env.ATIZAR_…`): `secretKey()`, `apiKey(integration)` → `ATIZAR_<INTEGRATION>_API_KEY`,
    `oauthClient(provider)` → `ATIZAR_<PROVIDER>_CLIENT_ID/_SECRET`, `connection()` (defaults `'default'`),
    `databaseUrl()` (precedence `ATIZAR_DATABASE_URL` > `DATABASE_URL` > compose default). Rule encoded:
    OFFICIAL framework vars carry `ATIZAR_`; vendor vars (`ANTHROPIC_API_KEY`/`PROVIDER`/`MASTRA_MODEL`/
    `DEV_RECORD_REPLAY`) stay un-prefixed. `db/client.ts` `databaseUrl` now routes through `atizarEnv`
    (same default — zero behavior change; the DB-test globalSetup still works via the `DATABASE_URL`
    middle precedence). Both barrels export the new surface.
  - `connectionId` is threaded into the resolver signature + `atizarEnv.connection()` from day one
    (multi-mailbox-ready) but wired to a single `'default'`; actually USING a non-default value + the
    multi-connection UI is deferred (spec §9).
- **Sub-stage 2 — encrypted credential store + `resolveCredential`: ✅ BUILT** on `feat/gmail-viewer`
  (2026-06-11), commits `444fcad`…`bb8df03`. Plan →
  `docs/superpowers/plans/2026-06-11-integration-auth-substage2-credential-store.md`. 361 unit tests
  (344 + 17 new) + typecheck/lint green; touched files Prettier-clean. `check-foundation` = CLEAR
  (I3 held — all in `@atizar/server`, core only consumed; I5 reinforced — `registerResolver` seam;
  I7 aligned — secrets AES-encrypted at rest, never plaintext DB, apiKey env-only).
  - **As-built (all `@atizar/server`):** `credentials` table (drizzle, PK `(connection_id,
integration)`, `secret` = AES blob, `kind` plain text not enum, `expires_at` drives refresh) +
    migration `0001_*.sql`. `crypto.ts` — AES-256-GCM `deriveKey`(sha256→32B)/`encryptSecret`/
    `decryptSecret` (blob `base64(iv):base64(tag):base64(ct)`), pure (caller supplies the key).
    `credentialStore.ts` — `makeCredentialStore(db)` → `upsert`/`get`/`remove`, encrypt-on-write /
    decrypt-on-read; throws if `ATIZAR_SECRET_KEY` unset; **real-PG test asserts the raw column ≠
    plaintext** (encryption at rest). `oauthProviders.ts` — `oauthProvider('google')` auth/token URLs
    (beta ships google; one entry per provider). `resolveCredential.ts` — registry + built-ins
    (`none`→null, `apiKey`→`ATIZAR_<INTEGRATION>_API_KEY` env never stored, `oauth2`→load+decrypt,
    refresh-on-expiry via the provider token endpoint with 60s skew + persist + keep refreshToken,
    `null` when no row / refresh fails) + `registerResolver(kind, fn)` for custom kinds (the I5 seam —
    a custom kind plugs in WITHOUT editing core or this file); `store`/`fetchFn`/`now` injectable for
    tests. Barrel exports `resolveCredential`/`registerResolver`/`makeCredentialStore`/`oauthProvider` - types (NOT `crypto.ts` — internal). `.env.example` reworked to the single-source format
    (framework `ATIZAR_*` block + provider + google OAuth app + dev tooling).
  - **No consumer yet at sub-stage 2** (by design): sub-stage 3 (below) writes INTO the store via the
    OAuth connect flow; sub-stage 5 (gmail rewrite) consumes `resolveCredential`.
- **Sub-stage 3 — OAuth connect flow + Connections UI: ✅ BUILT & browser-verified (LIVE Google
  OAuth)** on `feat/gmail-viewer` (2026-06-11), commits `f991024`…`e3a617d`. Plan →
  `docs/superpowers/plans/2026-06-11-integration-auth-substage3-oauth-flow.md`. 380 unit tests +
  typecheck/lint/build green; built task-by-task via subagent-driven-development (each task: spec +
  code-quality review). `check-foundation` = CLEAR (I1 human gesture; I3/I5 routes/UI outside core,
  flow generic over `oauthProvider`, userland injects scopes/list; I7 consistent with sub-stage 2 —
  client secrets env-only, user tokens encrypted-at-rest, never plaintext).
  - **As-built — `@atizar/server`:** `oauthState.ts` (`signState`/`verifyState` — HMAC-SHA256
    `base64url(json).base64url(sig)`, anti-CSRF/tamper, key = `ATIZAR_SECRET_KEY`); `atizarEnv.publicUrl()`
    (default `http://localhost:5173`, the `redirect_uri` origin); `connectRoutes.ts`
    (`createConnectRoutes({ store, scopesFor, list, fetchFn? })`) — `GET /api/connect/:provider` (404
    unknown provider / 500 unconfigured client or missing secret key → else 302 to the provider auth
    URL with client_id, redirect_uri, scope, signed state), `GET /api/connect/:provider/callback`
    (verifyState → 400; form-encoded `authorization_code` exchange via injectable `fetchFn`; on ok →
    `store.upsert` an oauth2 blob byte-identical to `resolveCredential`'s reader — `{accessToken,
refreshToken, expiresAt:number ms}` — then 302 `?connected=`; non-ok → 302 `?connect_error=`),
    `GET /api/connections` (per-`list` `{integration, connection, provider, connected}`), `DELETE
/api/connections/:integration` (`store.remove`). Barrel exports `createConnectRoutes` +
    `ConnectRoutesDeps`/`ConnectionDescriptor`.
  - **As-built — app wiring:** `apps/inbox/server/connections.ts` (the app-side glue — `scopesFor`
    map `{gmail: ['…/auth/gmail.modify']}` + `connectionList` `[{gmail, default, google}]`; sub-stage 5
    replaces this hand-written list with the integrations' own `auth.scopes`); `index.ts` mounts
    `createConnectRoutes({ store: makeCredentialStore(db), scopesFor, list })` beside the pipeline
    routes. `claude-spawn.ts` got a load-bearing COMMENT: the child inherits `process.env` (spread),
    so `ATIZAR_*` reach MCP children automatically — a future env allow-list MUST keep forwarding them
    or credential resolution in MCP children breaks silently.
  - **As-built — `@atizar/react`:** `hooks/useConnections.ts` (fetch `GET /api/connections`,
    refetch on focus + strip `?connected=`/`?connect_error=` from the URL after the redirect lands,
    unmount-guarded like `useBoard`), `components/ConnectionChip.tsx` (presentational: not-connected →
    a real `<a href="/api/connect/:provider?…">` FULL NAVIGATION (an OAuth redirect can't happen in
    fetch); connected → `"<integration> ✓ <detail?>"` + a Disconnect `<button>`), `components/
Connections.tsx` (self-fetching panel; Disconnect = `DELETE` then `refetch`), wired into the
    `WorkflowBoard` header after `WorkflowSwitcher`. Reuses existing Smedja classes (`workflow-tabs`/
    `workflow-tab`/`btn btn-ghost`) — no `styles.css` edit. First `.test.tsx` in the package (RTL +
    happy-dom).
  - **Browser E2E (LIVE — real Google OAuth + real tokens, NOT replay):** (1) chip renders
    `gmail [Connect]` (not connected) with the correct href; (2) Connect → 302 → real Google login
    (the developer authenticated + consented to `gmail.modify`) → redirect back → chip flips to
    `gmail ✓` + the `?connected=` param is stripped from the URL (the useConnections fix, live);
    (3) the stored `credentials` row `(default, gmail)` = `kind oauth2`, `secret` an AES-GCM
    `iv:tag:ct` blob (NOT plaintext — encryption at rest), `expires_at` set; a one-off `resolveCredential`
    returned a LIVE `accessToken` (Google `tokeninfo` confirmed `scope=…/gmail.modify`); (4) Disconnect →
    `/api/connections` `connected:false`, the DB row removed (count 0), chip back to `[Connect]`. 0
    console errors in the verified flows.
  - **Honest scope note:** gmail still reads files until sub-stage 5, so this proves the connect FLOW
    (Connect → encrypted row → live token → Disconnect), NOT gmail consuming the stored token (that is
    sub-stage 5's E2E).
  - **Next = sub-stage 4** (skill auth interview). Plans for sub-stages 4 + 5 are written
    (`docs/superpowers/plans/2026-06-11-integration-auth-substage{4-skill,5-gmail-rewrite}.md`).
    **Keys live in `.env.local`** (`ATIZAR_SECRET_KEY` + Google Web client `ATIZAR_GOOGLE_CLIENT_ID/SECRET`,
    redirect `http://localhost:5173/api/connect/google/callback`); `set -a; . ./.env.local; set +a`
    before `yarn dev` (the server does not auto-load it yet).
- **Sub-stage 4 — write-integration auth interview: ✅ BUILT (docs-only)** on `feat/gmail-viewer`
  (2026-06-12), commits `877e0de`…this docs commit. Plan →
  `docs/superpowers/plans/2026-06-11-integration-auth-substage4-skill.md`.
  - **As-built:** the `write-integration` skill (`.claude/skills/write-integration/SKILL.md`) now
    enforces the auth contract — FACTS rewritten (auth is DECLARED via `auth: AuthSpec`, functions
    get `deps.credential`/`ResolvedCredential`, NEVER read `process.env`/files for secrets; open
    `AuthSpec.kind` with custom kinds shipping their own `CredentialResolver` via `registerResolver`
    in userland, never editing core; `ATIZAR_` env naming via `atizarEnv`; `.env.example` seeding;
    health = "does `resolveCredential` yield a usable credential?"); Stage 2 gained a MANDATORY
    auth-interview gate (stop-and-ask if auth is unclear — never guess); Stages 3/4 scaffold the
    `auth` export + append the secret block to `.env.example`; Stage 6 greps for no `process.env`/
    file secret reads. The gmail-viewer consumer skill's Credentials section + `docs/AGENTIC.md`
    reflect the contract (with an honest transition note — gmail-viewer still reads files until
    sub-stage 5). All cited symbols grep-verified against sub-stage 1–3 as-built.
  - **Next = sub-stage 5** (gmail rewrite via the updated skill = the end-to-end validation: delete
    the file-reading path, declare `auth`, consume `resolveCredential`, browser-E2E that gmail runs
    off the Connect-stored token).
- **Sub-stage 5 — gmail rewrite on the auth contract: ✅ BUILT & browser-verified (LIVE, both
  providers)** on `feat/gmail-viewer` (2026-06-12), commits `2443c2f`…`9245efe` (+ deletion `ba4d8a4`).
  Plan → `docs/superpowers/plans/2026-06-11-integration-auth-substage5-gmail-rewrite.md`.
  `check-foundation` = CLEAR. **The integration-auth track is COMPLETE** — end users connect Gmail via
  a button, tokens are stored encrypted, no hand-placed files.
  - **As-built:** ONE pure `@atizar/integrations/gmail` (merged basic+viewer) declaring
    `auth: oauth2/google/gmail.modify`, functions taking `deps.credential` (`ResolvedCredential`),
    NO file/env/`@atizar/server` reads (grep-proven). lead-inbox + email-inbox re-pointed: server
    effects + health resolve the credential server-side (`resolveCredential` + `atizarEnv.connection()`);
    Mastra read tools resolve in-process; `connections.ts` scopes derive from the integration's `auth.scopes`.
    Old gmail-basic/gmail-viewer DELETED; the consumer skill moved to `skills/gmail/`.
  - **Architectural decision (honoring "integration imports core only, never the store"):** the
    credential-resolving READ-ONLY MCP server lives in the APP (`apps/inbox/mcp/gmail-tools.mts`), NOT
    the integration package — it imports `@atizar/server` (resolveCredential/atizarEnv) and runs via
    the tsx loader (`node --import tsx`, since `@atizar/server` is `.ts`); it exposes ONLY the 3 read
    tools (no write tool — I2/I9). The integration package stays pure (no `@atizar/server` dep).
  - **Live browser E2E (real Google OAuth + real Gmail, both providers):** claude-cli — connect→chip✓;
    email-inbox sort+dispatch+batch-approve→REAL read/trash (verified, undone); lead-inbox qualifier
    read→handoff→reply→approve→REAL draft (verified by id, deleted); disconnect→agents "not connected".
    Mastra (in-process resolve) — connect; sorter read-in-process+dispatch+batch-approve→REAL star
    (verified, undone); qualifier read in-process. The Mastra reply→saveDraft is model-flaky on a spam
    email (known stage-3b, not a credential bug; createDraft effect is provider-agnostic, proven on
    claude-cli). All real Gmail mutations were UNDONE; the test token was disconnected at the end.
  - **`~/.gmail-mcp/` files are now UNUSED** by the framework (gmail reads the Connect-stored token).
  - **Dev reset commands (run from repo root; `resetCredentials`/`resetAll` added to `@atizar/server`):**
    `yarn workspace inbox db:reset` clears ONLY pipeline state (`work_items`/`gates`/`trace`/`action_ledger`)
    and **keeps the Gmail connection** — a state reset never logs you out (the encrypted `credentials`
    row survives every restart/hot-reload; tokens auto-refresh, so you reconnect only after one of these
    resets, an explicit Disconnect, a revoked token, or a changed `ATIZAR_SECRET_KEY`).
    `yarn workspace inbox db:reset:creds` truncates ONLY `credentials` (= Disconnect-all from the CLI).
    `yarn workspace inbox db:reset:all` wipes both (full data reset). None touches schema/migrations.
  - **Carried-over benign noise (pre-existing, not introduced here):** `WorkerPool.resumeAcquire`
    logs `IllegalTransition: cannot "start" from "running"` on resume — harmless (the effect runs via
    `observer.resume`; ledger confirms one execution). Already in the step-5/6 cheap-cleanup list.

### 🆕 ACTIVE TRACK (2026-06-12) — email-inbox Stage 4 UI chrome (Smedja Consumer Desktop v2)

By the user's call (un-parking Stage 4), the operator UI chrome is built from the user's Claude
Design handoff bundle (project `smedja`, file `Consumer Desktop v2.html` — fetched via the design
share link, README + 2 chat transcripts read for intent). The brief: a reusable **primitives**
layer (buttons + containers, extensible via props + className + tokens), **Trace/Activity log**,
the three **Stop** controls (item/workflow/all), and **Chrome-style workflow tabs**. Built into
`@atizar/react`, wired to REAL server data (not the prototype's Acme mocks).

- **✅ BUILT & browser-verified** on `feat/gmail-viewer` (2026-06-12). 386 unit tests +
  typecheck/lint/build green; live browser E2E (true replay, lead-inbox cassettes — mtimes
  unchanged). NOT committed yet.
  - **Primitives** (`packages/react/src/primitives/`, each spreads native attrs + merges
    `className`, all visuals via design tokens): `Button` (variants primary/teal/ghost/soft/danger/
    retry), `StopButton` (scope item/workflow/all + stopping spinner), `IconButton` (+badge+popover
    slot), `CompHeader` (the shared icon+label column header — Pipeline & Your agents render the SAME
    primitive so headers match), `Drawer`, `Modal`, `ConfirmDialog`, `Segmented`, `Switch`. Barrel +
    public exports from the package index.
  - **Components:** `AppHeader` (logo + menu + Chrome `WorkflowTabs` + Stop-all + Activity +
    Notifications + account) replaces the bare `WorkflowSwitcher`; `WorkflowTabs` (Chrome/Arc tabs,
    active fused to panel, attention badge on background workflows); `ActivityPanel` (operator feed +
    dev `?dev=1` Trace grouped-by-workitem) on a new `useActivity` hook (snapshot `/api/activity` +
    SSE `/api/activity/stream`, live/reconnecting chip); `NotificationsDropdown` (board-derived:
    pending approvals + failures); `PipelineColumn` rewritten to `CompHeader`+SVG connector + per-item
    `StopButton` (hover-reveal) + Stop-workflow in the header; `AgentCard` gained a credential-health
    line + START-disable (unhealthy or singleton-busy). `useDispatch` gained `cancelAll`. `WorkflowBoard`
    restructured to the `.app` shell (header + workspace-body + ActivityPanel + bulk-Stop ConfirmDialog).
  - **CSS:** package `styles.css` = the design's `styles.css` (canon — chrome tabs, stop, activity
    drawer, topbar, notif, settings, leads, history, mini/branch pipeline) + a retained app-blocks
    section (pl-\* instance tree, picker, intro/run-foot/thread-notes, approval-edit, triage,
    `awaiting_approval` status) the design lacks. Icon set extended ~20 glyphs (filled play/sparkle).
  - **Browser E2E (true replay):** board loads pixel-faithful to the design; **workflow tab switch**
    (Lead inbox ↔ Email inbox swaps agents); **Activity drawer** opens → Live chip → populates with
    REAL run events (START/running/finished) over SSE; **dev Trace** view groups by work item
    (monospace #seq/kind/summary); **single run** (replay) → pipeline mini-card "Working" + per-item
    Stop button appears, thread folds messages (no bubble split), URL persists `open` id; **health
    badge + START-disable** (email-inbox cards show "gmail: oauth2 credential required" + greyed START
    because gmail not connected); singleton START-disable re-enables on a done copy.
  - **NOT exercised live (honest):** the bulk-Stop **ConfirmDialog** + cancelAll/cancelWorkflow (replay
    finishes too fast to catch an enabled active state) — the wiring targets the verified
    `/api/cancel-all` + `/api/workflows/:id/cancel` and `ConfirmDialog` is a pure component; gate
    approve/reject through the new chrome (the replayed spam email didn't hand off → no gate this run,
    and approve hits real Gmail which wasn't connected) — the gate path (ThreadModal/useGate) is
    unchanged by this track.
  - **Present in the Smedja prototype but OUT OF SCOPE (NOT planned — do not build without an
    explicit request):** the collapsible rail + slide-out menu overlay (Inbox/Leads/Analytics/Settings
    nav); the Leads table + Analytics screens; the admin Manager/Admin toggle + agent prompt-editing;
    run-history inside the thread. The user scoped Stage 4 to: primitives, Activity/Trace log, the
    three Stop controls, workflow tabs — those only. Being in the design ≠ in scope.
    Pre-existing pipeline quirk surfaced (not new): a kept input agent shows "Working" in the pipeline
    even when its board item is `finished`, so its per-item Stop is a no-op on a done item.
  - **Revision round (user feedback, same day, re-verified in the browser):** stripped prototype-only
    chrome that maps to no real feature — the **account** ("Anna K."), **notifications** bell, and
    **menu/sidebar** button are GONE; the brand (logo mark + workspace name) is now a STATIC
    non-clickable element (no hover). **Gmail Connect moved into the header** (it is shared, not a
    per-agent concern) and is now a real **Button** from the `.btn` system (`btn-soft`/`btn-sm`), not a
    bare link. **Fixed the "connected but cards still say not-connected" bug** — the board snapshot's
    `agentHealth` is a BOOT cache that goes stale on connect/disconnect; new `useHealth` hook fetches
    `GET /api/health` on mount + window focus (the OAuth redirect lands on focus) and the cards prefer
    it. **Legend markers** now render (a bare `.dot` was only sized inside `.status`; sized it for the
    legend). **Per-item Stop is right-aligned always** (name column flexes; the Stop gets
    `margin-left:auto`) — no longer drifting with name length. **All three Stop scopes now confirm via
    the modal** (item too, not just bulk) — the `ConfirmDialog` primitive. Re-verified live: header
    clean + brand static; gmail ✓/Disconnect in header; Email-inbox cards show NO not-connected error
    (health fresh); legend dots colored; per-item Stop → "Stop this item?" confirm modal. `useHealth`
    exported; `NotificationsDropdown` deleted.
  - **Connection chip (2nd feedback pass):** the loose `gmail ✓ Disconnect` labels were replaced by
    ONE cohesive pill (`.conn-chip`: surface + border + pill radius; a status dot [green connected /
    grey not] + integration name + a real `.btn btn-soft btn-sm` button inside). Connect is an `<a>`
    (OAuth needs a full navigation) styled with the same `.btn` system. Browser-verified.
  - **Activity log (3rd feedback pass):** the "↓ New events" jump button is REMOVED entirely
    (`act-jump` / `jumpLatest` gone); auto-follow stays, scrolling up just pauses it. `.act-jump` CSS
    is now dead (harmless, not cleaned).

> **CONTINUATION NOTE (2026-06-12, after Stage 4 chrome) — for the next agent.** Stage 4 chrome is
> **committed `c3b4aa5` and PUSHED to `origin/feat/gmail-viewer`** (new remote branch; PR not opened).
> Built into `@atizar/react`: 9 primitives (`primitives/`), `AppHeader`/`WorkflowTabs`/`ActivityPanel`,
> `useActivity`/`useHealth`, rewritten `PipelineColumn`/`AgentCard`/`ConnectionChip`. NOT merged
> (same branch strategy). The dev server may still be running (`:4000`/`:5173`); a `db:reset` was run
> so the board is clean (creds kept — gmail stays connected).
>
> - **SCOPE DISCIPLINE (the user was emphatic):** Stage 4 = ONLY primitives + Activity/Trace log +
>   the three Stop controls + workflow tabs. The Smedja prototype ALSO contains a rail/slide-out menu,
>   a Leads table, Analytics, admin prompt-editing, account/notifications — these are **OUT OF SCOPE,
>   NOT planned**. Do NOT build them, and do NOT list them as follow-ups. Design-present ≠ in scope.
>   (Account/notifications/menu were stripped from the header for this reason.)
> - **OPEN VERIFICATION GAPS — ✅ ALL CLOSED (2026-06-12, live browser E2E, `DEV_RECORD_REPLAY=record`,
>   real claude + real Gmail).** Verified in the browser: (a) lead-inbox gate **approve WITH an edited
>   body** (textarea set to insert `[E2E-EDIT-MARKER-7Q3Z]`, Save draft) → item `finished`, gate
>   `resolved`, action_ledger ONE row `{ok:true,draftId}`, and the **real Gmail draft fetched by id
>   contained the edited marker** (test draft then deleted); (b) lead-inbox gate **reject** → item
>   `finished`/`rejected`, gate `resolved`, **0 ledger rows**; (c) **Stop workflow** AND **Stop all** on
>   a genuinely live multi-item **email-inbox** state (sorter machine-dispatched reader/spam children, 2–3
>   items Working/awaiting_approval) → the right **ConfirmDialog** appeared each time ("Stop this
>   workflow?" / "Stop all workflows?"), confirm cancelled the cascade (all items `finished`/`cancelled`,
>   0 active after, **0 ledger rows** so no Gmail mutation executed — items were cancelled at the gate
>   pre-approve). The per-item Stop confirm modal was already browser-verified. New chrome (AppHeader,
>   WorkflowTabs, Connect chip→Disconnect, gate ApprovalDialog, board SSE live multi-item updates)
>   exercised throughout. **Stage 4 is now fully done.**
>   - **Two environment notes for the next agent (cost me time, save yours):** (1) the dev server does
>     NOT auto-load `.env.local` — start it `set -a; . ./.env.local; set +a && DEV_RECORD_REPLAY=record
yarn dev`, else `ATIZAR_SECRET_KEY` (credential decryption) + the Google OAuth client vars are
>     absent and EVERY gmail flow fails (boot `health` may still print lead-inbox "ok" — that probe does
>     not match runtime credential resolution; trust an actual run). (2) Gmail credential did NOT survive
>     from the chrome session — the `credentials` table was empty; reconnect via the header **Connect**
>     chip (interactive Google consent, the user's account; stored server-side in Postgres so any browser
>     works). (3) Handoff **dedup-by-source**: the qualifier always reads the SAME latest email, so a
>     second lead-inbox run's "Draft reply" is deduped (no child) until you `yarn db:reset` (clears the
>     prior child's source; preserves creds).
> - **Known pre-existing quirk (not Stage 4's bug):** a kept input agent shows "Working" in the
>   pipeline even when its board item is `finished` (the pipeline forces kept-input-as-Working), so its
>   per-item Stop is a no-op on a done item. Fixing means deriving the pipeline leaf status from the
>   real board item, not the forced view.
> - **Then:** resume **sub-step 7c** (packaging tail) below — the original beta roadmap.

### 🆕 ACTIVE TRACK (2026-06-12) — sub-step 7c (packaging tail), on `feat/7c-packaging`

7c was decomposed into **6 independent sub-projects** (each its own spec→build cycle, committed
onto `feat/7c-packaging`, branched off `feat/gmail-viewer`): **A** cheap cleanups · **B** zero-cred
`DEMO=1` mode (mock provider + PGlite + SYNTHETIC cassettes + scanCassette CI gate) · **C** bearer
token on the 6 mutating routes · **D** golden-set eval + the two step-6 follow-ups · **E**
`@atizar/*` scope rename (needs the final scope name) · **F** README 10-min script + LICENSE
(user's call, recommend MIT). Order A→B→C→D→E→F (rename late to avoid churn; docs as capstone).

- **Sub-project A — cheap cleanups: ✅ BUILT & browser-verified** (2026-06-12, commit `d746a68`).
  - **A1 — dev `.env.local` autoload:** `apps/inbox/server/load-dev-env.ts` (dev-only side-effect,
    FIRST import in `index.ts`) walks up to the repo-root `.env.local`, parses `KEY=VALUE` via the
    pure tested `parse-env.ts`, sets only vars not already present (CLI wins), skipped under
    `NODE_ENV=production`. **The `set -a; . ./.env.local` footgun is GONE** — plain `yarn dev` (and
    `PROVIDER=mastra yarn dev`) now resolves ATIZAR\_\* creds/OAuth. (The doc env-note above is
    superseded for the dev server; the `db:reset`/one-off `tsx -e` scripts still need manual
    sourcing — they don't import `index.ts`.)
  - **A2 — quiet `resumeAcquire`:** `WorkerPool.resumeAcquire` now only reserves the slot
    (`active++`), no longer calls `opts.run` — the resume stream is driven by `runObserver.resume`
    via `consume()`; the old `run` re-issued `transition('start')` on an already-`running` item,
    logging a benign `IllegalTransition: cannot "start" from "running"` on every resume.
  - **Verified:** 392 unit tests + typecheck + lint green; live browser E2E (record mode) —
    `[dev] loaded 6 var(s)` + health 11/11 ok with plain `yarn dev`, and lead-inbox approve→resume
    produced **0 IllegalTransition** (ledger `{ok,draftId}`; test draft deleted). Observed but NOT
    chased (unrelated to A, pre-existing replay artifact): the qualifier `renderVerdict` card does
    not reconstruct under `DEV_RECORD_REPLAY=1` replay though `renderVerdict` is in the trace — real
    claude renders it fine; worth a look during the D eval pass.
- **Sub-project B — zero-cred `DEMO=1` mode (email-inbox only): ✅ BUILT & browser-verified**
  (2026-06-12, commits `8b8993a`…`<head>`; spec `docs/superpowers/specs/2026-06-12-demo-mode-zero-cred-design.md`,
  plan `docs/superpowers/plans/2026-06-12-demo-mode-zero-cred.md`). Built subagent-driven (impl +
  spec-review + quality-review per task + a final holistic review). 400 unit tests + typecheck +
  lint + build green.
  - **As-built:** `isDemo()` (standalone, unprefixed `DEMO`, sibling of `DEV_RECORD_REPLAY`, in
    `@atizar/server` env.ts) gates everything. **DB:** `client.ts`/`migrate.ts` select an
    in-memory **PGlite** (`drizzle-orm/pglite`, lazy optional peer `@electric-sql/pglite`) vs
    postgres-js at module load; same dialect → migrations unchanged; `Db` stays the single
    postgres-js type (pglite cast). **Provider:** new strict `'demo'` mode in `record-replay.ts`
    reads COMMITTED synthetic cassettes from `apps/inbox/demo-cassettes/` and throws
    `DemoCassetteMissing` on a miss (never calls the real provider); `build-agent.ts` selects it.
    **Effects:** email-inbox `saveDraft`/`applyActions` return demo fake-success (no Gmail);
    `applyActions` reads `form.items` (the real key). **Server:** `apps/inbox/server/index.ts`
    filters registration to email-inbox in demo (`activeWorkflowServers`), adds `GET /api/config`
    `{demo,workflows}`, and short-circuits `computeAgentHealth` to all-ok in demo (so START isn't
    disabled by the no-cred/no-binary probes). **Client:** `App.tsx` fetches `/api/config`, filters
    tabs, passes `demo` → `WorkflowBoard`/`AppHeader` hide the Connect chip. **Safety:**
    `demo:scan-cassettes` runs `scanCassette` over `demo-cassettes/` (reserved-TLD `.example` emails
    exempt; real PII still caught) — wire into CI when CI lands (none exists yet). **Scripts:**
    `yarn workspace inbox demo` (= `DEMO=1` server+client); `predev` skips Postgres in demo.
  - **Browser E2E (DEMO=1, Postgres STOPPED, zero creds):** only the Email-inbox tab + no Connect
    chip + START enabled; START sorter → 4-child machine-dispatch fan-out; approve a batch gate
    (SPAM trash) → fake success → finished + narration; approve reply gate → finished + demo
    draftId narration; reject (READER) → finished/rejected; Stop workflow → ConfirmDialog → all
    cancelled (0 active). PGlite migrate-on-boot, no Docker.
  - **Final-review bug fixed (the test-masked one):** `demoApplyActions` read `form.actions` (always
    `applied:0`); now reads `form.items` and the test asserts the real shape + `byAction`.
  - **Carry-overs for later sub-projects:** the demo `demo` script lives in the `inbox` workspace —
    add a ROOT `yarn demo` alias in the README pass (sub-project F); wire `demo:scan-cassettes` into
    CI when CI is set up (F); `App.tsx`'s `/api/config`-failure fallback shows all workflows
    (non-fail-safe but unreachable in a live demo) — tidy in F if desired.
- **Sub-project C — bearer token on mutating routes: ✅ BUILT & browser-verified** (2026-06-12,
  commits `6012271`…`4877ff9`; spec `docs/superpowers/specs/2026-06-12-bearer-token-mutating-routes-design.md`,
  plan `docs/superpowers/plans/2026-06-12-bearer-token-mutating-routes.md`). Built subagent-driven
  (server slice + client slice, each with spec-review + quality-review). 417 unit tests + typecheck
  - lint + build green.
  * **As-built — server:** `atizarEnv.authToken()` reads the official `ATIZAR_AUTH_TOKEN`. New
    `packages/server/src/auth.ts` `createAuthMiddleware({ token, demo })` — gates by HTTP METHOD
    (all non-GET = mutation), active ONLY when `!demo && token set`, else fail-open; mismatch/missing
    `Authorization: Bearer <token>` → 401. Method-based (not a path list) so all 7 mutating routes
    (dispatch/deliver/resolve/cancel×3/cancel-all + `DELETE /api/connections`) AND any future one are
    covered; GET/SSE stay open. Mounted in `apps/inbox/server/index.ts` via `app.use('*', …)` BEFORE
    both route factories; `boot()` logs `[auth] disabled — set ATIZAR_AUTH_TOKEN …` when `!demo && no
token`. Demo mode → middleware inactive (one-command demo preserved).
  * **As-built — client:** package stays env-agnostic — `WorkflowsConfig.authToken?` carries the
    token; new `authHeaders(token?)` helper merges `Authorization: Bearer …` into every mutation
    fetch (`useDispatch` ×5, `useGate.resolve`, `Connections` disconnect); reads via
    `useWorkflowsConfig()`. **`WorkflowBoard` split** into a thin provider wrapper + `BoardInner` so
    the body hooks (`useDispatch`/`useBoard`/…) sit INSIDE the provider (fixed a latent
    out-of-context call). `useGate.resolve` now throws on non-409 failure (a 401 is no longer a silent
    false-success). Demo app sources the token from `VITE_ATIZAR_AUTH_TOKEN` (vite/client ref lives in
    `vite-env.d.ts`).
  * **`resolved_by` stays null** (shared token = no per-user identity; per-identity = post-beta;
    `runObserver.ts` comment corrected).
  * **Browser E2E (all verified):** (1) plain `yarn dev`, no token → board renders (the split didn't
    break the provider/context), `[auth] disabled` logged, START → fail-open 200 → run to Done, lead
    text one bubble; (2) `ATIZAR_AUTH_TOKEN=sek`+`VITE_ATIZAR_AUTH_TOKEN=sek` → no warning, server gate
    matrix (curl) 401 no-header / 401 wrong / 200 right / 200 GET, real-UI START carries the token &
    succeeds, in-browser fetch matrix 200/401/401; (3) `yarn workspace inbox demo` → email-inbox only,
    cancel-all no-token → 200 (middleware inactive), sorter machine-dispatch fan-out, **approve** SPAM
    batch gate → `finished` + "applied successfully" narration, **reject** READER → `finished`/`rejected`
    (both `useGate.resolve` paths through the real gate UI, fake effect, no Gmail). NOT browser-driven:
    a real wrong-token client rebuild (covered by the in-browser fetch 401 matrix + the unit suite).
- **Sub-project D — golden-set eval harness + two step-6 follow-ups: ✅ BUILT & browser-verified**
  (2026-06-13, commits `e6fb0e0`…`<head>`; spec `docs/superpowers/specs/2026-06-13-golden-set-eval-design.md`,
  plan `docs/superpowers/plans/2026-06-13-golden-set-eval.md`). Built subagent-driven (impl per task +
  an independent spec-review on the load-bearing runner). `check-foundation` = CLEAR. 414 unit tests
  (`yarn test`) + 5 golden-eval tests (`yarn eval`) + typecheck/lint/build green.
  - **As-built — the harness (structural-on-replay, decided with the user):** `apps/inbox/eval/runner.ts`
    builds a REAL `PipelineService` exactly as `server/index.ts`'s composition root does, but under
    `DEMO=1` (in-memory PGlite + the `demo` cassette-replay provider reading `apps/inbox/demo-cassettes/`)
    and with each agent's server effects REPLACED by credential-free fakes that LOG every call (the eval
    asserts on the log, never touches Gmail/GitHub or the ledger table). `buildEvalService()` loops
    `workflowServers`; `runGolden(scenario)` dispatches ONE entry agent, polls `getBoard()`, records gate
    facts AT resolution time (board returns only OPEN gates), auto-approves (or runs the scenario's
    `gateScript`), and returns `{ items, gates, effects }` once no item is active. Asserts STRUCTURE only
    (tree topology, gate kind/toolName/form-keys, statuses + `resolution` markers, effect-fired count) —
    NOT the LLM's prose. **No LLM-judge** (post-beta).
  - **As-built — scenarios & fixtures:** synthetic share-safe lead-inbox cassettes authored
    (`demo-cassettes/lead-inbox__{qualifier,reply}.jsonl`, invented `.example` data, `demo:scan-cassettes`
    clean). `scenarios/lead-inbox.ts` (3: reply-approve → saveDraft gate `[threadId,body]` + effect fires
    once + finished; qualifier → VerdictCard, no gate, finished; reply-reject → finished/`rejected`, zero
    effects) + `scenarios/email-inbox.ts` (1: sorter machine-dispatches 4 children — reader/spam/important
    via `applyActions`+`items`, reply via `saveDraft` — a batch `applyActions` gate opens, approve fires the
    fake effect, sorter finished; CONTAINS-not-equals gate asserts since the fan-out opens multiple gates).
    `yarn eval` = a SEPARATE vitest config (`vitest.eval.config.ts`, `env.DEMO=1`, glob `*.eval.ts`) — NOT
    in `yarn test` (process-global env can't be both PGlite-DEMO and the test-Postgres in one run); **CI runs
    BOTH `yarn test` and `yarn eval`.**
  - **As-built — F1 (observable 3-at-once cap):** `apps/inbox/eval/cap.eval.ts` injects a BLOCKING `Provider`
    (parks `run()` on a controllable promise so slots stay held — a replayed cassette streams instantly and
    can't show the cap), dispatches 3 for a `maxInstances:2` agent (`origin:'agent'`), asserts `{active:2,
queued:1}` mid-flight, releases, then drains to `{active:0,queued:0}` (the queued 3rd auto-started). Closes
    the step-6 honesty gap (was only fast-replay integration-tested).
  - **As-built — F2 (cross-workflow "Treat as lead → Lead inbox"): BROWSER-VERIFIED LIVE.** `DEV_RECORD_REPLAY=record`,
    ran github-triage triage live (read-only board, 12 real tickets rendered with "Treat as lead → Lead inbox"
    buttons); clicked it → board API showed a `lead-inbox__qualifier` child with `parentId` = the triage item,
    running; the lead-inbox pipeline UI showed the child "Working"; the triage parent reopened to running
    (finish-vs-dispatch reopen). Proves `resolveDelivery`/`deliveryKey` + `POST /api/deliver` live (was only
    integration-tested). Screenshot: `7c-D-F2-cross-workflow-handoff.png` (repo root). The recorded
    `github-triage__triage.jsonl` + refreshed `lead-inbox__qualifier.jsonl` stay GITIGNORED in `.cassettes/`
    (real board + Gmail data — NEVER committed). **Observed (NOT a 7c-D bug):** the live triage run logged a
    trailing `Provider error: claude run timed out` at the tail AFTER rendering the card + summary (a long
    12-ticket real run hits the claude-cli timeout); the item still finalized Done and the card was fully usable.
  - **github-triage deterministic golden scenario = SKIPPED (stretch, decided):** triage is covered by the F2
    browser verify + the existing `pipelineService.deliver` integration test; a synthetic triage cassette adds
    marginal value over the board-read-surfacing risk. No silent gap — stated here.
- **Sub-project E — `@platform/*` → `@atizar/*` scope rename: ✅ BUILT** (2026-06-13; spec
  `docs/superpowers/specs/2026-06-13-platform-scope-rename-atizar-design.md`). The user chose the final
  brand scope **`@atizar`**. Global `@platform/` → `@atizar/` sweep over **162 tracked files** (5 package
  `name`s, `apps/inbox` 5 workspace deps + 4 `db:*` script import strings, ~101 code imports, all `.md`
  docs **including the protected `ARCHITECTURE.md`/`PHILOSOPHY.md`** — user explicitly authorized the
  protected-doc edits; verified the only changed lines there are the cosmetic name swap, no invariant
  meaning changed → `check-foundation` = CLEAR). `exports` subpath keys (`./gmail/*`, `./db/schema`,
  `./styles.css`) and configs (drizzle/tsconfig/vite/vitest) were untouched (relative paths). `yarn install
--ignore-engines` relinked `node_modules/@atizar/*` (the `node_modules/@platform` symlinks are gone). The
  rename spec keeps the literal `@platform` (it documents the transition). Zero `@platform` left in tracked
  files. **Green:** typecheck + lint + `yarn test` 414 + `yarn eval` 5 + build. CLAUDE.md's stale
  "placeholder scope" line corrected (now "final scope, renamed at 7c-E; all five packages extracted").
- **Sub-project F — packaging tail: ✅ BUILT (substantive items done; one optional deferred)** (2026-06-13).
  README + LICENSE were already authored by the user. (1) **DONE** — root `yarn demo` alias added
  (`"demo": "yarn workspace inbox demo"`, commit `260d130`) so the README's one-command story works.
  (2) **N/A** — `demo:scan-cassettes` into CI: no `.github/workflows` / CI config exists in the repo, so
  there is nothing to wire (do NOT fabricate a CI config; add the hook if/when CI lands). (3) **OPTIONAL,
  NOT done** — `App.tsx`'s `/api/config`-failure fallback shows all workflows (non-fail-safe but unreachable
  in a live demo, since the config fetch is same-origin and always succeeds); left as a tiny future tidy.
  **This completes the 7c packaging track and the beta build order (steps 1–7).**

> **CONTINUATION NOTE (2026-06-13, after 7c-A + 7c-B + 7c-C + 7c-D + 7c-E) — read me first, next agent.**
> The 7c track is being built on **`feat/7c-packaging`** (branched off `feat/gmail-viewer`; NOT
> merged — keep building on it, same long-lived-branch strategy as prior tracks). **A + B + C + D + E are ✅
> done** (A: dev `.env.local` autoload + quiet `resumeAcquire`; B: zero-cred `DEMO=1`; C: bearer token on
> mutating routes; D: golden-set eval harness + the two step-6 follow-ups; E: `@platform/*` → `@atizar/*`
> final-scope rename — see the as-built bullets above). **Only F remains.** Latest state:
> **414 unit tests (`yarn test`) + 5 golden-eval tests (`yarn eval`) + typecheck + lint + build green**
> (the prior "417" figure was a stale hand-count; 7c-D's diff deletes zero existing `.test.ts` — the
> 5 eval tests run under the separate `yarn eval` config); Postgres is UP; no dev server should be
> running (the session ended with the stack killed + ports free).
>
> - **⚠️ README + LICENSE are ALREADY DONE — do NOT author them.** By the time you start, the
>   **README and the LICENSE file are already filled in** (the user is handling them). Treat the
>   README/LICENSE pieces of sub-project F as COMPLETE. **F therefore reduces to:** (1) a ROOT
>   `yarn demo` alias (today the demo script lives only in the `inbox` workspace —
>   `yarn workspace inbox demo`; add a root `"demo": "yarn workspace inbox demo"` so the README's
>   one-command story works) — NOTE 7c-C documents `ATIZAR_AUTH_TOKEN`+`VITE_ATIZAR_AUTH_TOKEN` for a
>   token-protected deploy, so the README's auth story should match; (2) wire `demo:scan-cassettes`
>   into CI **if/when** a CI config exists (none exists today — do not fabricate one); (3) optional tidy
>   of `App.tsx`'s `/api/config`-failure fallback (currently shows all workflows — non-fail-safe but
>   unreachable in a live demo). If the already-written README references a command/flag that differs
>   from what's built, ALIGN THE CODE to the README (or flag the mismatch to the user).
> - **Build order = F only (C, D, E are done).** Each sub-project = its own brainstorm→spec→plan→build
>   cycle (the user chose subagent-driven execution for B/C/D — ask which approach for each). Run
>   `check-foundation` on anything touching actions/providers/`@atizar/core`/the framework-userland
>   boundary. **F is mechanical** (root `yarn demo` alias + CI hook if CI lands + optional App.tsx tidy).
>   START AT F. E renamed the scope to `@atizar/*` (see the 7c-E as-built bullet above).
> - **D — golden-set eval + two step-6 follow-ups: ✅ DONE** (see the 7c-D as-built bullet above). The
>   harness (`apps/inbox/eval/`, `yarn eval`) covers lead-inbox (3) + email-inbox sorter fan-out (1) on
>   committed synthetic cassettes; F1 (observable cap) is `cap.eval.ts`; F2 (cross-workflow handoff) was
>   browser-verified live. github-triage deterministic scenario skipped (stretch — covered by F2 + the
>   deliver integration test).
> - **E — `@atizar/*` scope rename:** ~130 files grep/replace + 5 package.json `name`s. **NEEDS the
>   final scope name from the user** (ask before starting). Do it LATE/isolated (touches everything).
>   If the already-written README uses the final scope name, that name is your target.
> - **Env/ops gotchas proven this session (save yourself the rediscovery):**
>   (a) the dev server now AUTO-LOADS `.env.local` (7c-A) — plain `yarn dev` resolves ATIZAR creds; the
>   one-off `tsx -e` scripts (`db:reset` etc.) do NOT autoload (they don't import `index.ts`) — source
>   env manually for those if they need a secret.
>   (b) DEMO uses in-memory PGlite — a demo restart resets the board (intended); query demo state via
>   the API, NOT `docker exec … psql` (that's the non-demo Postgres).
>   (c) handoff **dedup-by-source**: the qualifier reads the same latest email each run, so a 2nd
>   lead-inbox "Draft reply" is deduped (no child) until `yarn db:reset` (preserves creds).
>   (d) `yarn demo` lives in the inbox workspace, not root (until F adds the root alias).
>   (e) the implementers ran typecheck+tests but NOT lint per task — **run `yarn lint` before each
>   commit** (a `require-yield` error slipped to the final green check this session).
>   (f) Gmail OAuth credential does not always survive across sessions — if a non-demo gmail flow
>   reports "no credential", reconnect via the header Connect chip; demo needs no creds at all.
>   (g) **Stale-stack bit me in 7c-C (the browser-verify #1 footgun, confirmed):** switching dev modes
>   between cycles, the prior `yarn dev` kept `:4000` → the next server hit `EADDRINUSE` and the OLD
>   one answered (`/api/config` showed the wrong `demo` flag). The `.bin/(tsx|vite)` pkill MISSES the
>   `tsx watch` child; what reliably frees it: `pkill -9 -f "tsx watch server/index.ts"` +
>   `for p in 4000 5173 5174; do lsof -tiTCP:$p | xargs kill -9; done`, then confirm ports free BEFORE
>   restart. (h) **To browser-test the bearer token (7c-C):** set BOTH `ATIZAR_AUTH_TOKEN` (server) and
>   `VITE_ATIZAR_AUTH_TOKEN` (client) in the SAME `yarn dev` invocation — Vite reads `VITE_*` from the
>   process env, so one command sets both; the in-browser fetch matrix (`fetch('/api/cancel-all',{method:'POST',
headers:{Authorization:'Bearer …'}})` via Playwright `browser_evaluate`) proves the gate without a
>   client rebuild.

**Starting point for the next session = beta build order step 7, sub-step 7c** (slim demo +
packaging tail). Steps 1–6 + **sub-step 7a (`@atizar/server`, commits `6713ba9`…`e7123e5`)** +
**sub-step 7b (`@atizar/react`, commits `ea64d0e`…`e61dd1e`)** are ✅ BUILT & browser-verified on
`feat/provider-contract-v2` (NOT merged — same branch strategy). Both extractions done: the
framework/userland boundary is now physical for BOTH the server spine and the board/thread UI; the
demo app consumes only `@atizar/{core,providers,integrations,server,react}` + its own
workflows/cards. **7c = the packaging tail**
(mechanical folder moves — the import discipline held: `server/pipeline/` imports only `@atizar/*`

- its own folder; the new client hooks/components import only `@atizar/*` + each other). The
  `@atizar/react` boundary + beta component inventory + styling decisions are in the anticipated-
  decisions block above. Then: zero-cred demo (`DEMO=1` → PGlite + mock provider + SYNTHETIC cassettes,
  scanCassette CI gate), README 10-minute script, **LICENSE (ask the user — recommend MIT)**,
  `@atizar/*` scope rename, golden-set eval per workflow, shared bearer token on mutation routes.
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
  provider is `@atizar/providers/mastra-*`.

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
`@atizar/core`) — the number of human approvals already resolved, so HITL's multi-request
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
**published contract**. Highlights: `@atizar/core` `defineWorkflow` + `instanceId` +
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

1. Vertical slice + reusable **`@atizar/core`** layer (message layer, `Provider` contract,
   `defineAgent` passport). — §1
2. **`claude-cli` provider** — runs the real `claude` CLI as a subprocess behind the `Provider`
   seam; HITL = detect-tool-call-and-kill + stateless re-prime resume. — §2
3. **Gmail draft integration** — our own thin stdio Gmail MCP; reads latest email → draft reply on
   approval (never sends). — §3
4. **Two agents + manual handoff** (`56f07d0`) — LEAD QUALIFIER (only reader) → REPLY AGENT
   (writer); `handoff.ts` is the pure encode/decode seam; per-agent MCP allow-list = hard boundary. — §4
5. **`@atizar/*` package split** — `core` + `providers` + `integrations` as yarn-classic
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

1. **Finish the split — `@atizar/react` + `@atizar/server` extraction (deferred):** the
   client React layer and the Hono/BFF + spawn server layer still live in `apps/inbox/`. Extract
   when the app/framework boundary settles. The `@atizar/*` scope is a **placeholder** — rename
   before any npm publish.
2. **Multi-provider / Mastra** (can interleave): add a `mastra` (or `claude-api`) factory beside
   `claude-cli` behind the existing `Provider` seam in `@atizar/providers` — no seam change
   needed. Needs an API key.
3. _Polish (cosmetic, deferred):_ the model still narrates a bit ("I'll load the tool schemas…")
   AND the verdict prints as plain markdown paragraphs in the modal alongside the card — strip
   pre-tool / duplicate chatter client-side or via prompt. Tighten Gmail scope
   `gmail.modify`→`readonly`+`compose`.
