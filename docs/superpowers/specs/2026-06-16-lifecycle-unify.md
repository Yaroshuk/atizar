# Spec — lifecycle-unify (one source of truth for the work-item lifecycle)

**Status:** LOCKED by the developer (2026-06-16). Build as one branch off `master`, TDD per unit,
browser-verify every user-visible flow.

## Why

The recurring lifecycle bugs are not six separate defects — they are ONE root cause in six places:
the same fact ("does this work exist / is it alive / how did it end / what should the human see /
is the slot occupied") is stored or re-derived in **multiple unsynchronized places**, reconciled
by hand at each call site. Where two of them drift, a bug appears; fixing one drift removes a
property another site silently relied on (the STOP-cascade fix → phantom duplicates).

Sources of truth today: (1) `work_items.status`, (2) `work_items.resolution` (thrown away on the
client), (3) tree-liveness computed **three** ways (`pipelineModel.hasLiveDescendant`,
`stateStore.hasLiveInputScan`, `ACTIVE` + `getActiveChildren`), (4) the in-memory `WorkerPool`
counter (separate from Postgres, reconciled by async timing), (5) the trace/thread (populated only
as a side-effect of the agent RESUMING), (6) Gmail.

This refactor collapses the lifecycle vocabulary into **one isomorphic classifier** that every
consumer imports, so the views cannot physically disagree, and makes every terminal outcome flow
through **one writer** so they behave identically.

Origin: the `lifecycle-unify` multi-agent workflow (2026-06-16) — 7-subsystem map → synthesis →
3 independent designs → judge. All three designs converged on the same five structural moves; we
take the clean end-state (Proposal A) directly, not the staged minimal-then-migrate, because the
dev DB data is disposable now and migrating later is riskier.

## Locked decisions

- **STOP = "freeze & keep" (Option A).** A stopped run stays visible as a distinct `stopped`
  outcome (NOT `done`), its whole tree stays together, the thread shows a `Stopped — cancelled`
  note, the pool is reconciled deterministically, and clearing is a SEPARATE explicit gesture.
- **Terminal outcomes are first-class and symmetric** — cancel / reject / supersede / reset /
  finish / fail all go through one `settle()`.
- **Do the clean end-state now** (real `(phase, outcome)` column shape), not a derived shim.

## Foundation (check-foundation run 2026-06-16 — developer CONFIRMED the touches)

Not Clear — three confirmed touches, none an erosion if done faithfully:

- **I8** (one `transition()` owns status; one `dispatch()`): STRENGTHENED — the raw parent-reopen
  `UPDATE` in `dispatch.ts:98-103` becomes a real `transition('reopen')`; the edge-write logic
  stays in ONE place — the `applyEdge` helper (U4), called by both `transition()` and `settle()` —
  even though we redefine the status alphabet it guards. (`settle()` needs the edge write inside
  ITS transaction to keep note+status+audit atomic; `transition()` owns its own tx, so the rule is
  factored into `applyEdge(executor, …)` rather than duplicated — one writer, not two.)
- **I12** (durable/visible work item; result kept until the human closes it; hide, never delete):
  HIGHEST RISK. The visibility ladder must be transcribed **byte-faithful** into
  `lifecycle().isVisible`. No `DELETE` introduced. **Conditions: golden-table test pinning the
  ladder BEFORE wiring + full browser E2E of every terminal flow before merge.**
- **I14** (Thread = faithful Trace render; AG-UI vocabulary): the typed `LifecycleNote` makes the
  trace an explicitly mixed log (provider output + server notes). It does not introduce the mixing
  (synthetic `CUSTOM` events already exist — `dispatch_rejected`, status markers) — it **types**
  the duality. AG-UI stays the vocabulary.
- **Boundary note (belief 2 / I3):** `lifecycle.ts` lives in `@atizar/core` — pure isomorphic
  classification, no engine import, same nature as `messages`/`fold`/gate helpers. Consistent (the
  work-item lifecycle is part of the contract); a conscious boundary placement, flagged.

`I9` (effect-identity / cross-run idempotency) is explicitly OUT of scope — it protects an
irreversible `send`, and the demo is draft-only. A separate gate before any real send.

## The unified model

One new isomorphic primitive — `packages/core/src/lifecycle.ts` — is the SINGLE place the lifecycle
alphabet is defined. Everything (server cancel-cascade, START guard, dedup, board, pipeline,
aggregate, display) imports it.

```
lifecycle(phase, outcome) -> { phase, outcome, isLive, isVisible, covers }
```

- **phase** (was `status`, 8→4): `queued | active | awaiting_human | terminal`
  (`awaiting_human` merges the old `awaiting_approval` + `awaiting_input`).
- **outcome** (was `resolution`, now first-class, 7): `running | done | stopped | rejected | error
  | superseded | reset`. `done` = a clean finish, INCLUDING one that passed through an approved
  gate. **`approved` is deliberately NOT an outcome value:** the other terminal outcomes all answer
  "why did this NOT finish normally" (a human/system terminated it) — an approved item DID finish
  normally, so its disposition is `done`. Approval is an *event during the item's life*, not a
  terminal disposition; it already has a first-class home in the gate row (`resolved` + decision +
  actor + `resolvedAt`) and the durable `audit_log`. Forcing it into `outcome` would conflate "how
  it ended" with "what happened along the way" — the same category split this refactor removes.
- **isLive** = phase ∈ {queued, active, awaiting_human}. `error`/`stopped`/`rejected` are TERMINAL,
  not live — this single decision resolves the error/queued boundary disagreement across all walks.
- **isVisible** = the I12 visibility ladder transcribed ONCE (queued→false; closed/retired→false;
  non-terminal→true; terminal→`card != null || outcome is a human-terminal marker ||
  hasLiveDescendant`). `hasLiveDescendant` is the ONE tree walk over `isLive`. `isVisible` answers
  "render this as a CARD" — it is NOT the board's transport filter. The server board ships every
  NON-RETIRED row (`outcome ∉ {superseded, reset}` — exactly the set the old `!= 'closed'` filter
  dropped, so `queued` rows still reach the client to feed the "queued: N" count); the client then
  applies `isVisible` to decide which rows become cards. Letting the board filter on `isVisible`
  itself would starve the queued count (it drops `queued`) — keep the two questions separate.
- **covers** (dedup): under Option A, `stopped` COVERS (freeze & keep → no phantom twin);
  `rejected`/`superseded`/`reset` do NOT cover (the un-actioned source re-surfaces). The
  show-vs-shadow policy is one auditable, exhaustively-typed switch.

One new terminal writer — `packages/server/src/settle.ts`. Two laws collide here: "one writer owns
the status" (I8) and "the terminal status + note + audit commit atomically" — incompatible head-on
as long as `transition()` owns its own transaction. We satisfy both by factoring the edge-write
RULE into one helper, `applyEdge(executor, id, edge)` (the `FOR UPDATE` read + legality check +
`phase/outcome` write, on any `db | tx`):

- `transition(db, id, edge)` = `applyEdge` inside its OWN transaction (standalone callers, e.g.
  `dispatch`'s `reopen`).
- `settle(deps, id, edge, actor)` opens ONE transaction and runs `applyEdge(tx)` + `appendTrace(tx)`
  + `appendAudit(tx)` inside it, then publishes status + `pool.reconcile(agentId)` AFTER the commit.

So note+status+audit are atomic, the note is appended before the status publish (killing the SSE
backlog race), and there is still exactly ONE place that writes an edge — `settle()` carries NO
second raw `tx.update` of `phase/outcome`. `appendTrace`/`appendAudit` gain an optional executor
param so they join `settle`'s transaction. Every terminal edge becomes a thin `settle()` caller.

Pool occupancy is derived from the DB (count `active` rows per agent), not an in-memory counter —
the counter is deleted, so a leaked/double-freed/restart-lost slot is structurally impossible. The
in-memory FIFO queue stays (legitimately process-local ordering, rebuilt by the boot sweep). To
hold the cap against a same-tick burst, the pool OWNS the `queued → active` flip at admission: under
a per-agent admission lock it re-reads the DB count, and while a slot is free it transitions the
next queued id to `active` ITSELF (an awaited, committed `applyEdge('start')`) BEFORE handing the
run to the observer — so the next count already reflects it. (The old race: `transition('start')`
landed asynchronously inside `run()` AFTER `pump` returned, so two overlapping `pump`s both read a
stale low count and over-admitted; the observer's `run()` therefore no longer does the start
transition — the pool already did.) The lock is an in-process async mutex (per agent) — the server
is a single process, the boot sweep rebuilding the queue is the single-owner signal; a Postgres
advisory lock is the drop-in upgrade if multiple server processes ever admit concurrently. No
in-memory occupancy counter is reintroduced — the DB stays the SOLE source of occupancy.
maxInstances cap + queue **semantics are unchanged**.

## Units (TDD, ordered — the compiler drives most of the migration)

- **U1 — `core/lifecycle.ts` + golden-table test.** The keystone + Phase/Outcome unions + the one
  `hasLiveDescendant` walk. Table test = all old `(status × resolution)` combos → expected
  `{phase, outcome, isLive, isVisible, covers}`. **This test IS the I12 ladder spec — write it
  first.** Export from `core/index`.
- **U2 — schema migration.** `status` 8→4 (`phase`); `resolution`→`outcome`; merge
  `awaiting_input`→`awaiting_human`; collapse the vestigial `result` status (verify it is
  vestigial first). Drizzle forward migration + **dev DB reset** (no backfill — data disposable).
- **U3 — `transition.ts` redesign.** Edge table re-expressed over `(phase, outcome)`; add the
  `reopen` edge (`from: terminal-finished`); delete the local `ACTIVE` set (callers use core
  `isLive`). Factor the guarded write into `applyEdge(executor, id, edge)` so `settle()` can reuse
  it inside its own tx (U4); `transition(db, …)` = `applyEdge` in its own tx. There is exactly one
  edge-writer (`applyEdge`). **No `approve` edge and no `approved` outcome** — an approved gate
  resumes and finishes via the normal `finish` edge → `done`; the approval is recorded in the gate
  row + `audit_log` + the `LifecycleNote` (already the durable home), not in `outcome` or a fake
  edge. Do NOT add an `approve` edge/`TerminalEdge` value.
- **U4 — `settle.ts` + typed trace note.** The one terminal writer. `settle()` opens ONE tx and
  runs `applyEdge(tx)` + `appendTrace(tx)` + `appendAudit(tx)` inside it (atomic), then publishes
  status + `reconcile` after commit — NO second raw `tx.update` of phase/outcome. Give
  `appendTrace`/`appendAudit` an optional executor param so they join the tx. Add `LifecycleNote`
  (`kind:'lifecycle', outcome, actor, at`) to `core/messages.ts`; `fold.ts` gains one case →
  a system/assistant note message.
- **U5 — pool from DB + zombie sweep.** Delete `slot.active` and `resumeAcquire`'s `active++`;
  `activeCount` = injected DB query; `release`/`reconcile` re-derive from DB. The pool OWNS the
  `queued → active` flip at admission, serialized by a per-agent in-process async mutex (await the
  committed `activate(id)` before `run(id)`, so the next count reflects it — cap holds against a
  same-tick burst); `run()` no longer does `transition('start')`. Boot sweep: terminal/`error` any
  `active` row with no live executor.
- **U6 — `dispatch.ts` dedup + STOP cascade.** Replace the SQL `ne/notInArray` block with
  `lifecycle(w).covers` (exhaustive — closes the latent reset-omitted bug); route parent-reopen
  through `transition('reopen')`. Restructure `cancelItem` so the cascade is OUTSIDE the
  `isLive` guard (item 5) — safe now because `stopped` covers the re-scan.
- **U7 — `pipelineService.ts` settle wiring + server wipe.** cancel / reject / supersede /
  `resetImpl` / run-end finish/fail all call `settle()`. Add `wipeWorkflow(id)` / `wipeAll()`
  (= cancel active + reset terminal, one server op); route `POST /api/workflows/:id/reset` and
  `POST /api/reset-all` → wipe; drop the vestigial `{ active }` return. `stateStore` liveness walks
  reduce to the one core `isLive`-over-tree helper (Approach-B singleton guard preserved — an
  `awaiting_human` child is `isLive`).
- **U8 — client unify + Start-over.** Delete `mapStatus`; new `react/lifecycleDisplay.ts`
  (`OUTCOME_LABEL`/`OUTCOME_TINT` incl. `stopped`/`rejected`); `boardModel`/`pipelineModel`/
  `aggregate` import core `lifecycle`; one `N active` count computed once + passed down; `AgentModal`
  renders the lifecycle note banner + the `Stopped`/`Rejected` labels. `useResetController` calls the
  single `wipe` method (delete the client cancel+reset composition); remove the `rejected:
  'already_running'` plumbing; Start-over = confirm modal (mirror the reset confirm) → `wipe` +
  `start` (remove the 409 reject guard + the `routes.ts` 409 path).
- **U9 — drift-guard + verify.** One drift-guard test (same item → same `isLive`/`isVisible`/
  `covers` everywhere). Update existing tests to the outcome-aware model. Full browser E2E.

## Out of scope (separate follow-ups, by design)

- **markRead on approved action** (Gmail-as-source-of-truth, old item 6) — workflow-effect logic in
  `apps/inbox/.../apply-actions.ts`, not the framework lifecycle; its own Gmail/cassette verify.
- **maxInstances** — semantics untouched (impl changes to DB-count; behavior identical).
- **Effect-identity / cross-run idempotency ledger (I9)** — gate before any real irreversible send;
  nothing sends yet.

## Browser-verify checklist (DEV_RECORD_REPLAY; `record` for concurrent HITL)

- STOP a running instance → card/pipeline shows a distinct **Stopped** (not Done), whole subtree
  stays together (no half-clear).
- Open the stopped thread → a `Stopped — cancelled` note at the tail.
- Reject a gate → thread shows a `Rejected` note; card shows the rejected outcome.
- Phantom-dupe repro: STOP an input scan, then re-START/re-scan the same source → exactly ONE card.
- Start-over: press START on a live workflow → confirm modal → on confirm the old work is gone and
  one fresh root runs; on cancel nothing changes.
- Pool/START race: cancel a run then immediately START → the new run RUNS (not stuck `queued`);
  route 3 at once on a cap-2 agent → 2 active + `queued: 1`.
- Reset gesture: a stopped item persists until explicit Reset; after Reset it leaves the live column
  but stays in Activity/history (hide-not-delete).
- `N active` counts agree across the type card, picker, and pipeline.
- HITL approve → effect runs once, item shows Done with an attributed audit row; a finished input
  root with an awaiting child still counts as a live scan (Approach-B preserved).
- Restart server mid-pipeline → a running row with no executor becomes `error` (zombie sweep); pool
  admission re-derives from the DB.

## Execution rules

- One branch off `master`; subagents must NOT switch branches (`git show <sha>:path`). TDD per unit.
- Green gate before "done": `yarn typecheck && yarn test && yarn lint && yarn format:check`
  (+ `yarn workspace @atizar/react build` for any `@atizar/react` change). From repo root.
- **Browser-verify every flow above** via the `browser-verify` skill.
- Update `docs/pipeline-updated-3.md` to the new `(phase, outcome)` alphabet (not protected; tracks
  the beta). Record the build narrative in `docs/BUILD-LOG.md` when the branch lands.
