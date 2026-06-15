# Handoff — where we are & what's next

Living session state: **current status + the next thing to build.** Stable project context lives
elsewhere — read those first: `CLAUDE.md` (conventions, gotchas, decisions, commands),
`docs/ARCHITECTURE.md` (vision + invariants I1–I15), `docs/PHILOSOPHY.md` (the three beliefs),
`docs/BUILD-LOG.md` (full chronological build history). **Keep this file SHORT** — when a track
finishes, its detail belongs in BUILD-LOG / git, and this file shrinks back to "where we are + next".
(It was last reset 2026-06-15 from a 1485-line accretion — the old content is in git history.)

---

## ✅ Where we are (2026-06-15)

The framework **beta is built and on `origin/master` (`545cf51`, pushed).** Packages:

- `@atizar/core` — isomorphic contract (`defineAgent`/`defineWorkflow`, messages, providers contract,
  `aggregateHealth`, gate/fold helpers). No React, no Node.
- `@atizar/providers` — `claude-cli`, `mastra`, `mock` providers + `makeMastraRunner` + the typed
  `PROVIDERS`/`ProviderId` (client-safe subpath `@atizar/providers/ids`).
- `@atizar/server` — Hono pipeline on Postgres (StateStore/transition/dispatch/WorkerPool/RunObserver),
  record/replay, `createServer` factory, `makeClaudeSpawn`, `buildAgentProvider`, audit log, auth.
- `@atizar/react` — board/thread UI, hooks (`useBoard`/`useWorkItemThread`/`useGate`/`useDispatch`/
  `useActivity`), primitives (CardShell, Markdown, SourcePanel…), the workflow-scoped render registry.

Demo app `apps/inbox/` consumes ONLY the public packages. Three workflows ship today:
**email-inbox**, **lead-inbox**, **github-triage**.

**Completed recently** (detail in git + `docs/superpowers/plans/`):

- **7c packaging tail** — `DEMO=1` zero-cred mode (mock provider + PGlite + synthetic cassettes),
  bearer-token auth on mutating routes, golden-set eval harness, `@platform/*`→`@atizar/*` scope
  rename, README + LICENSE. All done.
- **Re-run + trust/UX + library-boundary — 7 work-streams** (autonomous run, this session, done &
  pushed; spec `docs/superpowers/specs/2026-06-14-rerun-and-trust-ux-design.md`):
  WS4 activity newest-first · WS3 markdown render (safe, no raw HTML; protocol-relative-URL block) ·
  WS5 SourcePanel + incoming user-turn + SSE-reconnect chips + durable `audit_log` · WS2 render/HITL
  registry scoped per `(workflowId, toolName)` · WS6 typed `PROVIDERS` + per-workflow tool/card
  consts · WS1 re-run semantics (a re-START **supersedes** the prior finished scan into history,
  open-scoped dedup, "Working" mislabel fixed, `rerun: 'refresh'|'history'` knob) · WS7 app→library
  migration (machinery moved to `@atizar/server`/`@atizar/providers`/`@atizar/core`; app shell is thin).

**Green gate:** `yarn typecheck && yarn test` (**528 passed**) `&& yarn lint && yarn format:check &&
yarn workspace @atizar/react build`. `master` == `origin/master`.

---

## ⏭️ NEXT — cleanup → minimal demo → extensibility (brief for a FRESH agent)

**The user wants this next track done with a DIFFERENT agent** — this section is their brief. Their
goal, in their words: trim the demo to ONE workflow so they can read clean code; **kill the magic
strings** and make the framework genuinely extensible (incl. prompts in multiple languages); add
board cleanup (a **Reset**, and drop finished scans); run a **REAL flow** and record fresh cassettes;
re-check the library/userland boundary; bring the **client code to proper standards** and WRITE those
standards into the project docs; and capture "how to add a workflow" as an **`add-workflow` skill**.

Suggested order below — mostly independent, but **1 first** gives a clean base for the rest, and
**7 is the capstone**. Every task: brainstorm if it's a design choice → TDD via subagents → green
gate → **browser-verify** → `check-foundation` for the foundation-touching ones → merge to `master`
(no PR — beta) → update this block. Read `CLAUDE.md` "Don't-rediscover gotchas" first.

### 1. Trim the demo to email-inbox ONLY

Delete the `lead-inbox` and `github-triage` workflows + every file only they use, leaving a single
clean **email-inbox** as the reference workflow. **Care:** email-inbox REUSES the reply agent + some
cards (LeadCard/ApprovalDialog) — trace dependencies before deleting so email-inbox still runs.
Likely removals: `apps/inbox/workflows/{lead-inbox,github-triage}/`; the agent prompts only they use
(`agents/qualifier.prompts.ts`, `triage.prompts.ts`, `ticket.prompts.ts` — KEEP `reply.prompts.ts` if
email-inbox's reply agent uses it); cards only they render (VerdictCard / TriageCard / TicketResultCard
/ ReplyDraftCard — verify each); `mcp/github-tools.mjs`; the github tool defs in `mastra/tools.ts`;
and their entries in the three aggregators (`workflows/index.ts`, `server/workflows.ts`,
`client/src/workflows.ts`). Green gate + browser-verify email-inbox end-to-end after.

### 2. Magic-strings + extensibility refactor — incl. i18n prompts (FOUNDATION-TOUCHING)

**The user's core complaint:** too much is raw strings; this blocks extensibility (e.g. prompts in
different languages). WS6 typed `provider` + tool/card NAMES but left these raw (audited 2026-06-15):

- **Workflow-id literals on the client:** `client/src/workflows.ts` (`scope('lead-inbox', …)` etc.)
  and the cross-workflow deliver target in `github-triage/client.tsx` (`workflow: 'lead-inbox'`).
- **Read-tool names NOT through consts** in lead-inbox/email-inbox descriptors
  (`readonly: ['get_latest_email']`, `['list_unread']`, `['get_email']`) — github-triage DID route
  them through `t.*`; lead/email are inconsistent. Same names are duplicated in the prompt prose.
- **Handoff agent-id targets** (`handoffs: ['reply']`, `['reader','spam','important']`, …) and
  **agent roles** (`role: 'input'|'worker'`) are raw literals.
- **i18n prompts:** prompts are hardcoded English in `agents/*.prompts.ts`. For multi-language,
  prompts need to become language-parameterised templates with the language chosen via config-as-data
  (ARCHITECTURE §3: a `editableBy: manager` leaf field), NOT hardcoded strings.
  **Decision frame (brainstorm first):** values stay serializable wire strings (config-as-data, I7) —
  the fix is a typed const/union per workflow (extend WS6's `tools.ts`/`cards.ts` to read tools +
  workflow-id + handoff targets), NOT a TS enum. The i18n layer is a real design — run brainstorming.
  `check-foundation` (I7 config-as-data, NOT enum; core stays provider-agnostic). This is the work that
  most needs doing well — it's why the user is unhappy with the current client.

### 3. Board cleanup — a Reset button + drop finished scans

**Symptom (user):** opening the app shows a pile of finished `EMAIL SORTER` plates from old scans.
WS1 supersedes the prior scan on a _re-START_, but input-agent roots are kept as the "pipeline root"
forever, so without a re-START finished scans accumulate. The user wants: (a) a **Reset** button
(like the existing Stop — a clear gesture; per-workflow and/or global) that retires finished/closed
roots from the live column; (b) **finished scans also dropped** from the live board (not just
superseded ones); (c) a config knob "reset on start" (clean the board at boot). This is a **product
decision** (auto vs manual vs config) — brainstorm. Touches `@atizar/react` board (`boardModel.isVisible`
/ a StopButton-style ResetButton), `@atizar/server` (a reset/close-scans route through `transition()`
— I8: status only via transition; I12: preserve to history, never destroy), and a `defineWorkflow`
knob. NOTE the related WS1 UX gap: an `error` item makes `aggregateLabel` non-empty which HIDES the
START button (`aggregate.ts` counts error as active) — fold a fix in (allow START when the only
"active" item is an error).

### 4. Library/userland boundary re-audit

WS7 moved the reusable Node/runtime machinery into the packages. Re-verify the project is **minimal**
and everything reusable is in a package: audit what's still in `apps/inbox/` that other consumers
would re-implement (the workflow-aggregator pattern, MCP-server scaffolding, the `mastra/tools.ts`
tool-definition pattern, the demo client shell). Litmus test (I5): "renders from the generic model →
package; knows this vertical's payload → userland." Keep `@atizar/core` Node-free (I3).

### 5. Client code → house standards + write them into docs/CONVENTIONS.md

The user finds the client code below standard. Bring `apps/inbox/client/` (and the userland workflow
client modules) to the Magma house style (`docs/CONVENTIONS.md`) — arrow-const named-export
components, `type {Name}Props`, one component per file, import grouping, NO magic strings (ties to
task 2). Then **write the standards that were missing into `docs/CONVENTIONS.md`** so this doesn't
recur (the user explicitly asked for this). Likely overlaps tasks 1–2; do as a focused cleanup pass.

### 6. Cassettes — delete + record a REAL flow

The user wants to wipe `apps/inbox/.cassettes/`, run a **real** email-inbox flow, and watch fresh
cassettes get written — then replay. Yes, that is how record/replay works: unset `DEV_RECORD_REPLAY`
(or `=record`) → first real run records one JSONL per `wf__agent`; `=1` replays. **BLOCKER: the Gmail
OAuth refresh token is EXPIRED (`invalid_grant`)** — re-auth FIRST (`gh`-style device flow needs a
real terminal; tell the user to run the connect flow / refresh `~/.gmail-mcp/` creds), or the real
email-inbox run can't read Gmail. Cassettes are gitignored + hold real captured data — **never commit
or share without the scanCassette ritual** (CLAUDE.md HARD RULE).

### 7. `add-workflow` skill (capstone)

Capture "how to add a new workflow" as a `.claude/skills/add-workflow/` skill (the user named it).
Depends on 1–2 + 5 — it documents the CLEAN, minimal, magic-string-free pattern a single email-inbox
reference establishes. The skill should walk: descriptor (agents + roles + handoffs + connections +
`rerun`) → server binding (effects, prompts, allowed tools) → client (render/HITL specs, cards,
tool/card consts) → aggregator wiring → tests → browser-verify.

---

## ⚠ Open tails (carry forward — none block the work above except where noted)

- **Gmail OAuth refresh token EXPIRED** (`invalid_grant`). Blocks task 6's real flow and any live
  (non-replay) Gmail demo. Re-auth needed. The whole 7-WS run used `DEV_RECORD_REPLAY=1`, so it
  blocked nothing there.
- **Test Gmail draft** `r7666524379648912752` (thread `19ebbf9875f60e8c`, body contains
  `WS5-EDIT-MARK`) — created by a WS5 approve, couldn't be deleted programmatically (OAuth). Delete
  it from the Gmail Drafts folder.
- **Flaky test** — `packages/server/src/pipelineService.test.ts` "supersede is recorded in the
  Activity log" can intermittently fail under concurrent Postgres load (`@mastra/pg` + the Drizzle
  client contend for the test DB); passes in isolation and on retry. Consider bounding the test-PG pool.
- **WS6 optional generic** (`defineAgent` generic over the tool-name union) was skipped — optional,
  with a revert decision-gate; pick up only if desired.
- **Subagent auth note** (long autonomous runs): one implementer subagent died on a `401` after a
  ~6h pause (keychain token expiry); re-dispatching worked. The main loop's auth was unaffected.

## Execution rules (every task, unchanged from the 7-WS run)

- One branch off `master` per task; **subagents must NOT switch branches** (read history via
  `git show <sha>:path`). TDD: failing test → implement → green, per unit.
- Green gate before "done": `yarn typecheck && yarn test && yarn lint && yarn format:check`
  (+ `yarn workspace @atizar/react build` for any `@atizar/react` change). From repo root.
- **Browser-verify EVERY user-visible flow** — this codebase's bugs are browser-only (the 7-WS run's
  WS7 caught a client-bundle regression that typecheck + 528 tests missed). Use the `browser-verify`
  skill + `DEV_RECORD_REPLAY=1` (once OAuth is restored for real runs).
- **`check-foundation`** for any change touching a belief/invariant (tasks 2, 3, 4 do). Do not erode
  I1/I3/I5/I7/I8/I12.
- Merge to `master` directly (no PR — beta); delete the branch; **update this block** and keep it short.
