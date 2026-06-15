# Spec — Pipeline lifecycle fixes (singleton enforcement, parent-done display, source panel, maxInstances default)

**Date:** 2026-06-15
**Status:** DECIDED — §3 = **Approach B** (developer delegated the systems-design call; B chosen for
single-responsibility status + derive-don't-store liveness + eliminating the "running-but-not-running"
state). Plan: `docs/superpowers/plans/2026-06-15-pipeline-lifecycle-fixes.md`.
**Surfaces touched:** `@atizar/server` (state machine + dispatch), `@atizar/react` (thread + source panel),
`@atizar/core` (defineAgent default + definePrompt doc), `apps/inbox/workflows/email-inbox` (descriptor).

---

## 0. Why this exists

A browser-driven diagnostic (replay **and** real-data runs, 2026-06-15) of the `email-inbox` workflow
reproduced a cluster of bugs the developer kept hitting. Crucially, the diagnostic **corrected** an
earlier hypothesis: the input/sorter agent is **not** "stuck `running` forever." The state machine
already settles a completed scan correctly. The real defects are narrower.

### Verified-good behavior (do NOT touch)

- `autoFinishParent` (`transition.ts:89-99`) finishes a parent once its **last** child reaches a
  terminal status. Verified live: after all children of a real-run sorter became terminal, the sorter
  flipped `running → finished` on its own, the **entire tree left the live pipeline** ("No agent is
  running yet"), and the agent type-cards showed **"Done"** with **START** available again.
- A terminal **child** (approved/rejected) leaves the live pipeline immediately (`buildPipeline`'s
  `shown` = ACTIVE + ancestors-of-active). Verified live: rejecting one reply collapsed the REPLY group
  from "2 active" to one card; the rejected instance vanished. Records persist in history (I12).
- `reset-all` works end-to-end through its confirm dialog (cancels in-progress, then retires terminal
  items). Verified live: 10 live items → 0 non-closed. (The per-workflow "Reset this workflow" button
  intentionally **keeps** in-progress work — that is the likely source of "reset does nothing", not a bug.)

So a **healthy single scan** already appears, runs, and disappears correctly. The bugs below are about
(a) a second concurrent START leaking past the singleton, and (b) a misleading "still typing" display
while a scan legitimately waits on the human.

---

## 1. Bugs in scope (with verified root cause)

### Bug 1 — A second human START is not rejected → duplicate input roots + worker accumulation  **[CORE]**

`pipelineService.ts:250` gates a singleton START on the **live-process count**:

```ts
if (req.origin === 'human' && maxInstances === 1 && pool.activeCount(req.agentId) >= 1) {
  return { id: '', deduped: false, rejected: 'already_running' }
}
```

`pool.activeCount` is released the moment the agent's claude-cli **process ends** — and the sorter's
process ends right after it dispatches its children (and any worker's process ends when it suspends at
its approval gate; `workerPool.ts:6`). So `activeCount(sorter)` is `0` while the scan is still live
(children awaiting approval), and a second START is **not** rejected.

Verified live: with one sorter root `running` (children awaiting), a second `POST /api/dispatch` for the
sorter returned a fresh id (not 409) → **two `running` sorter roots**, each with its own child subtree.
Each illegitimate re-START therefore spawns a **fresh** reader/spam/reply set, and none are reaped while
their approvals are pending → the agent type-card aggregates climb ("5 active reader/spam"). This is the
single source of the "duplicate input agents" **and** the "workers accumulate without bound" complaints.

`supersedePriorRoots` (`pipelineService.ts:220`, via `getFinishedInputRoots`) only retires **`finished`**
roots, so it cannot clean a still-live prior scan — nor should it silently discard a scan whose drafts
are still awaiting the human's decision.

### Bug 4 — A scan that's waiting on the human shows "Working… / typing" in its thread  **[DISPLAY]**

While children await approval, the sorter row is legitimately `running` (it anchors the live subtree).
The thread reads the work item's **own DB status** (`useWorkItemThread` → `mapStatus`), so
`ThreadModal` sets `loading = display === 'running'` and `AgentModal` renders the trailing typing-dots
bubble + a "Working…" header. But the sorter's **own turn is over** (it produced its summary and the
four handoffs, and its run stream has closed). The UI implies it is still generating output. Verified
live on both replay and real data (matches the developer's screenshot).

### Bug 5 — Approval gate shows the email as raw JSON  **[DISPLAY]**

`SourcePanel` renders each top-level payload entry and `JSON.stringify`s any non-string value. The reply
child's payload is `{ email: { date, from, snippet, subject, threadId, messageId } }` (contract
`ReplyPayloadSchema`), so the panel prints the whole email object as one raw JSON string under an "email"
label. Verified live (e309): `{"date":"…","from":"…","snippet":"…","subject":"…",…}`. Note the card
**above** the gate already renders a clean `from / subject / summary` header — the formatter exists; the
gate's source panel just doesn't use it.

---

## 2. Non-bug design changes in scope (developer-requested)

### Change A — `defineAgent` default `maxInstances` `2 → 1`

`defineAgent.ts:19` defaults `maxInstances` to `2`. Decision (this session): default to **`1`**, because
the cost of a wrong default is **asymmetric** — defaulting too high risks concurrent runs of something
that shouldn't be concurrent (a correctness/safety hazard that's easy to miss), while defaulting to `1`
only ever costs serialization (a self-correcting performance annoyance). Concurrency becomes an explicit
opt-in. This also fits the demo: 4 of 5 agents are natural singletons; only `reply` (one instance per
email) wants concurrency, so only `reply` gets an explicit `maxInstances: 2`.

> **Note:** this is an **ergonomics** change, NOT a bug fix. It does not affect Bug 1 — `maxInstances`
> is a *concurrency* throttle that does not count `awaiting_approval` instances, so it never bounded the
> accumulation in either direction. Bug 1 is fixed by §3, independently.

### Change B — `definePrompt` escape-hatch comment

`definePrompt` is additive sugar over the real `PromptStrategy` contract (`providers.ts:40`), which is
still accepted everywhere prompts are wired (`server.ts`, `buildAgent.ts`, `createServer.ts`). No
flexibility was lost. But `definePrompt` is slightly narrower than the raw contract: its `onResume`
forwards only `executedResult` (drops the resume `args`), and it decodes a single `input` schema. Add a
one-line comment in `definePrompt.ts` (and a `CONVENTIONS.md` note) pointing authors who need more to
pass a raw `PromptStrategy` object directly.

---

## 3. KEY DECISION — how to fix Bug 1 + Bug 4 (foundation-touching)

Both bugs come from the same fact: **a parent that has dispatched children stays DB-`running` until its
last child settles** (the deliberate deferral at `transition.ts:116-119`). Two ways forward:

### Approach A — keep the parent `running`; fix the two symptoms separately

- **Bug 1:** replace the `pool.activeCount` gate with a **DB tree-liveness** check: reject a human START
  of an input agent while that agent already has a root whose subtree contains any ACTIVE node
  (`running` / `awaiting_approval` / `awaiting_input` / `queued`). Allow + supersede only when the prior
  scan is fully terminal.
- **Bug 4:** stop driving the thread's typing indicator off the raw `running` status. The thread must
  distinguish "actively streaming" from "run ended, anchoring children" — e.g. derive `loading` from
  whether the run's event stream is still open, or from "is this a parent whose own run finished but
  whose children are live."
- **Cost:** keeps the documented deferral; but Bug 4 needs a new "stream open vs. anchoring" signal that
  the thread does not have today, so it adds cross-item/stream logic to the client.

### Approach B — finish the parent when ITS OWN run ends; let pipeline tree-liveness drive "Working"  **(RECOMMENDED)**

- Remove the `hasActiveChild` deferral at `transition.ts:119` (and retire/​simplify `autoFinishParent`):
  every node goes `finished` when its **own** run completes, independent of children.
- The pipeline **already** shows a parent as "Working" while it has a live descendant (`pipelineModel`
  `view()` overrides display to `running` when `hasLiveDescendant`) — so the pipeline UX is **unchanged**.
- **Bug 4 fixed for free:** the sorter's DB status becomes `finished` when its turn ends → the thread
  shows "Done", no typing bubble, and the run's SSE stream closes cleanly.
- **Bug 1 fix:** the START gate keys off **tree-liveness** (any ACTIVE node in the input agent's tree),
  exactly as in Approach A — a `finished` root with `awaiting_approval` children still counts as live, so
  a second START is rejected; once all settle, a re-START supersedes the finished root and starts fresh.
- **Cost:** changes the documented state-machine semantics (a parent no longer waits for children before
  finishing). Requires a `check-foundation` pass (touches the state machine + invariants I1/I7/I12-area).
  Must confirm: (1) `buildPipeline` keeps a `finished` parent visible via ancestor-of-active promotion
  (it does — `shown` promotes ancestors of ACTIVE nodes); (2) `reset`/`supersede`/aggregate counts still
  behave; (3) grandparent chains (a worker that itself dispatches) still display correctly.

**Recommendation: Approach B.** It fixes Bug 4 without inventing a new client-side stream signal, removes
the awkward "running but not actually running" state that caused the confusion in the first place, and
makes the START gate's tree-liveness check the single source of truth. It is the larger change and is
foundation-touching, so it is gated on `check-foundation` + explicit developer confirmation (this §).

---

## 4. Out of scope / explicitly NOT changing

- The board-cleanup model: a completed scan leaves the **pipeline** immediately and the **type-cards**
  show "Done" until the next START/Reset. Verified to already work; keep as-is (no "vanish vs. linger"
  redesign).
- `reset-all` / per-workflow reset semantics (work as designed).
- The `PromptStrategy` contract and `definePrompt` behavior (only a doc comment is added).
- Worker `maxInstances` as a *total* cap — it stays a *concurrency* throttle by design.

---

## 5. Acceptance criteria (browser-verified, every flow)

1. **Singleton enforced (Bug 1):** with a sorter scan live (children awaiting approval), a second START
   of the sorter is **rejected** (no second root); the agent type-card never shows a second sorter
   instance. `POST /api/dispatch` for the sorter returns **409** in this state.
2. **No accumulation:** running the sorter, resolving its children, and re-running N times never leaves
   more than one live scan; reader/spam never exceed one instance per live scan.
3. **Parent-done display (Bug 4):** immediately after the sorter emits its summary + handoffs, its thread
   shows **no** typing bubble and the header is **not** "Working…"; the pipeline still shows the sorter
   block as "Working" while children are awaiting approval; when all children settle the block leaves.
4. **Source panel (Bug 5):** the reply approval gate shows the email as **from / subject / snippet**
   (formatted), not raw JSON.
5. **maxInstances default (Change A):** `defineAgent({...})` with no `maxInstances` resolves to **1**;
   `reply` in the demo is explicitly `2`; the demo still fans out one reply instance per reply email
   (verified: 2 reply emails → up to 2 concurrent reply instances).
6. **Escape-hatch doc (Change B):** `definePrompt.ts` carries the raw-`PromptStrategy` escape-hatch note.
7. **Green gate:** `yarn typecheck && yarn test && yarn lint && yarn format:check && yarn workspace
   @atizar/react build` all green; `check-foundation` run for §3.

---

## 6. Open question for the developer

**§3: Approach A or Approach B?** (Recommended: B.) The plan is written against the chosen approach.
