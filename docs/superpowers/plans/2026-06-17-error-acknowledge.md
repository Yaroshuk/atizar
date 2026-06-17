# Error Acknowledge Action — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an `error` run the same dismissing affordance approve/reject give a gate. An **"OK / Got it"** action moves the run's outcome **off `error`** to a new terminal outcome `dismissed`, so the errored instance **recedes from the live UI automatically** — exactly as an approved run flies to `done` and leaves. After this lands, **an unacknowledged `error` is the ONLY terminal state that lingers in the live UI**; once acknowledged, nothing terminal lingers.

This implements spec `docs/superpowers/specs/2026-06-17-agent-view-lifecycle-presentation.md` §4 (the `error` acknowledge action) and turns E2E cases **A1–A4 / T4 / PK3** (`docs/superpowers/specs/2026-06-17-agent-view-e2e-cases.md`) green.

**Architecture:** Symmetric with the gate-resolution seam. approve/reject resolve a **gate** → the run settles to `done`/`rejected` via `settle()` (the one terminal writer). `error` has no gate, so it gets its own terminal edge — a new edge `acknowledge` in `packages/server/src/transition.ts` (`terminal/error → terminal/dismissed`), routed through `settle()` exactly like `cancel`/`reject`. A new service method `acknowledge(workItemId)` + an HTTP route `POST /api/workitems/:id/acknowledge` mirror the gate-resolve/cancel routes. Client-side: the client liveness predicate keys `error` on `outcome === 'error'`; because `acknowledge` moves the outcome to `dismissed`, `displayStatus` no longer yields `'error'` for the run → the instance drops out of the live lists with **no separate "acknowledged" flag** — the transition does it. The UI renders an "OK / Got it" button in the same per-run slot the gate's approve/reject occupies (RunView → ThreadItems `ackSlot`), POSTing the acknowledge.

**Tech Stack:** TypeScript, Vitest, `@ag-ui/client` event vocabulary, Postgres (PGlite in tests; skip if unreachable), Hono, React + Testing Library, Vite library build for `@atizar/react`.

## Why `dismissed` (new outcome) and NOT `reset`

The plan brief asked to decide between reusing `reset` and adding a `dismissed` outcome. **Decision: add a new `dismissed` outcome.** Reasons, verified against `packages/core/src/lifecycle.ts` and `packages/server/src/settle.ts`:

- `reset`'s meaning is **"a human cleared the board"** (the bulk wipe primitive: `resetWorkflow`/`resetAll`/Start-over via `settleEdge(item.id, 'reset', …, {summary:'cleared from board'})`, `pipelineService.ts:215`). Its display label is **"Cleared"** (`lifecycleDisplay.ts`). Stamping an acknowledged error as `reset` would (a) mislabel it "Cleared" in audit/history, and (b) collapse two distinct human intents (bulk board-wipe vs "I saw this one crash and dismissed it") into one outcome — losing the audit trail the spec's symmetry (`OK → dismissed → leaves`) wants.
- `dismissed` slots cleanly into the existing classifier semantics with **zero new behavior axes**: it joins `RETIRED` (so `isVisible=false`, `covers=false` — it leaves the live board AND, like `error`, does NOT cover its source so a re-scan re-surfaces it; consistent with D4 "error source does not cover"). It is NOT in `HUMAN_TERMINAL` (an acknowledged error is no longer something the human must keep seeing). It maps to the `'done'` display lane (neutral, recedes), never red.

So `dismissed` is the precise analogue of `done`/`rejected` for the error path: a terminal outcome that **leaves** the live UI, distinct in audit, neutral in color.

## Global Constraints

> **READ FIRST — two standing rules for whoever implements this (the reason this whole plan set exists). Hold them on EVERY task:**
> 1. **Always think about the framework/app boundary.** Before placing any non-trivial code, ask: generic *mechanism* every workflow needs (→ `@atizar/*`) or *one workflow's policy* (→ `apps/inbox/...`)? A framework symbol carries ZERO workflow knowledge — no `reply/reader/spam/email/ticket` literals. Unsure → default to the app; lift only when a 2nd consumer proves it generic. Don't let the two get confused.
> 2. **Never multiply sources of truth.** One derivation per concept (liveness, status, priority, counts). Reuse the existing predicate/classifier; a new question is asked OF the one status, never a forked new set.
> 3. **DECISION (developer-confirmed): new `dismissed` outcome — do NOT reuse `reset`.** (Reasoning in the section above.)

- **Framework/app boundary (I5):** the `acknowledge` edge, the `dismissed` outcome, the service method + route, the `isLive` key on `outcome === 'error'`, and the "OK / Got it" button are all **framework-generic** (`@atizar/core`, `@atizar/server`, `@atizar/react`). Carry **zero** workflow literals (no `reply/reader/spam/email/sorter`). Any per-workflow wording of the button is policy and is NOT in this plan (the framework button reads a fixed generic "OK").
- **LOCKED foundation — I12 lifecycle ladder + core `Outcome` (DANGEROUS CHANGE):** adding `dismissed` to the core `Outcome` union, the `workItemOutcome` pgEnum, and a new `acknowledge` transition edge **edits the locked I12 ladder and the core lifecycle alphabet**. Per CLAUDE.md and the spec §10, this **requires the `check-foundation` skill to run AND the developer's explicit confirmation BEFORE the core/schema edits land** (Task 1 must not be committed until confirmation is recorded). The `guard-foundation-edits` hook will also prompt on the `ARCHITECTURE.md`/`PHILOSOPHY.md` touch if any. **Do not silently change the foundation.**
- **TDD:** no production code without a failing test first. Watch each test fail, then pass.
- **One terminal writer (U4):** the `acknowledge` edge MUST go through `settle()` — never a raw `applyEdge`/`update` outside it — so the LifecycleNote + audit row + status publish stay atomic, identical to `cancel`/`reject`.
- **One derivation per concept (single-source invariant):** the recede behavior comes for free from `displayStatus`/`isLive` keying on outcome — do NOT add an `acknowledged` boolean column or a second predicate. The transition off `error` IS the acknowledgement.
- **Green gate before "done":** `yarn typecheck && yarn test && yarn lint && yarn format:check` from repo root, plus `yarn workspace @atizar/react build` for the `@atizar/react` change.
- **Tests run from repo root** (`yarn test`); the server tests use PGlite via `db` and `describe.skipIf(!reachable)` — skip if Postgres/PGlite is unreachable.

---

### Task 1: Core + DB schema — add the `dismissed` outcome (LOCKED — needs check-foundation + explicit confirmation FIRST)

> **STOP — foundation gate.** This task edits the locked core `Outcome` union and the persisted enum. Per Global Constraints, run `check-foundation` (Task 7 invokes it formally, but this task's diff is the trigger) and obtain the developer's **explicit confirmation** that adding `dismissed` is approved **before committing this task**. Record the confirmation in the commit body.

**Files:**
- Modify: `packages/core/src/lifecycle.ts:13` (the `Outcome` union), `:38` (the `RETIRED` set comment + membership)
- Modify: `packages/server/src/db/schema.ts:29-37` (the `workItemOutcome` pgEnum)
- Create: a drizzle migration (via `drizzle-kit generate` — see Step 5)
- Test: `packages/core/src/lifecycle.test.ts` (add `dismissed` cases; reuse the existing file)

**Interfaces:**
- `export type Outcome = 'running' | 'done' | 'stopped' | 'rejected' | 'error' | 'superseded' | 'reset' | 'dismissed'`
- `dismissed` ∈ `RETIRED` (`isVisible=false`); ∉ `HUMAN_TERMINAL`; ∉ `COVERING_TERMINAL` (so `covers=false`).
- pgEnum `work_item_outcome` gains `'dismissed'` as the 8th value.

- [ ] **Step 1: Find the core lifecycle test file and confirm its shape**

Run: `ls packages/core/src/lifecycle.test.ts && yarn test packages/core/src/lifecycle.test.ts`
Expected: PASS (baseline). Read the file to match its existing `lifecycle(phase, outcome, hasCard, hasLiveDescendant)` assertion style. If no test file exists, create `packages/core/src/lifecycle.test.ts` importing `{ lifecycle }` from `./lifecycle.js`.

- [ ] **Step 2: Write the failing test for `dismissed`**

Add to `packages/core/src/lifecycle.test.ts`:

```ts
it('dismissed is a retired terminal: not live, not visible, does not cover', () => {
  const lc = lifecycle('terminal', 'dismissed', true, false)
  expect(lc.isLive).toBe(false)
  expect(lc.isVisible).toBe(false) // retired — leaves the live board (RETIRED), even with a card
  expect(lc.covers).toBe(false) // like error: a re-scan re-surfaces the source
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `yarn test packages/core/src/lifecycle.test.ts -t "dismissed"`
Expected: FAIL — `dismissed` is not a valid `Outcome` (typecheck error in the test) OR `isVisible` is `true` (no RETIRED membership). Either way, red before the edit.

- [ ] **Step 4: Add `dismissed` to the core lifecycle**

In `packages/core/src/lifecycle.ts`:

Extend the union (line 13):
```ts
export type Outcome =
  | 'running'
  | 'done'
  | 'stopped'
  | 'rejected'
  | 'error'
  | 'superseded'
  | 'reset'
  | 'dismissed'
```

Add `dismissed` to `RETIRED` (line 38) and update its comment:
```ts
// Terminal outcomes that have LEFT the board (retired into Activity/history) — never visible.
// `dismissed` = an acknowledged error ("OK / Got it"): the human saw the crash and dismissed it,
// so it recedes like reset/superseded but stays a DISTINCT outcome in audit/history.
const RETIRED: ReadonlySet<Outcome> = new Set(['superseded', 'reset', 'dismissed'])
```

Leave `HUMAN_TERMINAL` and `COVERING_TERMINAL` unchanged — `dismissed` deliberately joins neither (not must-see, not covering).

- [ ] **Step 5: Add `dismissed` to the DB enum + generate the migration**

In `packages/server/src/db/schema.ts`, extend `workItemOutcome` (lines 29-37):
```ts
export const workItemOutcome = pgEnum('work_item_outcome', [
  'running',
  'done',
  'stopped',
  'rejected',
  'error',
  'superseded',
  'reset',
  'dismissed',
])
```

Generate the migration (find the drizzle config + the existing migrations dir first):
```bash
ls packages/server/drizzle.config.* packages/server/src/db/migrations 2>/dev/null
yarn workspace @atizar/server drizzle-kit generate
```
Expected: a new migration SQL adding the enum value (`ALTER TYPE "work_item_outcome" ADD VALUE 'dismissed'`). If the repo applies migrations another way (check `packages/server/src/db/` for a `migrate`/bootstrap helper and how PGlite tests build their schema), follow that path — PGlite test setup must see `dismissed` as a legal enum value, or Task 3's settle test will fail on the insert/update. Confirm the test harness reads the schema from `schema.ts` (drizzle `pgEnum`) so the new value is present in-memory without a manual SQL step; if it applies SQL migrations, ensure the new migration is in the applied set.

- [ ] **Step 6: Run the test to verify it passes**

Run: `yarn test packages/core/src/lifecycle.test.ts -t "dismissed"`
Expected: PASS.

- [ ] **Step 7: Commit (only after explicit confirmation)**

```bash
git add packages/core/src/lifecycle.ts packages/core/src/lifecycle.test.ts packages/server/src/db/schema.ts packages/server/src/db/migrations
git commit -m "feat(core): add dismissed outcome — acknowledged-error terminal (retired, non-covering)

Foundation-touching (I12 ladder + core Outcome). check-foundation run; developer
explicitly confirmed adding the dismissed outcome before this landed.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Server — the `acknowledge` transition edge

**Files:**
- Modify: `packages/server/src/transition.ts:16-26` (the `Edge` union), `:45-60` (the `EDGES` table), `:81-85` (the outcome-guard block, mirror `reopen`)
- Modify: `packages/server/src/settle.ts:17` (`TerminalEdge` union), `:19-26` (`OUTCOME_OF` map)
- Test: `packages/server/src/transition.test.ts`, `packages/server/src/settle.test.ts`

**Interfaces:**
- `Edge` gains `'acknowledge'`. `EdgeSpec`: `acknowledge: { from: ['terminal'], to: 'terminal', outcome: 'dismissed' }`.
- Guard (mirror `reopen`): `acknowledge` is legal ONLY when `row.outcome === 'error'` — a done/stopped/rejected/superseded/reset item never acknowledges. Throw `IllegalTransition` otherwise.
- `TerminalEdge` (settle) gains `'acknowledge'`; `OUTCOME_OF.acknowledge = 'dismissed'`.

- [ ] **Step 1: Write the failing transition test**

In `packages/server/src/transition.test.ts`, add (matching the file's `newQueued`/`transition`/`store` harness):

```ts
it('acknowledge moves terminal/error → terminal/dismissed', async () => {
  const { id } = await newQueued()
  await transition(db, id, 'start')
  await transition(db, id, 'fail', { error: 'boom' }) // terminal/error
  await transition(db, id, 'acknowledge')
  const w = await store.getWorkItem(id)
  expect(w?.phase).toBe('terminal')
  expect(w?.outcome).toBe('dismissed')
})

it('acknowledge is illegal from a non-error terminal (only an error acknowledges)', async () => {
  const { id } = await newQueued()
  await transition(db, id, 'start')
  await transition(db, id, 'finish') // terminal/done
  await expect(transition(db, id, 'acknowledge')).rejects.toBeInstanceOf(IllegalTransition)
})

it('acknowledge is illegal from a live phase', async () => {
  const { id } = await newQueued()
  await transition(db, id, 'start') // active
  await expect(transition(db, id, 'acknowledge')).rejects.toBeInstanceOf(IllegalTransition)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test packages/server/src/transition.test.ts -t "acknowledge"`
Expected: FAIL — `'acknowledge'` is not assignable to `Edge` (typecheck) / edge unknown.

- [ ] **Step 3: Add the edge + the error-only guard**

In `packages/server/src/transition.ts`, add to the `Edge` union (after `'reopen'`):
```ts
  | 'acknowledge'
```

Add to the `EDGES` table (after `reopen`):
```ts
  // acknowledge: a human dismissed an errored run ("OK / Got it"). Moves the outcome OFF error
  // to `dismissed` so the run leaves the live UI (symmetric with approve→done / reject→rejected).
  // Legal ONLY from terminal/error (guarded below, like reopen's done-only guard).
  acknowledge: { from: ['terminal'], to: 'terminal', outcome: 'dismissed' },
```

Add the outcome guard next to the existing `reopen` guard (after line 85):
```ts
  if (edge === 'acknowledge' && row.outcome !== 'error') {
    throw new IllegalTransition(`cannot "acknowledge" a "${row.outcome}" item (work item ${id})`)
  }
```

- [ ] **Step 4: Run the transition test to verify it passes**

Run: `yarn test packages/server/src/transition.test.ts -t "acknowledge"`
Expected: PASS.

- [ ] **Step 5: Write the failing settle test (the terminal writer routes it)**

In `packages/server/src/settle.test.ts`, add a helper for an errored item, then the test (matching the file's `newActive`/`makeEventBus`/`store` harness):

```ts
it('acknowledge: terminal/dismissed + a lifecycle note + an audit row', async () => {
  const id = await newActive()
  const { transition } = await import('./transition.js')
  await transition(db, id, 'fail', { error: 'boom' }) // terminal/error
  const bus = makeEventBus()
  await settle({ db, store, bus, reconcile: () => {} }, id, 'acknowledge', 'tester')

  const wi = await store.getWorkItem(id)
  expect(wi?.phase).toBe('terminal')
  expect(wi?.outcome).toBe('dismissed')

  const trace = await store.getTrace(id, 0)
  const note = trace.find((t) => (t.event as any).name === 'lifecycle')
  expect((note?.event as any).value.outcome).toBe('dismissed')

  const audit = await store.getAuditByWorkItem(id)
  expect(audit.some((a) => a.kind === 'lifecycle')).toBe(true)
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `yarn test packages/server/src/settle.test.ts -t "acknowledge"`
Expected: FAIL — `'acknowledge'` not assignable to `TerminalEdge` / `OUTCOME_OF.acknowledge` missing.

- [ ] **Step 7: Add `acknowledge` to settle's `TerminalEdge` + `OUTCOME_OF`**

In `packages/server/src/settle.ts`:
```ts
export type TerminalEdge =
  | 'finish'
  | 'fail'
  | 'cancel'
  | 'reject'
  | 'supersede'
  | 'reset'
  | 'acknowledge'
```
```ts
const OUTCOME_OF: Record<TerminalEdge, Outcome> = {
  finish: 'done',
  fail: 'error',
  cancel: 'stopped',
  reject: 'rejected',
  supersede: 'superseded',
  reset: 'reset',
  acknowledge: 'dismissed',
}
```
(No other settle change — the existing transaction/note/audit/publish flow already handles any `TerminalEdge`.)

- [ ] **Step 8: Run the settle test to verify it passes**

Run: `yarn test packages/server/src/settle.test.ts -t "acknowledge"`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/transition.ts packages/server/src/transition.test.ts packages/server/src/settle.ts packages/server/src/settle.test.ts
git commit -m "feat(server): acknowledge edge — terminal/error to terminal/dismissed via settle()

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Server — `PipelineService.acknowledge` + the HTTP route

**Files:**
- Modify: `packages/server/src/pipelineService.ts` (add an `acknowledge(workItemId)` method near `cancel`, ~line 478; reuse the bound `settleEdge`)
- Modify: `packages/server/src/routes.ts` (add `POST /api/workitems/:id/acknowledge`, mirror the `cancel` route at lines 180-183)
- Test: `packages/server/src/pipelineService.test.ts` (add a method test, matching its harness) and/or a route test if the file covers routes; otherwise add to the existing pipelineService suite.

**Interfaces:**
- Service: `acknowledge(workItemId: string, actor?: string | null): Promise<void>` — calls `settleEdge(workItemId, 'acknowledge', actor ?? null, { summary: 'acknowledged' })`, then `publishBoard()` (so the board SSE pokes and the client refetches → the run recedes). It does NOT cascade to children (an errored leaf worker has none that need stopping; mirror nothing from `cancelItem`'s cascade).
- Route: `POST /api/workitems/:id/acknowledge` → `service.acknowledge(id, actor)` (resolve `actor` from the `Authorization` bearer exactly like the gate-resolve route, lines 146-147) → `c.json({ ok: true })`.
- The interface object returned by `createPipelineService` gains `acknowledge`.

- [ ] **Step 1: Read the service + its test harness**

Read `packages/server/src/pipelineService.ts` around the `cancel`/`cancelInstance` methods (lines 478-507) and the returned interface object. Read `packages/server/src/pipelineService.test.ts` to match how it builds a service over PGlite and drives a work item to `error` (look for an existing fail/error path; if none, use the bound observer or `transition(db, id, 'fail', …)` after dispatch — confirm `db`/`store`/`transition` are importable in that test as in `settle.test.ts`).

- [ ] **Step 2: Write the failing service test**

In `packages/server/src/pipelineService.test.ts`, add (adapt names to the file's existing `makeService`/`dispatch` helpers):

```ts
it('acknowledge moves an errored work item to terminal/dismissed', async () => {
  const svc = await makeService() // the file's existing service factory
  const { id } = await svc.dispatch({ workflowId: 'wf', agentId: 'wf__reply', origin: 'human', payload: {} })
  const { transition } = await import('./transition.js')
  await transition(db, id, 'start')
  await transition(db, id, 'fail', { error: 'boom' })

  await svc.acknowledge(id, 'tester')

  const wi = await store.getWorkItem(id)
  expect(wi?.outcome).toBe('dismissed')
})
```

(If the file's factory differs, match it. The assertion — `outcome === 'dismissed'` after `acknowledge` on an errored item — is the contract.)

- [ ] **Step 3: Run to verify it fails**

Run: `yarn test packages/server/src/pipelineService.test.ts -t "acknowledge"`
Expected: FAIL — `svc.acknowledge` is not a function (typecheck/runtime).

- [ ] **Step 4: Implement the service method**

In `packages/server/src/pipelineService.ts`, add near `cancel` (the `settleEdge` binding at line 128 is in scope):

```ts
    // Acknowledge an errored run ("OK / Got it"): settle it to terminal/dismissed so it leaves
    // the live UI (symmetric with approve→done / reject→rejected). No child cascade — an errored
    // leaf has nothing live to stop; the error-only guard in applyEdge rejects a non-error item.
    async acknowledge(workItemId: string, actor: string | null = null): Promise<void> {
      await settleEdge(workItemId, 'acknowledge', actor, { summary: 'acknowledged' }).catch(
        () => {}
      )
      publishBoard()
    },
```

Add `acknowledge` to the returned interface object (and to the service's TS interface/type if `createPipelineService`'s return is explicitly typed — grep for `PipelineService` type/`export interface`).

- [ ] **Step 5: Add the HTTP route**

In `packages/server/src/routes.ts`, after the `cancel` route (lines 180-183):

```ts
  // ACKNOWLEDGE an errored work item ("OK / Got it") — settle it off `error` to `dismissed` so it
  // recedes from the live UI (the error-analogue of a gate resolve). The error-only edge guard
  // makes a non-error id a no-op (settleEdge swallows the IllegalTransition).
  app.post('/api/workitems/:id/acknowledge', async (c) => {
    const authz = c.req.header('Authorization') ?? ''
    const actor = authz.startsWith('Bearer ') ? 'shared-token' : null
    await service.acknowledge(c.req.param('id'), actor)
    return c.json({ ok: true })
  })
```

- [ ] **Step 6: Run the service test (+ route test if the createServer suite covers it)**

Run: `yarn test packages/server/src/pipelineService.test.ts -t "acknowledge"`
Expected: PASS. Also run `yarn test packages/server/src/createServer.test.ts` to confirm no route-wiring regression.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/pipelineService.ts packages/server/src/pipelineService.test.ts packages/server/src/routes.ts
git commit -m "feat(server): PipelineService.acknowledge + POST /api/workitems/:id/acknowledge

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: React — `dismissed` display mapping (recede, neutral) + the `useAcknowledge` hook

**Files:**
- Modify: `packages/react/src/lifecycleDisplay.ts:9-17` (`OUTCOME_LABEL`), `:21-29` (`OUTCOME_TINT`) — add the `dismissed` entries (the `Record<Outcome, …>` is now non-exhaustive → typecheck FAILS until added; `displayStatus`'s `return 'done'` fallthrough already handles `terminal/dismissed` → `'done'`, so the run recedes)
- Create: `packages/react/src/hooks/useAcknowledge.ts` (the POST seam, mirror `useDispatch.cancel`)
- Modify: `packages/react/src/index.ts` (export `useAcknowledge`)
- Test: `packages/react/src/lifecycleDisplay.test.ts`

**Interfaces:**
- `OUTCOME_LABEL.dismissed = 'Dismissed'`; `OUTCOME_TINT.dismissed = 'stopped'` (neutral, NOT `'err'`/red).
- `displayStatus('terminal', 'dismissed')` returns `'done'` (already, via the final `return 'done'`) — assert it; this is what makes the run recede (no longer `'error'`).
- `useAcknowledge()` → `acknowledge(id: string): Promise<void>` POSTing `/api/workitems/:id/acknowledge` with `authHeaders(authToken)` (no JSON body — same shape as `cancel`).

- [ ] **Step 1: Write the failing display test**

In `packages/react/src/lifecycleDisplay.test.ts`, add:

```ts
it('dismissed recedes (done lane) and is neutral, not red', () => {
  expect(displayStatus('terminal', 'dismissed')).toBe('done') // no longer error → leaves live UI
  expect(OUTCOME_TINT.dismissed).not.toBe(OUTCOME_TINT.error) // neutral, not the red error tint
  expect(OUTCOME_LABEL.dismissed).toBe('Dismissed')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test packages/react/src/lifecycleDisplay.test.ts -t "dismissed"`
Expected: FAIL — `OUTCOME_LABEL`/`OUTCOME_TINT` are `Record<Outcome, …>` missing the `dismissed` key (typecheck error), and the new key reads are `undefined`.

- [ ] **Step 3: Add the `dismissed` display entries**

In `packages/react/src/lifecycleDisplay.ts`, add to `OUTCOME_LABEL`:
```ts
  dismissed: 'Dismissed',
```
and to `OUTCOME_TINT`:
```ts
  dismissed: 'stopped',
```
(`displayStatus` needs no change: `terminal/dismissed` is not `'error'`, so it falls through to `return 'done'` — the run recedes exactly like a `done` run.)

- [ ] **Step 4: Run the display test to verify it passes**

Run: `yarn test packages/react/src/lifecycleDisplay.test.ts`
Expected: PASS (incl. the existing cases).

- [ ] **Step 5: Write the failing hook test**

Create `packages/react/src/hooks/useAcknowledge.test.ts` (mock `fetch`, wrap in `WorkflowsConfig` provider if the hook reads `useWorkflowsConfig` — match how `useDispatch` is exercised; grep for an existing `useDispatch`-style hook test to copy the harness, e.g. a `renderHook` with a config wrapper):

```ts
it('POSTs the acknowledge endpoint for the work item id', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
  })
  const { result } = renderHookWithConfig(() => useAcknowledge())
  await result.current.acknowledge('wi-1')
  expect(calls[0].url).toBe('/api/workitems/wi-1/acknowledge')
  expect(calls[0].init?.method).toBe('POST')
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `yarn test packages/react/src/hooks/useAcknowledge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `useAcknowledge`**

```ts
import { useCallback } from 'react'
import { useWorkflowsConfig } from '../workflowsContext'
import { authHeaders } from '../authHeaders'

// Acknowledge an errored run ("OK / Got it"): a plain HTTP POST (no body), the error-analogue of
// a gate resolve. The server settles the run off `error` → `dismissed`, so the instance recedes
// from the live UI (displayStatus no longer yields 'error'). Mirrors useDispatch.cancel.
export const useAcknowledge = () => {
  const { authToken } = useWorkflowsConfig()
  const acknowledge = useCallback(
    async (id: string): Promise<void> => {
      await fetch(`/api/workitems/${id}/acknowledge`, {
        method: 'POST',
        headers: authHeaders(authToken),
      })
    },
    [authToken]
  )
  return { acknowledge }
}
```

Export it from `packages/react/src/index.ts`:
```ts
export { useAcknowledge } from './hooks/useAcknowledge.js'
```

- [ ] **Step 8: Run the hook test to verify it passes; build the lib**

Run: `yarn test packages/react/src/hooks/useAcknowledge.test.ts && yarn workspace @atizar/react build`
Expected: PASS; build clean.

- [ ] **Step 9: Commit**

```bash
git add packages/react/src/lifecycleDisplay.ts packages/react/src/lifecycleDisplay.test.ts packages/react/src/hooks/useAcknowledge.ts packages/react/src/hooks/useAcknowledge.test.ts packages/react/src/index.ts
git commit -m "feat(react): dismissed display (recede, neutral) + useAcknowledge POST hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: React — render the "OK / Got it" button on an error run

**Files:**
- Modify: `packages/react/src/components/AgentModal/ThreadItems.tsx:20-33` (props), `:148` (render slot) — add an optional `ackSlot?: ReactNode`, rendered in the same per-item slot as `gateSlot`
- Modify: `packages/react/src/components/RunView/RunView.tsx` (build the ack node when `display === 'error'`; pass it as `ackSlot`)
- Create: `packages/react/src/components/RunView/AcknowledgeButton.tsx` (the generic "OK / Got it" button, one component per file per CONVENTIONS)
- Test: `packages/react/src/components/RunView/AcknowledgeButton.test.tsx` (new)

**Interfaces:**
- `AcknowledgeButton` props: `type AcknowledgeButtonProps = { onAcknowledge: () => void }` — renders a button labelled `OK / Got it` (generic wording — workflow-specific phrasing is policy, out of scope). Arrow-const named-export component, `type {Name}Props` (CONVENTIONS).
- `ThreadItems` gains `ackSlot?: ReactNode`; render it where `gateSlot` renders (a run is awaiting OR errored, never both, so reusing the slot position is safe): `{ackSlot && <div className={s.threadItem}>{ackSlot}</div>}` right after the `gateSlot` line.
- `RunView`: when `display === 'error'`, build `ackSlot = <AcknowledgeButton onAcknowledge={() => void acknowledge(p.id)} />` using `useAcknowledge()`; otherwise `undefined`. Pass it to `ThreadItems`. (RunView already computes `display` at line 35.)

- [ ] **Step 1: Write the failing button test**

Create `packages/react/src/components/RunView/AcknowledgeButton.test.tsx`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AcknowledgeButton } from './AcknowledgeButton'

describe('AcknowledgeButton', () => {
  it('renders an OK affordance and fires onAcknowledge on click', () => {
    const onAcknowledge = vi.fn()
    render(<AcknowledgeButton onAcknowledge={onAcknowledge} />)
    fireEvent.click(screen.getByRole('button', { name: /ok|got it/i }))
    expect(onAcknowledge).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test packages/react/src/components/RunView/AcknowledgeButton.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `AcknowledgeButton`**

```tsx
// The error-analogue of the gate's approve/reject: a single "OK / Got it" affordance shown on an
// errored run. Clicking it acknowledges the error (server settles off `error` → `dismissed`), so
// the run recedes from the live UI. Generic wording — per-workflow phrasing is policy, not here.
export type AcknowledgeButtonProps = {
  onAcknowledge: () => void
}

export const AcknowledgeButton = ({ onAcknowledge }: AcknowledgeButtonProps) => (
  <button className='btn btn-ghost' onClick={onAcknowledge}>
    OK / Got it
  </button>
)
```

(Use the existing `btn`/`btn-ghost` classes the app uses for footer actions — confirm against `InstanceView.tsx:87`. If RunView wants a wrapper/label like "This run failed.", add it here as plain markup; keep it framework-neutral.)

- [ ] **Step 4: Run the button test to verify it passes**

Run: `yarn test packages/react/src/components/RunView/AcknowledgeButton.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire `ackSlot` through ThreadItems + RunView**

In `ThreadItems.tsx`: add `ackSlot?: ReactNode` to `ThreadItemsProps` and to the destructure; render it right after the `gateSlot` line (148):
```tsx
        {gateSlot && <div className={s.threadItem}>{gateSlot}</div>}
        {ackSlot && <div className={s.threadItem}>{ackSlot}</div>}
```

In `RunView.tsx`: import `useAcknowledge` + `AcknowledgeButton`; after computing `display` (line 35):
```tsx
  const { acknowledge } = useAcknowledge()
  const ackSlot =
    display === 'error' ? (
      <AcknowledgeButton onAcknowledge={() => void acknowledge(p.id)} />
    ) : undefined
```
Pass `ackSlot={ackSlot}` to `<ThreadItems …>`.

- [ ] **Step 6: Write/extend a RunView render test (error → button shows; non-error → no button)**

If a `RunView.test.tsx` exists, extend it; else create `packages/react/src/components/RunView/RunView.test.tsx` with a `useBoard` stub returning an item with `phase:'terminal', outcome:'error'` for the id and assert the "OK / Got it" button renders; with `outcome:'done'` assert it does NOT. Match the mocking of `useBoard`/`useWorkItemThread`/`useWorkflowsConfig` used in sibling component tests (grep `vi.mock('../../hooks/useBoard'` in the react suite for the pattern). If RunView's dependency graph is heavy to mock, assert the slot wiring at the `ThreadItems` level instead (pass `ackSlot` and assert it renders) — the button↔click behavior is already covered by Step 1.

- [ ] **Step 7: Run the react suite + build**

Run: `yarn test packages/react && yarn workspace @atizar/react build`
Expected: all PASS; build clean.

- [ ] **Step 8: Commit**

```bash
git add packages/react/src/components/AgentModal/ThreadItems.tsx packages/react/src/components/RunView/
git commit -m "feat(react): OK/Got it button on an errored run — POSTs acknowledge, run recedes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Green gate

**Files:** none (verification only).

- [ ] **Step 1: Full green gate from repo root**

Run: `yarn typecheck && yarn test && yarn lint && yarn format:check`
Expected: all PASS. The server tests use PGlite and `describe.skipIf(!reachable)` — they skip cleanly if Postgres/PGlite is unreachable; do NOT mark the gate failed on a skip, but DO confirm the new transition/settle/pipelineService tests RAN (not skipped) in an environment where PGlite is reachable before claiming done.

- [ ] **Step 2: React lib build**

Run: `yarn workspace @atizar/react build`
Expected: clean ESM + `.d.ts` + `react.css`.

- [ ] **Step 3: Fix any fallout, re-run, then commit if needed**

```bash
git add -p
git commit -m "test: green gate for error-acknowledge

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `check-foundation` (LOCKED — explicit confirmation gate)

**Files:** none (verification only). **This task gates Task 1's commit — run it BEFORE Task 1 lands; repeat here as the formal final pass.**

- [ ] **Step 1: Invoke the `check-foundation` skill against the full diff**

The change touches the **locked I12 lifecycle ladder** (a new `acknowledge` transition edge), the **core `Outcome` alphabet** (`dismissed`), and the **persisted enum**. Per CLAUDE.md ("the foundation is PROTECTED — never change it silently") and spec §10, this is a DANGEROUS change requiring an **explicit warning + the developer's direct confirmation**.

Expected verdict shape: the addition is **consistent** with the existing model — `acknowledge` is a sibling terminal edge routed through the one terminal writer `settle()` (U4, no new write path); `dismissed` joins `RETIRED` exactly as `reset`/`superseded` do (the I12 ladder's "retired → not visible" rung), and stays non-covering like `error` (D4). It introduces no machine action, no provider/AG-UI contract change (I3/I4), and no workflow literal in `@atizar/*` (I5). **The single new axis is one new terminal outcome value + one new edge** — flag it as such and obtain the developer's explicit confirmation; record it in the Task 1 commit body. If `check-foundation` raises a tension, STOP and resolve with the developer before proceeding.

---

### Task 8: Browser-verify (A1–A4, T4, PK3)

**Files:** none (verification only).

- [ ] **Step 1: Invoke the `browser-verify` skill; start the stack**

Per the `browser-verify` skill: clear stale dev servers, free `:4000`/`:5173`, start `yarn dev`. To force a deterministic error run, use a cassette/scenario that fails a worker (or `DEV_RECORD_REPLAY=record` against a forced-failure path). Keep dev mode OFF (`localStorage['aiw.dev']` unset) for consumer-surface assertions.

- [ ] **Step 2: A1 — the OK affordance renders on an errored run**

Open the errored worker instance's thread → confirm an **"OK / Got it"** button renders in the run, in the same slot a gate's approve/reject would occupy. (T4: before clicking, confirm the errored instance is **still visible** red in pipeline + card + picker; PK3: with ≥2 live instances the picker lists the errored one in red.)

- [ ] **Step 3: A2 — clicking OK recedes the run**

Click "OK / Got it" → confirm the run's status flips off red and the **instance recedes** from the pipeline, the card live overlay, and the picker (exactly like an approved run leaving). The open modal stays per the no-auto-close rule (Stop already absent on a terminal run); re-opening the agent with 0 live instances lands on the descriptive type-view.

- [ ] **Step 4: A3 — START stays available on the input agent while the worker erred**

Confirm an errored worker does NOT block the input agent's START (error ∉ `isBusy`). (This is existing behavior; assert no regression.)

- [ ] **Step 5: A4 — an input-scan error needs no OK**

Force an input-scan error, then re-START → confirm the errored scan is **superseded/gone** after the re-scan (no OK needed at the input level; the acknowledge action is for worker errors). Assert no leftover red scan.

- [ ] **Step 6: Record findings; final commit if verification produced fixes**

```bash
git add -p
git commit -m "test: browser-verify error acknowledge (A1-A4, T4, PK3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage (§4):** the new server edge `acknowledge` (Task 2) moves `terminal/error → terminal/dismissed` through `settle()` (the one terminal writer, U4) — symmetric with approve→done / reject→rejected; the service method + HTTP route (Task 3) mirror the gate-resolve/cancel seam; the client `displayStatus` recede comes for free because `dismissed ≠ 'error'` (Task 4), with NO separate "acknowledged" flag (single-source); the "OK / Got it" button (Task 5) sits in the same per-run slot as the gate's approve/reject. A1–A4 / T4 / PK3 are the browser acceptance (Task 8).
- **Outcome decision recorded:** new `dismissed` outcome (NOT `reset`) — distinct audit/label, joins `RETIRED` (leaves the board) but stays non-covering like `error`; rationale in the dedicated section. This is the one place the plan added a new value to the locked alphabet — flagged as the foundation trigger.
- **Foundation discipline:** Task 1 carries a STOP gate (check-foundation + explicit developer confirmation BEFORE the core/schema edit commits); Task 7 repeats it as the formal final pass. The constraint is stated in Global Constraints and both tasks.
- **Single-source / boundary (I5):** recede is one derivation (`displayStatus`/the client `isLive`), not a duplicated predicate or a new column; no workflow literal enters `@atizar/*` (the button reads a fixed generic "OK / Got it"; per-workflow wording is explicitly out of scope).
- **Type consistency across tasks:** `dismissed` (Task 1 core/enum) is the exact outcome stamped by the `acknowledge` edge (Task 2 `EDGES`/`OUTCOME_OF`) and labeled/tinted (Task 4); `acknowledge` (Task 2 `Edge`/`TerminalEdge`) is the exact edge `settleEdge` calls in `PipelineService.acknowledge` (Task 3); `useAcknowledge().acknowledge` (Task 4) is the exact hook `RunView` calls (Task 5).
- **Dependency note (called out, not hidden):** the client `isLive` predicate the spec references (`packages/react/src/liveness.ts`, plan P0) does **not exist yet** in the repo — it is a sibling plan's deliverable. This plan does NOT depend on it being present: the recede behavior is delivered here purely via `displayStatus('terminal','dismissed') → 'done'` (which the existing `InstanceView`/board/`displayStatus` consumers already honor). When the P0 `isLive` lands keyed on `outcome === 'error'`, this change composes with it automatically (an acknowledged run is no longer `error`, so `isLive` excludes it) — no rework. The browser steps (Task 8) assume the P0/recede surfaces; if P0 has not yet landed, T4/A2's "recede from pipeline/card/picker" is verified via `displayStatus` alone and the picker/overlay behavior is confirmed against whatever live-filter is current.
- **Migration risk flagged:** Task 1 Step 5 (the enum migration / PGlite schema bootstrap) is the one place that can silently break the server tests — the task explicitly tells the implementer to confirm the test harness sees `dismissed` (schema-from-`pgEnum` vs applied SQL migration) before relying on Task 2/3 green.
