# Handoff — where we are & what's next

Living session state: **current status + the next thing to build.** Stable project context lives
elsewhere — read those first: `CLAUDE.md` (conventions, gotchas, decisions, commands),
`docs/ARCHITECTURE.md` (vision + invariants I1–I15), `docs/PHILOSOPHY.md` (the three beliefs),
`docs/BUILD-LOG.md` (full chronological build history). **Keep this file SHORT** — when a track
finishes, its detail belongs in BUILD-LOG / git, and this file shrinks back to "where we are + next".
(It was last reset 2026-06-15 from a 1485-line accretion — the old content is in git history.)

---

## ✅ Where we are (2026-06-15)

The framework **beta is built.** `master` is **ahead of `origin/master` by the cleanup track + the
pipeline-lifecycle fixes (NOT pushed yet — push is the user's call).** Packages:

- `@atizar/core` — isomorphic contract (`defineAgent`/`defineWorkflow`, `definePrompt`, messages,
  providers contract, `aggregateHealth`, gate/fold helpers). No React, no Node.
- `@atizar/providers` — `claude-cli`, `mastra`, `mock` providers + `makeMastraRunner` + the typed
  `PROVIDERS`/`ProviderId` (client-safe subpath `@atizar/providers/ids`).
- `@atizar/server` — Hono pipeline on Postgres (StateStore/transition/dispatch/WorkerPool/RunObserver),
  record/replay, `createServer` factory, `makeClaudeSpawn`, `buildAgentProvider`, `captureTool`,
  the `reset` transition + `resetWorkflow`/`resetAll`, audit log, auth.
- `@atizar/react` — board/thread UI, hooks (`useBoard`/`useWorkItemThread`/`useGate`/`useDispatch`/
  `useActivity`), primitives (CardShell, Markdown, SourcePanel, **ResetButton**…), `scope()`, the
  workflow-scoped render registry.

Demo app `apps/inbox/` consumes ONLY the public packages. **ONE reference workflow ships now:
`email-inbox`** (sorter → reply / reader / spam / important).

**Completed recently** (detail in git + `docs/superpowers/plans/`):

- **Cleanup → minimal demo → extensibility — 6 units** (autonomous subagent-driven run, this session;
  spec/plan `docs/superpowers/{specs,plans}/2026-06-15-cleanup-minimal-demo-extensibility-*`):
  **U1** trim to a single `email-inbox` (lead-inbox + github-triage deleted; email-inbox self-registers
  its reply cards) · **U2** `definePrompt` in core (turn-only strategy) + claude-cli prepends the
  composed identity · **U3** email-inbox wire strings → per-workflow consts (`ids`/`contracts`/`tools`,
  `as const`, no enums) + prompts via `definePrompt` (turn-only) + the `instructions: config.instructions`
  provider wire + strict drift-guard test + CONVENTIONS section · **U4** finished agents (incl. input
  roots) leave the live pipeline, START not blocked by an error, server `reset` edge + Reset UI with a
  cancel-then-close confirm gate + `resetOnStart` knob · **U5** `scope()`→`@atizar/react`,
  `captureTool()`→`@atizar/server` · **U7** the `add-workflow` capstone skill. Each: TDD → two-stage
  review → `check-foundation` (U2/U4 CLEAR; identity composes exactly once on both provider paths) →
  browser-verified → merged to `master`.
- **Board-fix follow-up** (browser-verified): after Reset the agent type-cards returned to "Idle"
  (closed items no longer leak into the per-agent aggregate via `statusesOf`); the per-workflow
  Reset/Stop in the narrow Pipeline header are now icon-only so they stop overflowing into "Your agents".
- **Cassettes recorded + replay-verified** — full real `email-inbox` run, all 5 `wf__agent` cassettes
  (4-way routing), true-replay confirmed. Gitignored, real data (see NEXT §B).
- **Pipeline lifecycle fixes — 7 tasks** (autonomous subagent-driven run; spec/plan
  `docs/superpowers/{specs,plans}/2026-06-15-pipeline-lifecycle-fixes.md`): **Approach B** — a work
  item finishes on its OWN run-end (removed the finish-deferral guard + `autoFinishParent` walk; the
  pipeline still shows a parent "Working" via `pipelineModel.view()`'s `hasLiveDescendant`) → **Bug 4**
  (sorter thread no longer shows "Working…/typing" once its turn ends) gone for free · **Bug 1** the
  human-START singleton gate now keys off DB tree-liveness (`stateStore.hasLiveInputScan`), not
  `pool.activeCount` → no duplicate input roots / worker accumulation · **Bug 5** `SourcePanel`
  flattens a nested payload one level (from/subject/snippet) and hides ids · **Change A** `defineAgent`
  default `maxInstances` 2→1 (reply opts into 2) · **Change B** `definePrompt` raw-`PromptStrategy`
  escape-hatch doc. `check-foundation` CLEAR (I8 single-owner transition preserved, I1 strengthened,
  I12 intact). Each task: TDD → two-stage review → final integration review (MERGE) → merged to
  `master`. **Browser-verified (replay, true-replay confirmed):** Bug 1 (2nd START → 409, one root),
  Bug 4 (thread "Done" / pipeline "Working"), Bug 5 (flattened source panel), no-accumulation
  (settle → re-START → exactly 1 live scan, 1 active per worker), reject, reset-all cancel.
- (Earlier: 7c packaging tail; the 7-WS re-run/trust-UX/library-boundary track. Detail in git.)

**Green gate (HEAD):** `yarn typecheck && yarn test` (**530 passed**) `&& yarn lint && yarn format:check
&& yarn workspace @atizar/react build` — all green.

---

## 🔀 Agent return channel — Pass 1 BUILT (Plan 1 + Plan 2) (2026-06-18, branch `feat/agent-return-channel`, NOT merged)

The honest agent-to-agent return channel (an agent asks another → suspends in `awaiting_agent` →
wakes with the answer; **Variant B / hub-routed, not mesh**). Design + plans:
`docs/superpowers/{specs,plans}/2026-06-18-agent-return-channel*`. **Ready to merge** (branch kept
as-is, not merged — user's call). 750/750 tests green; final opus whole-branch review = Ready-to-merge
(after one racy-capstone fix); our contribution typecheck+test+lint+format clean (remaining red is
inherited/parallel Playwright + pre-existing format debt). `check-foundation` CLEAR for both plans.

- **Plan 1 (core contract):** `AGENT_QUESTION` signal (`question.ts`), `asks` tool class (I15),
  `awaiting_agent` phase + `work_item_phase` pg-enum + migration `0004`, the honest
  `ResumePayload = GateResolution | AnswerResolution` union (additive `kind?`) +
  `buildResumeFromAnswer`/`onAnswer`, 3 providers branch resume on `payload.kind`, conformance
  answer-resume parity (I4).
- **Plan 2 (server orchestration):** `ask`/`answered`/`escalate` transition edges (+ `fail`/`cancel`
  from `awaiting_agent`); `questions` table + migration `0005` + stateStore CRUD; widened server
  resume seam to `ResumePayload`; runObserver detects `AGENT_QUESTION` → suspend → dispatch answerer
  (hub-routed via the app `resolveQuestionTarget` binding — zero agent-id literals in `@atizar/*`);
  answerer-finish → `finishWake` → auto-wakes the asker; cancel cascade + timeout retry/escalation
  reaper + config-as-data tunables; e2e capstone (deterministic). Both Plan-1 carry-forwards done.
- **Pass 2 (NEXT, future):** fan-out/join (N>1 questions), deep re-entrancy + the round auto-increment
  wiring in runObserver (today `round`=1 in prod, cap inert; `DEPTH_CAP=5` is the live backstop),
  `questionTokenBudget` enforcement, the real `feature-delivery` workflow (orchestrator hub +
  knowledge agents), the `awaiting_agent` UI surface + **browser-verify** (no UI symptom yet), and
  `add-workflow` skill co-evolution to teach wiring an ask/answer pair. Minor follow-ups: cancel the
  old answerer WI on retry; a `lastAssistantText` column to avoid `finishWake`'s full-trace scan.

## ⏭️ NEXT

The cleanup → minimal-demo → extensibility track (6 units) **and** the pipeline lifecycle fixes
(Bug 1/4/5 + maxInstances default + definePrompt doc, Approach B) are **DONE on `master`**, plus a
board-fix follow-up (Reset→Idle + compact Pipeline-header buttons). What remains:

### A. Tunables must be PARAMETERS, not prose (design gap — fix + audit + document)

**Found 2026-06-15 (user-flagged).** The sorter's time window ("last 24 hours") lives ONLY in the
**prompt prose** (`email-inbox/descriptor.ts` instructions + `prompts.ts` sorter step + `client.tsx`
intro). The `list_unread` tool DOES take a structured `sinceHours` param — but nothing sets it
declaratively; the **model** reads the prose and passes the number. So a real tunable is "magic in
prose," parsed by the model, instead of a typed config field. This is the opposite of the consts
discipline Unit 3 established, and it breaks the consumer-view story: a manager should set the window
via a **proper control**, not by editing free-text and hoping the model parses it.

- **Fix:** make tunables like the window **declared config-as-data parameters** (I7): a typed
  (Zod) leaf on the workflow/agent descriptor → surfaced as a control in the consumer view → bound
  **deterministically** to the tool call (pass `sinceHours` from config), NOT inferred from prose.
  We built the text-leaf layer (prompt/name/description); this is the missing **structured-param**
  layer.
- **Audit (task):** sweep the app for other "should-be-a-parameter / magic-in-prose" cases —
  hardcoded limits, counts, thresholds, windows, defaults expressed in prompt text that the model
  must parse. List them; convert the real tunables to params.
- **Document:** write the rule into `docs/CONVENTIONS.md` (and reference the I7 intent in
  `ARCHITECTURE.md`): a value the operator might tune is a **declared parameter**, never prose; the
  model receives it, it does not infer it. (This is also a natural extension point for the
  consumer-view edit surface.)

### B. Cassettes — DONE (full real-flow set recorded + replay-verified, 2026-06-15)

Gmail OAuth re-authed by the user (connected). With test emails covering all four paths, recorded
a **complete real `email-inbox` run** — all 5 cassettes: `sorter` (4-way routing: reply/reader/spam/
important = 1 each) + `reply` + `reader` + `spam` + `important`, each proposal **and** resume turn.
Replay-verified under `=1`: full 4-way routing reproduced instantly, **true-replay (mtimes unchanged,
no claude/Gmail calls)**. Cassettes are gitignored (confirmed not tracked) + hold real captured data —
**never commit/share without the `scanCassette` ritual** (CLAUDE.md HARD RULE). Approvals during
recording created a real Gmail draft (reply), starred (important), marked-read (reader), trashed
(spam) on the user's test emails. Old stale draft to delete: `r7666524379648912752` (+ the new test
draft from this run, if unwanted).

### C. Push

`master` is ahead of `origin/master` (the 6-unit track + the board-fix follow-up + the
pipeline-lifecycle fixes + their spec/plan doc). **Not pushed** — push when ready
(`git push origin master`).

## ▶ Next — pipeline UX fixes (spec: `docs/superpowers/specs/2026-06-15-pipeline-ux-fixes-handoff.md`)

Six developer-locked fixes on the `email-inbox` lifecycle (read the spec for decisions + `file:line`):

1. **Wipe consolidation** — one server op `wipeWorkflow`/`wipeAll` (cancel active + reset terminal);
   client calls it once (drop the client-side cancel+reset composition); keep `cancel*` (STOP) separate.
2. **Start over a running workflow** = confirm modal → wipe + start (remove the 409 reject guard +
   `rejected` plumbing; rewrite the reject-semantic tests).
3. **maxInstances — DO NOT TOUCH.**
4. **Reject leaves no thread message** — approve resumes the agent (text → trace); reject only
   transitions. Append a synthetic `Rejected — no action taken.` trace event on reject.
5. **STOP must cancel children** — `cancelItem` cascade fix. **Do NOT ship alone — pair with 1+2.**
   Applied + browser-tested + REVERTED this session: alone it makes phantom duplicate spam cards
   (cancelled child no longer dedup-shadows, so a fresh START re-creates it while the dead card lingers
   → 2 instances). Wipe-on-start closes the old card first → only 1. Working tree is back to committed.
6. **Mark source email read on every approved action** (Gmail = source of truth → markRead is the
   dedup; no ledger): reply/`saveDraft` → markRead source; important/`star` → markRead too;
   spam/trash → not needed; `keep` → open question. Reject = nothing (re-surfaces, correct).

The spec also has a **"To discuss"** section (NOT decided — developer reviews with agents first):
pool-reconcile on wipe; effect-identity idempotency ledger as a gate before any real send; markRead
failure handling; a stopped card reads as "Done" with no cancelled marker; + the optional larger
reconcile-on-scan direction.

## ⚠ Open tails (none block the work above except where noted)

- **Gmail OAuth + the stale draft** — both now live in the NEXT "Cassettes" item above (the OAuth
  re-auth is the one blocker; this whole cleanup run used `DEV_RECORD_REPLAY=1` so it blocked nothing).
- **Flaky test under concurrent Postgres load** — `packages/server/src/pipelineService.test.ts`
  ("supersede is recorded in the Activity log", and now the Unit-4 `resetAll` case) can intermittently
  time out when `@mastra/pg` + the Drizzle client contend for the test DB; passes in isolation and on
  retry. The full `yarn test` was green on final `master` (530 passed). Consider bounding the test-PG pool.
- **`defineAgent` optional generic** (over the tool-name union) still skipped — optional; the
  per-workflow const discipline + the drift-guard test (U3) cover the same ground.
- **Subagent auth note** (long autonomous runs): a subagent can die on a `401` after a long keychain
  pause; re-dispatching works. The main loop's auth is unaffected.

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
