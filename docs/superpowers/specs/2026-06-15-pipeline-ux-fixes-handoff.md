# Handoff — pipeline UX fixes (Start/wipe, STOP cascade, reject message, mark-read on action)

Scope: six fixes on the `email-inbox` pipeline lifecycle + outgoing-action correctness. Decisions
below are LOCKED by the developer. Build them as a single branch off `master` (or split if cleaner),
TDD per item, and **browser-verify every user-visible flow** (this codebase's bugs are browser-only).

`file:line` references are accurate as of this writing; they will drift as you edit — re-grep.

---

## 1. Consolidate "wipe" into ONE server operation; client calls it once

**Problem.** There is no single server-side "full wipe". The full wipe (stop live work **and** clear
finished cards) is assembled on the CLIENT from two HTTP calls — `cancelWorkflow` then `resetWorkflow`
(`packages/react/src/hooks/useResetController.ts:48-54`). The server only has the two halves
(`cancelWorkflowImpl` `pipelineService.ts:163`, `resetImpl` `pipelineService.ts:177`). Consequences:
client owns the "wipe" semantic → server can't reuse it (Start needs the same wipe → drift risk), and
two round-trips leave a half-wiped-board window if one fails. `resetImpl` also returns a now-vestigial
`{ active }` count (the client computes affected items itself at `useResetController.ts:23-26`).

**Decision.** Add ONE server op `wipeWorkflow(id)` / `wipeAll()` = cancel active + reset terminal, in
one place. Both the **Reset** button and **Start** (item 2) call it.

- Server: new `wipeWorkflowImpl(workflowId)` = `cancelWorkflowImpl` then `resetImpl`. Expose via the
  service (`wipeWorkflow` / `wipeAll`) and route `POST /api/workflows/:id/reset` → full wipe
  (and `POST /api/reset-all`). Drop the vestigial `{ active }` return.
- Client: `useResetController.confirmReset` calls the single wipe method (delete its client-side
  cancel+reset composition). `useDispatch` (`useDispatch.ts:73-94`) loses the paired calls.
- **KEEP `cancel*` as a separate primitive** — STOP is a distinct gesture (`useStopController.ts:42,46`
  stops live runs but LEAVES the cards on the board so the human can read what happened). Do not fold
  STOP into wipe. `resetImpl` (terminal-only) becomes an internal helper of `wipe`, no longer a public
  standalone endpoint (nothing called it alone).

Touches I7/I8/I12 → run `check-foundation`. The wipe is still "hide, never delete" (I12).

## 2. Start over a running workflow = confirm modal → wipe + start

**Problem.** A human START is rejected with 409 while the workflow has a live scan
(`pipelineService.ts:253-260` F6 guard; surfaced at `routes.ts:38`). "Start does nothing" with no
feedback. Start should mean "run the workflow from scratch".

**Decision (REVISED — not silent).** When a human presses START on a workflow that has live/visible
work, show a **confirmation modal** (mirror `useResetController`'s confirm pattern). On confirm →
**wipe (item 1) + start**. On cancel → nothing.

- Remove the server 409 reject guard (`pipelineService.ts:253-260`) and the `routes.ts:38` 409 path;
  remove the `rejected: 'already_running'` plumbing (`dispatch.ts` `DispatchResult.rejected`, its
  producer in `pipelineService.ts`, and the route check). `hasLiveInputScan` (`stateStore.ts:227`)
  becomes unused by the service — leave the store method (it is unit-tested) or remove with its test.
- The confirm + `wipe` + `start` orchestration lives CLIENT-side (the START handler), so the server
  `dispatch` just stops rejecting. Keep server `dispatch` dumb — do NOT auto-wipe inside it.
- **Tests to rewrite** (they encode the old reject semantic): `pipelineService.test.ts:187`, `:736`,
  `:825` → assert the new behavior (a 2nd human START is NOT rejected; after wipe+start the prior root
  is gone/closed and a fresh root exists). The machine-dispatch cases (`:205`, `:858`) stay valid
  (machine origin never hit the human gate).

## 3. maxInstances — DO NOT TOUCH

Per developer: leave `maxInstances` / the worker-pool queue semantics exactly as they are. Not in
scope. (The earlier "rename to concurrency / document the queue" idea is dropped.)

## 4. Reject leaves no thread message (approve does) — find where the message is added

**Problem.** After **approve**, the thread shows a message ("The actions were applied successfully …").
After **reject**, the thread shows nothing.

**Why.** Approve RESUMES the agent (`runObserver.resume`), and the resumed run's text is appended to
the trace + published on the `workitem:<id>` topic (`runObserver.ts:117-118` `store.appendTrace` +
`bus.publish`). Reject does NOT resume — `resolveGate`'s rejected branch only does
`transition('reject')` + an activity record (`pipelineService.ts:317-338`), so no trace event reaches
the thread.

**Decision.** On reject, append a synthetic assistant text event to the work item's trace (same
`store.appendTrace` + `bus.publish('workitem:<id>', {seq,event})` mechanism `consume` uses) so the
thread shows e.g. `Rejected — no action taken.` (+ the reviewer comment if present). Confirm the exact
AG-UI event shape that folds into an assistant text bubble via `packages/core/src/fold.ts` (the
`TEXT_MESSAGE_CHUNK` path — one messageId per contiguous text, see the CLAUDE.md gotcha) and mirror
what approve's text looks like in `AgentModal`.

## 5. STOP must cancel children — MUST SHIP TOGETHER WITH ITEMS 1+2 (do NOT apply alone)

**Problem (developer's diagnosis, confirmed).** `cancelItem` early-returns at `pipelineService.ts:131`
(`if (!ACTIVE.includes(wi.status)) return`) BEFORE the descendant cascade. A sorter root that finished
its own run (terminal) but is shown "Working" because a child is live → STOP no-op's → children stay.

**The fix** is: run the node's own cancel only when ACTIVE, but ALWAYS cascade to active descendants
(restructure `cancelItem` so the cascade is outside the `ACTIVE` guard).

**⚠ DEPENDENCY — this is why it was reverted.** The fix was applied, browser-tested, and REVERTED
because alone it produces **phantom duplicate instances**. Mechanism: STOP now cancels the spam child →
`resolution = 'cancelled'`. The dispatch dedup-by-source EXCLUDES `cancelled` items (`dispatch.ts:62-77`,
the `notInArray(resolution, ['rejected','cancelled','superseded'])`), so the next human START's fresh
scan re-dispatches a NEW spam child — while the old cancelled card is still on the board (Start does not
wipe yet). Result: old (dead, cancelled) + new (live) = **2 spam cards**, which reads as a
maxInstances=1 violation (it is NOT a real cap violation — the worker pool never runs 2 active; the old
one is a dead card that was never cleared). BEFORE the fix, the un-cancelled child stayed OPEN and
dedup-shadowed the re-scan, so no duplicate appeared — the bug was masked.

**So:** apply item 5 ONLY together with items 1+2. Once START = wipe + start, the wipe closes the old
cancelled card (→ `closed`, hidden AND excluded from dedup) before the fresh scan, so only the new
single instance shows. STOP-cascade and wipe-on-start are correct only as a pair.

**TODO:** restructure `cancelItem` (cascade outside the ACTIVE guard) + unit test (terminal root + live
child → STOP cancels the child) + browser-verify the STOP→START sequence shows exactly ONE spam
instance (not two).

## 6. Outgoing actions must mark the source email read (Gmail is the source of truth)

**Principle.** In this workflow Gmail is the source of truth and the next scan re-reads unread mail.
So any **approved** action must guarantee the email won't re-surface on the next scan — at minimum by
marking it read. There is NO separate idempotency ledger needed here: marking-read IS the dedup. A
**reject does nothing** → the email stays unread → it correctly re-surfaces.

**Rules:**

- **reply / `saveDraft`** (reply agent effect, `apps/inbox/workflows/email-inbox/server.ts:67`):
  after creating the draft, also **markRead the source email**. The effect form is `{ threadId, body }`
  — it has no `messageId`. The source `messageId` lives in the work item payload (the sorter's
  `route_emails` dispatch payload — `EmailRef` requires `messageId`+`threadId`, `contracts.ts:15-16`).
  The effect gets `(form, ctx)` with `ctx.workItemId`; load the work item payload to get `messageId`,
  then call `markRead` (`@atizar/integrations/gmail/modify`, already used by `apply-actions.ts:3`).
- **important / `star`** (batch, `apply-actions.ts:71`): a starred email stays unread → re-surfaces.
  After (or together with) starring, **markRead those ids too**. Simplest: add the `star` group's ids
  to the `markRead` call. (`read` action already marks read.)
- **spam / trash**: no markRead needed — the message leaves the inbox, so the next scan won't see it.
- **keep**: currently a no-op (`apply-actions.ts:52`). OPEN QUESTION — confirm with the developer
  whether an approved "keep" should mark read (so it doesn't re-surface) or intentionally re-surface.
  Default to leaving it a no-op unless told otherwise.

Demo mode (`isDemo()`) returns fake-success shapes and must keep doing so (no real Gmail call). Add the
markRead only on the real path. This connects to the broader "Gmail-as-source-of-truth / no ledger /
restart-safe" design discussed this session — keep the markRead inside the effect so the once-guarantee
travels with the action.

---

## To discuss — open architecture questions (NOT decided yet; developer reviews these first)

These came out of the lifecycle review. They are NOT part of the locked items above — flag them, do
NOT build them until the developer decides. They close the remaining edges of the work-item lifecycle.

1. **Wipe must reconcile the in-memory worker pool, not just the DB.** The pool (`active` counts +
   queues, `workerPool.ts`) is a SECOND source of truth, separate from Postgres. `cancelItem` does not
   release a running item's slot itself — it relies on `consume` releasing async when the killed
   process ends. So after `wipe → mint`, a singleton input agent can race: the new root enqueues before
   the old slot is freed → it QUEUES instead of running ("Start did nothing" for a beat). Proposal:
   `wipe` should explicitly reset the pool (active=0 + clear queues) for the workflow's agents so START
   is deterministic. Decide: reconcile in `wipe`, or accept the transient queue.

2. **Effect-identity idempotency ledger — hard gate before ANY irreversible effect (real send).** The
   whole batch is safe ONLY because gmail is draft-only (reversible). markRead + wipe do NOT make a real
   `send` safe — there is a window between "sent" and "marked read" where a crash/race double-sends. The
   current ledger keys on `workItemId+gateId` (an orchestration coordinate that does not survive a
   re-START); it must key on the effect's natural identity (entity + action), supplied by the effect.
   Proposal: make it an explicit invariant — "no irreversible effect ships until the ledger keys on
   effect identity." Today nothing sends, so it is a gate, not work.

3. **markRead atomicity / failure handling.** markRead lives inside the effect (same call). Decide what
   happens if the action succeeds but markRead fails: the email re-surfaces and may be re-proposed.
   Tolerable for a reversible draft; must be a conscious, documented choice — not silent.

4. **(Optional, larger) Reconcile-on-scan instead of accumulate-then-wipe.** The clean model is the
   board as a PROJECTION of Gmail + live runs, so stale terminal cards never accumulate and `wipe`
   becomes unnecessary. `wipe` is the pragmatic version of the same idea. Not this batch — a direction
   if the lifecycle gets simplified later.

5. **A stopped card reads as "Done" with no marker of what happened.** Pressing STOP cancels the item
   (`transition('cancel')` → status `finished`, resolution `cancelled`), and the card shows the plain
   "Done" status with NOTHING inside indicating it was stopped/cancelled — indistinguishable from a run
   that completed normally. Same family as item 4 (reject leaves no thread message): a human-terminal
   outcome leaves no in-card trace. Decide: a distinct status label/badge for cancelled (vs finished),
   and/or a synthetic "Stopped — cancelled" trace note inside the thread (same mechanism as item 4).

## Execution rules (unchanged)

- One branch off `master`; subagents must NOT switch branches (`git show <sha>:path`). TDD per item.
- Green gate before "done": `yarn typecheck && yarn test && yarn lint && yarn format:check`
  (+ `yarn workspace @atizar/react build` for any `@atizar/react` change). From repo root.
- **Browser-verify every user-visible flow** (Start-confirm, STOP-with-children, reject message,
  mark-read after approve) via the `browser-verify` skill + `DEV_RECORD_REPLAY=1`.
- `check-foundation` for items 1 and 2 (touch I7/I8/I12) and 6 (touches the effect/action contract).
- Note the flaky test under concurrent Postgres load (HANDOFF.md "Open tails").
