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

## ⏭️ NEXT — one blocked item, then push

The cleanup → minimal-demo → extensibility track is **DONE on `master`** (6 units above). What remains:

### Cassettes — record a REAL flow (BLOCKED on the user, needs a real terminal)

Wipe `apps/inbox/.cassettes/`, run a **real** `email-inbox` flow (`DEV_RECORD_REPLAY=record`, or
unset) so fresh cassettes are written (one JSONL per `wf__agent`), then replay with `=1`. **BLOCKER
confirmed 2026-06-15: Gmail OAuth refresh token is EXPIRED (`invalid_grant`)** — a direct probe of
`~/.gmail-mcp/credentials.json` returned `invalid_grant`. Re-auth needs the device-code/consent flow
in a **real terminal** (the `!`-prefix shell can't do the TTY consent), so this can't be done
autonomously. **User action:** re-auth Gmail, then the record/replay is mechanical. Cassettes are
gitignored + hold real captured data — **never commit/share without the `scanCassette` ritual**
(CLAUDE.md HARD RULE). Also delete the stale draft `r7666524379648912752` while there.

### Push

`master` is ahead of `origin/master` by the 6-unit track (+ the spec/plan doc commit). **Not pushed**
— push when you're ready (`git push origin master`).

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
