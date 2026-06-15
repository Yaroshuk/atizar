# Handoff — where we are & what's next

Living session state: **current status + the next thing to build.** Stable project context lives
elsewhere — read those first: `CLAUDE.md` (conventions, gotchas, decisions, commands),
`docs/ARCHITECTURE.md` (vision + invariants I1–I15), `docs/PHILOSOPHY.md` (the three beliefs),
`docs/BUILD-LOG.md` (full chronological build history). **Keep this file SHORT** — when a track
finishes, its detail belongs in BUILD-LOG / git, and this file shrinks back to "where we are + next".
(It was last reset 2026-06-15 from a 1485-line accretion — the old content is in git history.)

---

## ✅ Where we are (2026-06-15)

The framework **beta is built.** `master` is **ahead of `origin/master` by the cleanup track (NOT
pushed yet — push is the user's call).** Packages:

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
- (Earlier: 7c packaging tail; the 7-WS re-run/trust-UX/library-boundary track. Detail in git.)

**Green gate (HEAD):** `yarn typecheck && yarn test` (**529 passed**) `&& yarn lint && yarn format:check
&& yarn workspace @atizar/react build` — all green.

---

## ⏭️ NEXT

The cleanup → minimal-demo → extensibility track is **DONE on `master`** (6 units above), plus a
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

### B. Cassettes — finish the real-flow set

Gmail OAuth was **re-authed by the user (now connected — `/api/connections` ok)**, NOT the expired
state the old note claimed. Recorded so far (real flow, replay-verified, true-replay mtimes):
`email-inbox__sorter` + `email-inbox__reader`. Missing: `reply` / `spam` / `important` — the live
inbox held only promotional newsletters (even over a 72h window), which all route to `reader`, so
nothing exercised those agents. **The user is sending test emails** that need-a-reply / look-spammy /
are-important; once they land, run `email-inbox` (`DEV_RECORD_REPLAY=record`, server is up) so the
sorter routes to those agents and their cassettes record. Approving a reply creates a real Gmail
draft; approving spam trashes — warn before each. Cassettes are gitignored + hold real data — **never
commit/share without the `scanCassette` ritual** (CLAUDE.md HARD RULE). Stale draft to delete:
`r7666524379648912752`.

### C. Push

`master` is ahead of `origin/master` (the 6-unit track + the spec/plan doc + the board-fix follow-up).
**Not pushed** — push when ready (`git push origin master`).

## ⚠ Open tails (none block the work above except where noted)

- **Gmail OAuth + the stale draft** — both now live in the NEXT "Cassettes" item above (the OAuth
  re-auth is the one blocker; this whole cleanup run used `DEV_RECORD_REPLAY=1` so it blocked nothing).
- **Flaky test under concurrent Postgres load** — `packages/server/src/pipelineService.test.ts`
  ("supersede is recorded in the Activity log", and now the Unit-4 `resetAll` case) can intermittently
  time out when `@mastra/pg` + the Drizzle client contend for the test DB; passes in isolation and on
  retry. The full `yarn test` was green on final `master` (529 passed). Consider bounding the test-PG pool.
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
