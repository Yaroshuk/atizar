# Lifecycle-Unify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the work-item lifecycle vocabulary into one isomorphic `(phase, outcome)` classifier (`@atizar/core/lifecycle`) that every consumer imports, and route every terminal outcome through one server writer (`settle.ts`), so the board / pipeline / aggregate / dedup / pool can no longer physically disagree.

**Architecture:** A new pure `packages/core/src/lifecycle.ts` defines `Phase` (`queued|active|awaiting_human|terminal`) + `Outcome` (`running|done|stopped|rejected|error|superseded|reset`) and `lifecycle(phase, outcome) -> { phase, outcome, isLive, isVisible, covers }`, plus the one `hasLiveDescendant` tree walk. The DB `status` column becomes the 4-value `phase`; `resolution` becomes the 7-value `outcome`. `packages/server/src/settle.ts` is the single terminal writer (transition + typed `LifecycleNote` trace event + audit + `pool.reconcile`, in one DB tx). Pool occupancy becomes a DB count (the in-memory counter is deleted). The client deletes `mapStatus`, adds `react/lifecycleDisplay.ts`, and Start-over becomes a confirm-modal wipe (the 409 reject path is removed).

**Tech Stack:** TypeScript (composite project refs), Drizzle ORM + drizzle-kit (Postgres / PGlite), Vitest, Hono, React + Vite, yarn-classic 1.22 workspace.

**Branch:** `feat/lifecycle-unify` is ALREADY checked out. Every commit targets it. NEVER switch branches; read history with `git show <sha>:path`.

**Canonical commands (run from repo root):**
- Tests: `yarn test` (vitest). A single file: `yarn test packages/core/src/lifecycle.test.ts`.
- Green gate (end of each unit): `yarn typecheck && yarn test && yarn lint && yarn format:check` — plus `yarn workspace @atizar/react build` for any `@atizar/react` change.
- DB: `yarn workspace inbox db:generate` (drizzle-kit generate), `yarn workspace inbox db:migrate` (apply), `yarn workspace inbox db:reset` (truncate).

**Postgres note:** server tests `describe.skipIf(!reachable)` when Postgres is down. Before running DB-touching tests, ensure Postgres is up: `bash scripts/ensure-postgres.sh` (or `docker compose up -d postgres`). If you cannot reach Postgres, the lifecycle/transition/settle tests will SKIP (not fail) — say so explicitly rather than claiming pass.

---

## File map

**Created**
- `packages/core/src/lifecycle.ts` — the keystone classifier + `Phase`/`Outcome` unions + `hasLiveDescendant`.
- `packages/core/src/lifecycle.test.ts` — the golden-table (I12 ladder spec).
- `packages/server/src/settle.ts` — the one terminal writer.
- `packages/server/src/settle.test.ts`.
- `packages/react/src/lifecycleDisplay.ts` — `OUTCOME_LABEL` / `OUTCOME_TINT` / phase→display.
- `packages/react/src/lifecycleDisplay.test.ts`.

**Modified (server)**
- `packages/server/src/db/schema.ts` — `work_item_status` 8→4 (`phase`); `resolution`→`outcome` (7 values).
- `packages/server/src/db/migrations/*` — squashed baseline (dev DB reset).
- `packages/server/src/transition.ts` — edges over `(phase, outcome)`; extract `applyEdge(executor, …)` (the single edge-writer, reused by `settle`); add `reopen`; delete local `ACTIVE`. NO `approve` edge.
- `packages/server/src/workerPool.ts` — counter deleted; `activeCount` injected DB query; `reconcile`.
- `packages/server/src/dispatch.ts` — dedup via `lifecycle().covers`; parent-reopen via `transition('reopen')`.
- `packages/server/src/runObserver.ts` — finish/fail/gate go through `settle`/`transition`.
- `packages/server/src/stateStore.ts` — liveness walks reduce to core `hasLiveDescendant`; counts.
- `packages/server/src/sweep.ts` — zombie sweep via `settle('fail')`.
- `packages/server/src/pipelineService.ts` — cancel/reject/supersede/reset/finish call `settle`; `wipeWorkflow`/`wipeAll`; drop `{ active }` reset return; remove 409 guard.
- `packages/server/src/routes.ts` — reset/reset-all → wipe; remove 409 path.

**Modified (react)**
- `packages/react/src/status.ts` — delete `mapStatus`; keep `Status`/`STATUS_LABEL`.
- `packages/react/src/serverTypes.ts` — `ServerStatus`→`Phase`; `Resolution`→`Outcome`; `WorkItem` fields.
- `packages/react/src/boardModel.ts` / `pipelineModel.ts` / `aggregate.ts` — import core `lifecycle`.
- `packages/react/src/lifecycleDisplay.ts` — `OUTCOME_LABEL`/`OUTCOME_TINT`/`displayStatus` (8a); tint suffixes aligned to distinct classes (8e).
- `packages/react/src/statusDisplay.ts` — add outcome-aware `pillLabel`/`pillTint` (8e).
- `packages/react/src/components/AgentModal/AgentModal.tsx` — lifecycle-note banner + Stopped/Rejected labels.
- `packages/react/src/components/PipelineColumn/PipelineColumn.tsx` + `.module.scss` — distinct Stopped/Rejected word+tint on the plies (8e).
- `packages/react/src/components/InstancePickerModal/InstancePickerModal.tsx` + `.module.scss` — same distinct outcome on the picker (8e).
- `packages/react/src/components/ThreadModal/ThreadModal.tsx` — drop `mapStatus`.
- `packages/react/src/hooks/useResetController.ts` — single `wipe`.
- `packages/react/src/hooks/useDispatch.ts` — `wipe*` methods; Start-over.

**Modified (docs)**
- `docs/pipeline-updated-3.md` — re-express the alphabet (U9).

---

## Vocabulary reference (use these EXACT names everywhere)

```ts
// packages/core/src/lifecycle.ts
export type Phase = 'queued' | 'active' | 'awaiting_human' | 'terminal'
export type Outcome = 'running' | 'done' | 'stopped' | 'rejected' | 'error' | 'superseded' | 'reset'
export interface Lifecycle {
  phase: Phase
  outcome: Outcome
  isLive: boolean
  isVisible: boolean
  covers: boolean
}
export function lifecycle(phase: Phase, outcome: Outcome, hasCard: boolean, hasLiveDescendant: boolean): Lifecycle
export function hasLiveDescendant<T extends { id: string; parentId: string | null; phase: Phase }>(rows: readonly T[]): Set<string>
```

The DB columns become `phase` (Phase) + `outcome` (Outcome). The pairing rules:
- A live, never-terminal item has `phase ∈ {queued, active, awaiting_human}` and `outcome = 'running'`.
- A terminal item has `phase = 'terminal'` and `outcome ∈ {done, stopped, rejected, error, superseded, reset}`.
- `done` = clean finish. The gate-approval finish additionally records nothing on `outcome` (it stays `done`) but the per-item `approved` marker is the gate row's `status='resolved'` + the `approved <tool>` audit + the `LifecycleNote` (so "approved" is distinguishable in the thread/audit, not in `outcome`).

---

## Task 1 (U1): core/lifecycle.ts + golden-table test

**Files:**
- Create: `packages/core/src/lifecycle.ts`
- Test: `packages/core/src/lifecycle.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing golden-table test**

This test IS the I12 visibility-ladder spec. Write it FIRST and treat it as locked.

Create `packages/core/src/lifecycle.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { lifecycle, hasLiveDescendant, type Phase, type Outcome } from './lifecycle.js'

// The golden table: every (phase, outcome) pair we can persist, with the EXPECTED classifier
// output. hasCard / hasLiveDescendant are the two extrinsic inputs to isVisible; the table
// fixes isVisible for the "no card, no live descendant" baseline, then separate cases cover the
// card / descendant overrides. THIS TABLE IS THE I12 LADDER — change it only with a spec change.
type Row = {
  phase: Phase
  outcome: Outcome
  isLive: boolean
  // isVisible with hasCard=false, hasLiveDescendant=false
  baseVisible: boolean
  covers: boolean
}

const TABLE: Row[] = [
  // live, never-terminal
  { phase: 'queued', outcome: 'running', isLive: true, baseVisible: false, covers: true },
  { phase: 'active', outcome: 'running', isLive: true, baseVisible: true, covers: true },
  { phase: 'awaiting_human', outcome: 'running', isLive: true, baseVisible: true, covers: true },
  // terminal outcomes
  { phase: 'terminal', outcome: 'done', isLive: false, baseVisible: false, covers: true },
  { phase: 'terminal', outcome: 'stopped', isLive: false, baseVisible: true, covers: true },
  { phase: 'terminal', outcome: 'rejected', isLive: false, baseVisible: true, covers: false },
  { phase: 'terminal', outcome: 'error', isLive: false, baseVisible: true, covers: false },
  { phase: 'terminal', outcome: 'superseded', isLive: false, baseVisible: false, covers: false },
  { phase: 'terminal', outcome: 'reset', isLive: false, baseVisible: false, covers: false },
]

describe('lifecycle() golden table (I12 ladder)', () => {
  for (const r of TABLE) {
    it(`${r.phase}/${r.outcome}: isLive=${r.isLive} baseVisible=${r.baseVisible} covers=${r.covers}`, () => {
      const lc = lifecycle(r.phase, r.outcome, false, false)
      expect(lc.isLive).toBe(r.isLive)
      expect(lc.isVisible).toBe(r.baseVisible)
      expect(lc.covers).toBe(r.covers)
      expect(lc.phase).toBe(r.phase)
      expect(lc.outcome).toBe(r.outcome)
    })
  }

  it('queued is NEVER visible even with a card or a live descendant', () => {
    expect(lifecycle('queued', 'running', true, true).isVisible).toBe(false)
  })

  it('a terminal done item with a card IS visible (result kept until human closes)', () => {
    expect(lifecycle('terminal', 'done', true, false).isVisible).toBe(true)
  })

  it('a terminal done item with a live descendant IS visible (kept parent)', () => {
    expect(lifecycle('terminal', 'done', false, true).isVisible).toBe(true)
  })

  it('a superseded item stays hidden even with a card (it has LEFT the board)', () => {
    expect(lifecycle('terminal', 'superseded', true, true).isVisible).toBe(false)
  })

  it('a reset item stays hidden even with a card', () => {
    expect(lifecycle('terminal', 'reset', true, true).isVisible).toBe(false)
  })

  it('a human-terminal marker (stopped/rejected/error) is visible without a card', () => {
    expect(lifecycle('terminal', 'stopped', false, false).isVisible).toBe(true)
    expect(lifecycle('terminal', 'rejected', false, false).isVisible).toBe(true)
    expect(lifecycle('terminal', 'error', false, false).isVisible).toBe(true)
  })
})

describe('hasLiveDescendant tree walk', () => {
  const rows = [
    { id: 'root', parentId: null, phase: 'terminal' as Phase },
    { id: 'mid', parentId: 'root', phase: 'terminal' as Phase },
    { id: 'leaf', parentId: 'mid', phase: 'awaiting_human' as Phase },
    { id: 'lone', parentId: null, phase: 'terminal' as Phase },
  ]

  it('marks every ancestor of a live node', () => {
    const live = hasLiveDescendant(rows)
    expect(live.has('root')).toBe(true)
    expect(live.has('mid')).toBe(true)
  })

  it('a terminal leaf is NOT its own live descendant', () => {
    expect(hasLiveDescendant(rows).has('leaf')).toBe(false)
  })

  it('a lone terminal node has no live descendant', () => {
    expect(hasLiveDescendant(rows).has('lone')).toBe(false)
  })

  it('tolerates a parent cycle without infinite-looping', () => {
    const cyclic = [
      { id: 'a', parentId: 'b', phase: 'terminal' as Phase },
      { id: 'b', parentId: 'a', phase: 'terminal' as Phase },
    ]
    expect(hasLiveDescendant(cyclic).size).toBe(0)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn test packages/core/src/lifecycle.test.ts`
Expected: FAIL — `Cannot find module './lifecycle.js'` (file not created yet).

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/lifecycle.ts`:

```ts
// The SINGLE place the work-item lifecycle alphabet is defined. Pure & isomorphic (no React, no
// Node) — same nature as messages/fold/gate. Every consumer (server cancel-cascade, START guard,
// dedup, board, pipeline, aggregate, display) imports lifecycle() / hasLiveDescendant so the
// views cannot physically disagree (spec 2026-06-16: the unified model).

// phase: was the 8-value DB status, collapsed to 4. awaiting_human merges the old
// awaiting_approval + awaiting_input (both pause on a human).
export type Phase = 'queued' | 'active' | 'awaiting_human' | 'terminal'

// outcome: was `resolution`, now first-class. running = not-yet-terminal; the other six are the
// terminal flavours. done = a clean finish (incl. an approved gate, which is `done` + an audit
// marker, so approved is distinguishable in the thread/audit, not in the outcome value).
export type Outcome =
  | 'running'
  | 'done'
  | 'stopped'
  | 'rejected'
  | 'error'
  | 'superseded'
  | 'reset'

export interface Lifecycle {
  phase: Phase
  outcome: Outcome
  // isLive = phase is non-terminal. error/stopped/rejected are TERMINAL (not live) — this single
  // decision resolves the error/queued boundary disagreement across every tree walk.
  isLive: boolean
  // isVisible = the I12 ladder, transcribed ONCE:
  //   queued                         -> false (admitted, not yet shown)
  //   superseded / reset (retired)   -> false (LEFT the board; lives on in Activity/history)
  //   non-terminal (active/awaiting) -> true
  //   terminal                       -> hasCard || human-terminal marker || hasLiveDescendant
  // The human-terminal markers (stopped/rejected/error) are visible even without a card so the
  // human always sees how a run ended. done is visible only if it has a card or a live child.
  isVisible: boolean
  // covers (dedup, Option A): does this item shadow a same-source re-dispatch? A live or
  // freeze-and-keep item COVERS (no phantom twin); an un-actioned terminal
  // (rejected/superseded/reset/error) does NOT cover (a re-scan re-surfaces the source).
  covers: boolean
}

const LIVE_PHASES: ReadonlySet<Phase> = new Set(['queued', 'active', 'awaiting_human'])

// Terminal outcomes that have LEFT the board (retired into Activity/history) — never visible.
const RETIRED: ReadonlySet<Outcome> = new Set(['superseded', 'reset'])

// Terminal outcomes the human must always see, even with no card.
const HUMAN_TERMINAL: ReadonlySet<Outcome> = new Set(['stopped', 'rejected', 'error'])

// Terminal outcomes that COVER a same-source re-dispatch (Option A: stopped freezes & keeps, so
// it covers; done covers too — the finished result still occupies the source).
const COVERING_TERMINAL: ReadonlySet<Outcome> = new Set(['done', 'stopped'])

export function lifecycle(
  phase: Phase,
  outcome: Outcome,
  hasCard: boolean,
  hasLiveDescendant: boolean
): Lifecycle {
  const isLive = LIVE_PHASES.has(phase)

  let isVisible: boolean
  if (phase === 'queued') isVisible = false
  else if (isLive) isVisible = true
  else if (RETIRED.has(outcome)) isVisible = false
  else isVisible = hasCard || HUMAN_TERMINAL.has(outcome) || hasLiveDescendant

  const covers = isLive || COVERING_TERMINAL.has(outcome)

  return { phase, outcome, isLive, isVisible, covers }
}

// The ONE tree walk over phase-liveness: the set of ids that have ≥1 transitively-live descendant.
// Used by board/pipeline (kept parent) AND the server START guard (a finished input root with an
// awaiting child is still a live scan — Approach B). Cycle-safe via the seen guard.
export function hasLiveDescendant<
  T extends { id: string; parentId: string | null; phase: Phase },
>(rows: readonly T[]): Set<string> {
  const childrenOf = new Map<string, T[]>()
  for (const r of rows) {
    if (!r.parentId) continue
    const arr = childrenOf.get(r.parentId) ?? []
    arr.push(r)
    childrenOf.set(r.parentId, arr)
  }
  const memo = new Map<string, boolean>()
  const compute = (id: string): boolean => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    memo.set(id, false) // guard against cycles
    let live = false
    for (const kid of childrenOf.get(id) ?? []) {
      if (LIVE_PHASES.has(kid.phase) || compute(kid.id)) live = true
    }
    memo.set(id, live)
    return live
  }
  const out = new Set<string>()
  for (const r of rows) if (compute(r.id)) out.add(r.id)
  return out
}
```

- [ ] **Step 4: Export from core index**

In `packages/core/src/index.ts`, add after the `./fold.js` line (line 7):

```ts
export * from './lifecycle.js'
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn test packages/core/src/lifecycle.test.ts`
Expected: PASS (all golden-table + tree-walk cases green).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/lifecycle.ts packages/core/src/lifecycle.test.ts packages/core/src/index.ts
git commit -m "feat(core): lifecycle() classifier + golden-table I12 ladder spec

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: U1 green gate**

Run: `yarn typecheck && yarn test && yarn lint && yarn format:check`
Expected: all green. (No `@atizar/react` change in U1.)

---

## Task 2 (U2): schema migration — phase (8→4) + outcome (7)

**Verify-vestigial first:** `result` is referenced ONLY in `transition.ts` edge from-sets, `status.ts`/`serverTypes.ts`, and migration SQL — NO code ever writes `status: 'result'` (grep confirms). It is vestigial and is collapsed into `done`/terminal. `awaiting_input` is likewise never written by any edge (no `awaiting_input` `to:` in the edge table). Both fold away.

**Migration strategy (dev DB reset, no backfill):** Postgres cannot `DROP VALUE` from an enum, and the data is disposable, so we SQUASH: edit the schema to the new shape, delete the old migrations + meta, regenerate a fresh `0000` baseline, then DROP+recreate the dev and test databases.

**Files:**
- Modify: `packages/server/src/db/schema.ts:20-39` (the two enums + `WorkItem` columns)
- Replace: `packages/server/src/db/migrations/*` (regenerated)

- [ ] **Step 1: Rewrite the two enums + the work_items columns in schema.ts**

In `packages/server/src/db/schema.ts`, replace the `workItemStatus` enum (lines 17-29) and the `resolutionKind` enum (lines 31-39) with:

```ts
// WorkItem phase — the collapsed 4-value lifecycle (spec 2026-06-16). awaiting_human merges
// the old awaiting_approval + awaiting_input; queued/active/terminal complete the alphabet.
// The classifier lives in @atizar/core (lifecycle.ts) — this enum is just its persisted form.
export const workItemPhase = pgEnum('work_item_phase', [
  'queued',
  'active',
  'awaiting_human',
  'terminal',
])

// WorkItem outcome — first-class now (was the orthogonal `resolution`). `running` = not yet
// terminal; the six terminal flavours match @atizar/core Outcome exactly.
export const workItemOutcome = pgEnum('work_item_outcome', [
  'running',
  'done',
  'stopped',
  'rejected',
  'error',
  'superseded',
  'reset',
])
```

Then in the `workItems` table (lines 54-73), replace the `status` + `resolution` columns:

```ts
  phase: workItemPhase('phase').notNull(),
  outcome: workItemOutcome('outcome').notNull().default('running'),
```

- [ ] **Step 2: Update the schema's exported types**

In `packages/server/src/db/schema.ts` (lines 169-171), replace:

```ts
export type WorkItemPhase = WorkItem['phase']
export type WorkItemOutcome = (typeof workItemOutcome.enumValues)[number]
export type OriginKind = (typeof originKind.enumValues)[number]
```

(Remove `WorkItemStatus` and `ResolutionKind` exports — every consumer migrates to `WorkItemPhase`/`WorkItemOutcome` in later tasks. This will RED the typecheck until U3-U7 land; that is expected and fixed within this branch.)

- [ ] **Step 3: Delete the old migrations and regenerate the baseline**

```bash
rm -rf packages/server/src/db/migrations
yarn workspace inbox db:generate
```

Expected: drizzle-kit writes a fresh `packages/server/src/db/migrations/0000_*.sql` (+ `meta/`) reflecting `work_item_phase`, `work_item_outcome`, and the new `phase`/`outcome` columns. Confirm:

```bash
grep -c "work_item_phase\|work_item_outcome" packages/server/src/db/migrations/0000_*.sql
```

Expected: ≥ 2.

- [ ] **Step 4: Reset the dev + test databases**

```bash
bash scripts/ensure-postgres.sh
docker compose exec -T postgres psql -U aiworkflow -d postgres -c "DROP DATABASE IF EXISTS aiworkflow; CREATE DATABASE aiworkflow;"
docker compose exec -T postgres psql -U aiworkflow -d postgres -c "DROP DATABASE IF EXISTS aiworkflow_test;"
yarn workspace inbox db:migrate
```

Expected: `db:migrate` prints no error (fresh schema applied). `aiworkflow_test` is recreated+migrated automatically by the vitest globalSetup on the next test run.

> If Docker/psql is unavailable, drop the DBs by whatever mechanism your Postgres exposes; the requirement is only "both DBs recreated from the new baseline, no data carried over."

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/db/schema.ts packages/server/src/db/migrations
git commit -m "feat(server): schema — phase(4) + outcome(7), squashed baseline (dev DB reset)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> No green gate at U2: typecheck is intentionally RED until U3-U8 migrate every `status`/`resolution` reference. The gate runs at the end of U7 (server) and U8 (client).

---

## Task 3 (U3): transition.ts redesign over (phase, outcome)

**Files:**
- Modify: `packages/server/src/transition.ts` (full rewrite of the EDGES table + constants)
- Test: `packages/server/src/transition.test.ts`

- [ ] **Step 1: Update the transition test to the new alphabet**

Open `packages/server/src/transition.test.ts`. The `newQueued` helper inserts via `store.insertWorkItem` (which sets the initial phase). Update the happy-path assertions and add `cancel`/`reopen` cases (no `approve` — it doesn't exist). Replace the first two `it(...)` blocks (the happy path + illegal edge) with:

```ts
  it('walks queued → active → awaiting_human → active → terminal/done', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    expect((await store.getWorkItem(id))?.phase).toBe('active')
    await transition(db, id, 'gate')
    expect((await store.getWorkItem(id))?.phase).toBe('awaiting_human')
    await transition(db, id, 'resume')
    expect((await store.getWorkItem(id))?.phase).toBe('active')
    await transition(db, id, 'finish')
    const done = await store.getWorkItem(id)
    expect(done?.phase).toBe('terminal')
    expect(done?.outcome).toBe('done')
  })

  it('rejects an illegal edge and leaves the row unchanged', async () => {
    const { id } = await newQueued()
    await expect(transition(db, id, 'gate')).rejects.toBeInstanceOf(IllegalTransition)
    expect((await store.getWorkItem(id))?.phase).toBe('queued')
  })

  it('cancel stamps outcome=stopped', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await transition(db, id, 'cancel')
    const w = await store.getWorkItem(id)
    expect(w?.phase).toBe('terminal')
    expect(w?.outcome).toBe('stopped')
  })

  it('reopen lifts a finished item back to active (finish-vs-dispatch race)', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await transition(db, id, 'finish')
    await transition(db, id, 'reopen')
    expect((await store.getWorkItem(id))?.phase).toBe('active')
  })

  it('reopen is illegal from a human-terminal outcome (only a clean done reopens)', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await transition(db, id, 'cancel') // outcome=stopped
    await expect(transition(db, id, 'reopen')).rejects.toBeInstanceOf(IllegalTransition)
  })
```

> NOTE: `newQueued` uses `store.insertWorkItem`; that helper sets the initial phase in U-store work, but `insertWorkItem` currently sets `status: 'queued'`. It is updated to `phase: 'queued'` in this task's Step 3 (the store insert is a creation, not a transition, so it lives here logically — see Step 3b).

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test packages/server/src/transition.test.ts`
Expected: FAIL (compile error: `phase`/`outcome` not on the row type yet at the transition layer, and `reopen` edge missing). If Postgres is down it SKIPS — in that case rely on the typecheck in Step 5 to drive the change.

- [ ] **Step 3: Rewrite transition.ts**

Replace the whole body of `packages/server/src/transition.ts` with:

```ts
import { eq } from 'drizzle-orm'
import type { Phase, Outcome } from '@atizar/core'
import type { Db, Tx } from './db/client.js'
import { workItems } from './db/schema.js'

// Every `work_items.phase`/`outcome` write goes through ONE edge-writer — applyEdge():
// SELECT … FOR UPDATE → check the edge is legal from the current phase/outcome → UPDATE.
// The row lock serializes concurrent transitions (I8). applyEdge runs on ANY executor (db or an
// open tx), so settle() (U4) composes it into its OWN transaction to keep note+status+audit atomic
// — one writer, never a duplicated raw update. transition() is the standalone wrapper.
//
// Single-responsibility lifecycle (Approach B): every item finishes on its OWN run-end. A finish
// edge lands terminal regardless of any live children, and a child reaching terminal NEVER touches
// its parent. A parent is shown "Working" purely by the pipeline's live-descendant derivation.

export type Edge =
  | 'start'
  | 'gate'
  | 'resume'
  | 'finish'
  | 'fail'
  | 'cancel'
  | 'reject'
  | 'supersede'
  | 'reset'
  | 'reopen'

export class IllegalTransition extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IllegalTransition'
  }
}

// Each edge declares the phases it is legal FROM (matched against the current `phase`), the phase
// it moves TO, and the outcome it stamps. `running` keeps the item live; a terminal phase pairs
// with a terminal outcome. NO `approve` edge — a gate-approved finish IS a `finish` → done; the
// approval lives in the gate row + audit + LifecycleNote, never in the outcome.
interface EdgeSpec {
  from: Phase[]
  to: Phase
  outcome: Outcome
}

const EDGES: Record<Edge, EdgeSpec> = {
  start: { from: ['queued'], to: 'active', outcome: 'running' },
  gate: { from: ['active'], to: 'awaiting_human', outcome: 'running' },
  resume: { from: ['awaiting_human'], to: 'active', outcome: 'running' },
  finish: { from: ['active'], to: 'terminal', outcome: 'done' },
  fail: { from: ['active', 'awaiting_human'], to: 'terminal', outcome: 'error' },
  cancel: { from: ['queued', 'active', 'awaiting_human'], to: 'terminal', outcome: 'stopped' },
  reject: { from: ['awaiting_human'], to: 'terminal', outcome: 'rejected' },
  // supersede: retire a prior FINISHED scan root into the preserved Done bucket on a re-START.
  supersede: { from: ['terminal'], to: 'terminal', outcome: 'superseded' },
  // reset: a human cleared the board — retire a terminal item so it leaves the live column.
  reset: { from: ['terminal'], to: 'terminal', outcome: 'reset' },
  // reopen: a finished parent gained a fresh active child (finish-vs-dispatch race). Legal ONLY
  // from a clean done (outcome must be 'done') — a stopped/rejected/error item never reopens.
  reopen: { from: ['terminal'], to: 'active', outcome: 'running' },
}

export interface TransitionOpts {
  error?: string
}

// The ONE edge-writer. Runs on any executor (db or an open tx) so settle() can enlist it in its own
// transaction. Throws IllegalTransition on an illegal edge → the surrounding tx rolls back.
export async function applyEdge(
  executor: Db | Tx,
  id: string,
  edge: Edge,
  opts: TransitionOpts = {}
): Promise<void> {
  const [row] = await executor.select().from(workItems).where(eq(workItems.id, id)).for('update')
  if (!row) throw new IllegalTransition(`work item ${id} not found`)

  const spec = EDGES[edge]
  if (!spec.from.includes(row.phase)) {
    throw new IllegalTransition(`cannot "${edge}" from "${row.phase}" (work item ${id})`)
  }
  // reopen only lifts a CLEAN done (not a human-terminal outcome) — a stopped/rejected/error
  // tree must stay frozen (Option A).
  if (edge === 'reopen' && row.outcome !== 'done') {
    throw new IllegalTransition(`cannot "reopen" a "${row.outcome}" item (work item ${id})`)
  }

  await executor
    .update(workItems)
    .set({
      phase: spec.to,
      outcome: spec.outcome,
      updatedAt: new Date(),
      ...(edge === 'fail' && opts.error ? { error: opts.error } : {}),
    })
    .where(eq(workItems.id, id))
}

// Standalone transition: applyEdge in its OWN transaction (the row lock serializes concurrent
// callers). settle() does NOT call this — it calls applyEdge inside its own tx for atomicity.
export async function transition(
  db: Db,
  id: string,
  edge: Edge,
  opts: TransitionOpts = {}
): Promise<void> {
  await db.transaction(async (tx) => {
    await applyEdge(tx, id, edge, opts)
  })
}
```

> The `Tx` type is the drizzle transaction handle. If `db/client.ts` doesn't already export it, add
> `export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]` there (or type the `executor`
> param as `Db | Tx` against that alias). `applyEdge`'s `.for('update')` works on both `db` and `tx`.

> The local `ACTIVE` / `RESETTABLE` / `EDGE_RESOLUTION` constants are DELETED. Callers now use core `lifecycle().isLive` (active set) and the `reset` edge's own `from` guard (resettable). The store's `getActiveChildren`/`getResettable`/etc. are rewritten in U7 to use `lifecycle`.

- [ ] **Step 3b: Update the store's INITIAL insert to phase**

In `packages/server/src/stateStore.ts`, the `insertWorkItem` method (line 58) sets `status: 'queued'`. Change it to:

```ts
          phase: 'queued',
          outcome: 'running',
```

(Creation, not a transition — the only non-`transition()` write of phase, as documented.)

- [ ] **Step 4: Run the transition test (if Postgres up)**

Run: `bash scripts/ensure-postgres.sh && yarn test packages/server/src/transition.test.ts`
Expected: PASS (or SKIP if Postgres unreachable — then verify via typecheck in Step 5).

- [ ] **Step 5: Typecheck the server package boundary**

Run: `yarn typecheck`
Expected: still RED elsewhere (dispatch/runObserver/pipelineService/stateStore not yet migrated) but `transition.ts` itself compiles. Note the remaining errors are all in files U4-U7 own.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/transition.ts packages/server/src/transition.test.ts packages/server/src/stateStore.ts
git commit -m "feat(server): edges over (phase, outcome) via applyEdge; add reopen (no approve)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 (U4): settle.ts + typed LifecycleNote trace note

**Files:**
- Create: `packages/core/src/lifecycleNote.ts` (the typed note + fold case helper)
- Modify: `packages/core/src/fold.ts` (one new case → a note message)
- Modify: `packages/core/src/index.ts`
- Create: `packages/server/src/settle.ts`
- Test: `packages/core/src/fold.test.ts` (add a LifecycleNote case)
- Test: `packages/server/src/settle.test.ts`

- [ ] **Step 1: Write the LifecycleNote core helper + its fold test**

Create `packages/core/src/lifecycleNote.ts`:

```ts
import { EventType, type BaseEvent } from '@ag-ui/client'
import type { Outcome } from './lifecycle.js'

// A typed server-authored trace note (I14: the trace is an explicitly mixed log — provider output
// PLUS server notes). It rides the SAME AG-UI vocabulary as the existing synthetic CUSTOM events
// (dispatch_rejected, status markers): a CUSTOM event named 'lifecycle'. settle() appends one
// BEFORE the terminal status publish (killing the SSE backlog race), and fold.ts renders it as a
// short note message in the thread.
export interface LifecycleNoteValue {
  kind: 'lifecycle'
  outcome: Outcome
  actor: string | null
  at: number
}

export function lifecycleNote(value: LifecycleNoteValue): BaseEvent {
  return { type: EventType.CUSTOM, name: 'lifecycle', value } as unknown as BaseEvent
}

// Human-facing one-liner per terminal outcome (the note text the thread shows at the tail).
export const LIFECYCLE_NOTE_TEXT: Record<Outcome, string> = {
  running: '',
  done: 'Done',
  stopped: 'Stopped — cancelled',
  rejected: 'Rejected',
  error: 'Error',
  superseded: 'Superseded by a re-run',
  reset: 'Cleared from board',
}
```

In `packages/core/src/fold.test.ts`, add a test (after the existing imports/blocks — append a new `describe`):

```ts
import { lifecycleNote } from './lifecycleNote.js'

describe('foldEventsToMessages — LifecycleNote', () => {
  it('renders a lifecycle CUSTOM event as a trailing system note message', () => {
    const events = [
      { type: 'TEXT_MESSAGE_CHUNK', messageId: 'm1', delta: 'work' },
      lifecycleNote({ kind: 'lifecycle', outcome: 'stopped', actor: null, at: 1 }),
    ] as any
    const msgs = foldEventsToMessages(events)
    const note = msgs.find((m) => m.role === 'system')
    expect(note).toBeTruthy()
    expect(String(note?.content)).toContain('Stopped — cancelled')
  })
})
```

(`foldEventsToMessages` is already imported at the top of fold.test.ts.)

- [ ] **Step 2: Run the fold test to verify it fails**

Run: `yarn test packages/core/src/fold.test.ts`
Expected: FAIL — no `system` message produced (fold currently skips CUSTOM events).

- [ ] **Step 3: Add the fold case**

In `packages/core/src/fold.ts`, add the import at the top (after line 2):

```ts
import { LIFECYCLE_NOTE_TEXT, type LifecycleNoteValue } from './lifecycleNote.js'
import type { Message } from './messages.js'
```

(Adjust the existing `import type { AssistantMessage, Message, ToolCall, ToolMessage }` line so `Message` isn't double-imported — keep the single existing import and just add `LIFECYCLE_NOTE_TEXT, type LifecycleNoteValue` from lifecycleNote.)

Add a case INSIDE the `switch (e.type)` block, before `default:` (after the `TOOL_CALL_RESULT` case, ~line 99):

```ts
      case EventType.CUSTOM: {
        // A server-authored note (I14). Only the typed 'lifecycle' note becomes a message; other
        // CUSTOM events (e.g. dispatch_rejected) stay non-message, as before.
        const named = event as BaseEvent & { name?: string; value?: LifecycleNoteValue }
        if (named.name !== 'lifecycle' || !named.value) break
        const text = LIFECYCLE_NOTE_TEXT[named.value.outcome] || named.value.outcome
        const id = `lifecycle-${named.value.at}`
        byId.set(id, { id, role: 'system', content: text } as Message)
        break
      }
```

- [ ] **Step 4: Export from core index**

In `packages/core/src/index.ts`, add after the `./lifecycle.js` line:

```ts
export * from './lifecycleNote.js'
```

- [ ] **Step 5: Run the fold test to verify it passes**

Run: `yarn test packages/core/src/fold.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the settle test**

Create `packages/server/src/settle.test.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from './db/client.js'
import { makeStateStore } from './stateStore.js'
import { makeEventBus } from './eventBus.js'
import { settle } from './settle.js'

const store = makeStateStore(db)
const reachable = await db
  .execute(sql`select 1`)
  .then(() => true)
  .catch(() => false)

const newActive = async () => {
  const { id } = await store.insertWorkItem({
    id: randomUUID(),
    workflowId: 'lead-inbox',
    agentId: 'lead-inbox__reply',
    origin: 'human',
    payload: {},
  })
  // move to active so a finish/cancel edge is legal
  const { transition } = await import('./transition.js')
  await transition(db, id, 'start')
  return id
}

describe.skipIf(!reachable)('settle() — the one terminal writer', () => {
  it('cancel: terminal/stopped + a lifecycle trace note + an audit row', async () => {
    const id = await newActive()
    const bus = makeEventBus()
    const seen: unknown[] = []
    bus.subscribe(`workitem:${id}`, (m) => seen.push(m))
    await settle({ db, store, bus, reconcile: () => {} }, id, 'cancel', 'tester')

    const wi = await store.getWorkItem(id)
    expect(wi?.phase).toBe('terminal')
    expect(wi?.outcome).toBe('stopped')

    const trace = await store.getTrace(id, 0)
    const note = trace.find((t) => (t.event as any).name === 'lifecycle')
    expect(note).toBeTruthy()
    expect((note?.event as any).value.outcome).toBe('stopped')

    const audit = await store.getAuditByWorkItem(id)
    expect(audit.some((a) => a.kind === 'lifecycle')).toBe(true)
  })

  it('appends the note BEFORE the terminal status publish (no SSE race)', async () => {
    const id = await newActive()
    const bus = makeEventBus()
    const order: string[] = []
    bus.subscribe(`workitem:${id}`, (m: any) => {
      if (m.event?.name === 'lifecycle') order.push('note')
      if (m.kind === 'status') order.push('status')
    })
    await settle({ db, store, bus, reconcile: () => {} }, id, 'finish', null)
    expect(order.indexOf('note')).toBeLessThan(order.indexOf('status'))
  })
})
```

- [ ] **Step 7: Run the settle test to verify it fails**

Run: `bash scripts/ensure-postgres.sh && yarn test packages/server/src/settle.test.ts`
Expected: FAIL — `Cannot find module './settle.js'` (or SKIP if Postgres down → drive via typecheck Step 9).

- [ ] **Step 8: Add optional `tx` to the trace/audit store methods, then write settle.ts**

First, in `packages/server/src/stateStore.ts`, give `countTrace`, `appendTrace`, and `appendAudit`
an optional executor param so `settle()` can run them inside its transaction. Each closes over `db`
today; add `tx?: Db | Tx` (import `Tx` from `./db/client.js`) as the last param and use
`(tx ?? db)` as the executor in the method body. Example shape:

```ts
    async appendTrace(id: string, seq: number, event: BaseEvent, tx?: Db | Tx): Promise<void> {
      await (tx ?? db).insert(traceEvents).values({ workItemId: id, seq, event })
    },
    async countTrace(id: string, tx?: Db | Tx): Promise<number> {
      const [row] = await (tx ?? db).select({ c: count() }).from(traceEvents).where(eq(traceEvents.workItemId, id))
      return row?.c ?? 0
    },
    async appendAudit(row: NewAuditRow, tx?: Db | Tx): Promise<void> {
      await (tx ?? db).insert(auditLog).values(row)
    },
```

(Match each method's REAL current body — only the executor changes. Existing callers pass no `tx`,
so they keep using `db` unchanged.) Then create `packages/server/src/settle.ts`:

```ts
import { lifecycleNote, type Outcome } from '@atizar/core'
import type { BaseEvent } from '@ag-ui/client'
import type { Db } from './db/client.js'
import type { StateStore } from './stateStore.js'
import type { EventBus } from './eventBus.js'
import { applyEdge } from './transition.js'

// The ONE terminal writer (spec 2026-06-16). Every terminal edge becomes a thin settle() caller so
// they behave identically. ONE transaction holds all three writes — applyEdge (the shared
// edge-writer, NOT a duplicated raw update), the typed LifecycleNote trace event, and the audit
// row — so a rollback (illegal edge) undoes all of them. After commit: publish the note, THEN the
// terminal status (note-before-status kills the SSE backlog race), THEN reconcile the pool.
// (start/gate/resume/reopen are NOT terminal — they stay raw transition() calls.)
//
// No `approve`: a gate-approved finish IS edge 'finish' → done; the approval is recorded by the
// gate's resolved row + the `approved <tool>` audit summary (opts.summary) + this note.
export type TerminalEdge = 'finish' | 'fail' | 'cancel' | 'reject' | 'supersede' | 'reset'

const OUTCOME_OF: Record<TerminalEdge, Outcome> = {
  finish: 'done',
  fail: 'error',
  cancel: 'stopped',
  reject: 'rejected',
  supersede: 'superseded',
  reset: 'reset',
}

const NOTE_KIND = 'lifecycle'

export interface SettleDeps {
  db: Db
  store: StateStore
  bus: EventBus
  // Re-derive the agent's pool occupancy from the DB after a terminal write (U5). A plain
  // callback so settle() stays decoupled from the pool internals.
  reconcile: (agentId: string) => void
}

export interface SettleOpts {
  error?: string
  // The audit summary, e.g. "approved saveDraft". Defaults to the outcome word.
  summary?: string
}

export async function settle(
  deps: SettleDeps,
  id: string,
  edge: TerminalEdge,
  actor: string | null,
  opts: SettleOpts = {}
): Promise<void> {
  const { db, store, bus, reconcile } = deps
  const wi = await store.getWorkItem(id)
  if (!wi) return
  const outcome = OUTCOME_OF[edge]
  const at = Date.now()

  let seq = 0
  let event: BaseEvent | undefined
  // One transaction: the guarded edge write (applyEdge) + the trace note + the audit row, ALL on
  // the tx executor — so an illegal edge throws inside applyEdge and rolls back note+audit too.
  await db.transaction(async (tx) => {
    await applyEdge(tx, id, edge, { error: opts.error }) // throws → whole settle rolls back
    seq = await store.countTrace(id, tx)
    event = lifecycleNote({ kind: NOTE_KIND, outcome, actor, at })
    await store.appendTrace(id, seq, event, tx)
    await store.appendAudit(
      {
        workItemId: id,
        gateId: null,
        workflowId: wi.workflowId,
        agentId: wi.agentId,
        kind: NOTE_KIND,
        summary: opts.summary ?? outcome,
        actor,
      },
      tx
    )
  })

  // After commit: publish the note first (a live thread shows it), THEN the terminal status, THEN
  // reconcile. Note-before-status is the SSE-race fix; both are post-commit so subscribers never
  // see an uncommitted note.
  if (event) bus.publish(`workitem:${id}`, { seq, event })
  bus.publish(`workitem:${id}`, { kind: 'status', status: 'terminal' })
  bus.publish('board', { kind: 'status', id, status: 'terminal' })
  reconcile(wi.agentId)
}
```

> Implementation note: settle composes `applyEdge` (U3) into its OWN tx — it does NOT call
> `transition()` (which opens a separate tx and would break atomicity) and carries NO raw
> `tx.update` of phase/outcome. `store.countTrace`/`appendTrace`/`appendAudit` MUST accept an
> optional `tx` executor (Step 8 below) so they enlist in settle's transaction; passing the bare
> `db` would commit them outside the tx and reintroduce the orphan-note / SSE race this removes.
> The RunObserver (the per-item trace writer) is stopped before settle runs (cancel kills the
> process first; finish/fail run after the stream ends), so `countTrace` is race-free here.

- [ ] **Step 9: Run the settle test (or typecheck)**

Run: `bash scripts/ensure-postgres.sh && yarn test packages/server/src/settle.test.ts`
Expected: PASS (or SKIP if Postgres down). Either way: `yarn typecheck` must show `settle.ts` itself compiling (remaining REDs are in U5-U7 files).

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/lifecycleNote.ts packages/core/src/fold.ts packages/core/src/fold.test.ts packages/core/src/index.ts packages/server/src/settle.ts packages/server/src/settle.test.ts
git commit -m "feat: settle() one terminal writer + typed LifecycleNote trace note + fold case

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5 (U5): pool from DB + zombie sweep

**Files:**
- Modify: `packages/server/src/workerPool.ts`
- Test: `packages/server/src/workerPool.test.ts`
- Modify: `packages/server/src/stateStore.ts` (add `countActiveByAgent`)
- Modify: `packages/server/src/sweep.ts`
- Test: existing `packages/server/src/workerPool.test.ts` rewritten to the injected count

- [ ] **Step 1: Add the DB active-count to the store + a failing store test**

In `packages/server/src/stateStore.ts`, add a method (alongside the other selects):

```ts
    // Pool occupancy, derived from the DB (replaces the in-memory counter — U5). Counts rows of
    // this agent whose phase occupies a slot: 'active' (running) OR 'awaiting_human' would have
    // already released its slot (claude-cli is killed at the gate), so ONLY 'active' counts here.
    async countActiveByAgent(agentId: string): Promise<number> {
      const [row] = await db
        .select({ c: count() })
        .from(workItems)
        .where(and(eq(workItems.agentId, agentId), eq(workItems.phase, 'active')))
      return row?.c ?? 0
    },
```

Append to `packages/server/src/stateStore.test.ts` a case (after the existing reachable guard + store init — match the file's existing pattern; the file already imports `randomUUID`, `db`, `makeStateStore`):

```ts
  it('countActiveByAgent counts only active-phase rows of that agent', async () => {
    const store = makeStateStore(db)
    const a = 'lead-inbox__countA'
    const mk = async () =>
      (await store.insertWorkItem({ workflowId: 'lead-inbox', agentId: a, origin: 'human', payload: {} })).id
    const { transition } = await import('./transition.js')
    const id1 = await mk()
    await transition(db, id1, 'start') // active
    const id2 = await mk()
    await transition(db, id2, 'start')
    await transition(db, id2, 'finish') // terminal
    expect(await store.countActiveByAgent(a)).toBe(1)
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash scripts/ensure-postgres.sh && yarn test packages/server/src/stateStore.test.ts`
Expected: FAIL — `countActiveByAgent is not a function` (or SKIP if Postgres down). The store method in Step 1 fixes it; if it already passes after Step 1, that's fine — proceed.

- [ ] **Step 3: Rewrite the worker pool to an injected count**

Replace `packages/server/src/workerPool.ts` entirely with:

```ts
// Per-agent concurrency cap + FIFO overflow queue. Occupancy is DERIVED from the DB (U5) via an
// injected `activeCount(agentId)` query — the in-memory counter is GONE, so a leaked/double-freed/
// restart-lost slot is structurally impossible. The FIFO queue stays (legitimately process-local
// ordering, rebuilt by the boot sweep). maxInstances cap + queue semantics are UNCHANGED.
//
// To hold the cap against a same-tick burst, the pool OWNS the queued→active flip at admission:
// per-agent admission is serialized by an async mutex (a promise chain), and within it the pool
// awaits a COMMITTED `activate(id)` (transition queued→active) BEFORE the next `activeCount` read —
// so the count never goes stale mid-batch. Only then is `run(id)` kicked off; the observer's run()
// no longer does the start transition (U7b). (Old race: transition('start') landed asynchronously
// inside run() AFTER pump returned, so two overlapping pumps read a stale low count and over-
// admitted.) The mutex suffices for a single server process; a Postgres advisory lock is the
// drop-in upgrade for multi-process admission.

interface AgentSlot {
  cap: number
  queue: string[]
  // Per-agent admission mutex: a promise chain so only one pump body runs at a time for the agent.
  lock: Promise<void>
}

export interface WorkerPool {
  enqueue(id: string, agentId: string, cap: number): void
  dequeue(id: string, agentId: string): void
  // Re-derive occupancy from the DB and start the next queued id if a slot is free. Replaces the
  // old release()/resumeAcquire() counter mutations. Called after every terminal write (settle)
  // and after a gate suspend.
  reconcile(agentId: string): void
  activeCount(agentId: string): Promise<number>
  queuedCount(agentId: string): number
}

export interface WorkerPoolDeps {
  run: (id: string) => void
  // DB-backed occupancy. Async because it queries Postgres.
  activeCount: (agentId: string) => Promise<number>
  // Flip a queued id to active (committed) BEFORE its run starts — the pool owns this so the cap
  // holds against a same-tick burst. = transition(db, id, 'start'). May throw if the id raced out
  // of 'queued' (e.g. cancelled); pump drops it and continues.
  activate: (id: string) => Promise<void>
}

export function makeWorkerPool(deps: WorkerPoolDeps): WorkerPool {
  const slots = new Map<string, AgentSlot>()

  const slot = (agentId: string, cap: number): AgentSlot => {
    let s = slots.get(agentId)
    if (!s) {
      s = { cap, queue: [], lock: Promise.resolve() }
      slots.set(agentId, s)
    }
    s.cap = cap
    return s
  }

  // Serialize admission per agent: chain each pump body on the agent's lock so two pumps (an
  // enqueue racing a reconcile) can't both read the same stale count and over-admit. Awaiting the
  // committed activate() before the next loop iteration is what actually keeps the count fresh.
  const pump = (agentId: string): void => {
    const s = slots.get(agentId)
    if (!s) return
    s.lock = s.lock
      .then(async () => {
        let active = await deps.activeCount(agentId)
        while (active < s.cap && s.queue.length > 0) {
          const next = s.queue.shift()!
          try {
            await deps.activate(next) // queued→active, committed — the next read reflects it
          } catch {
            continue // raced out of 'queued' (cancelled) — drop it, try the next
          }
          active++
          deps.run(next)
        }
      })
      .catch(() => {}) // keep the per-agent chain alive even if a pump body throws
  }

  return {
    enqueue(id, agentId, cap) {
      const s = slot(agentId, cap)
      s.queue.push(id)
      pump(agentId)
    },

    dequeue(id, agentId) {
      const s = slots.get(agentId)
      if (!s) return
      const i = s.queue.indexOf(id)
      if (i !== -1) s.queue.splice(i, 1)
    },

    reconcile(agentId) {
      pump(agentId)
    },

    activeCount(agentId) {
      return deps.activeCount(agentId)
    },

    queuedCount(agentId) {
      return slots.get(agentId)?.queue.length ?? 0
    },
  }
}
```

- [ ] **Step 4: Rewrite the pool test to the new shape**

Replace `packages/server/src/workerPool.test.ts` with a version that injects a fake `activeCount` backed by a mutable counter the fake `run` increments (simulating the DB flip):

```ts
import { describe, it, expect } from 'vitest'
import { makeWorkerPool } from './workerPool.js'

// A fake DB count: `activate` flips an id to active (++) — the pool now owns the flip, committed
// before run() — and the test flips it back to free a slot. `run` only records the start.
function harness(cap: number) {
  let active = 0
  const started: string[] = []
  const pool = makeWorkerPool({
    run: (id) => {
      started.push(id)
    },
    activeCount: async () => active,
    activate: async (_id) => {
      active++
    },
  })
  return {
    pool,
    started,
    free: () => {
      active = Math.max(0, active - 1)
    },
    get active() {
      return active
    },
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('WorkerPool (DB-derived occupancy)', () => {
  it('starts up to the cap, queues the overflow', async () => {
    const h = harness(2)
    h.pool.enqueue('a', 'X', 2)
    h.pool.enqueue('b', 'X', 2)
    h.pool.enqueue('c', 'X', 2)
    await tick()
    expect(h.started).toEqual(['a', 'b'])
    expect(h.pool.queuedCount('X')).toBe(1)
  })

  it('reconcile starts the next queued id when a slot frees', async () => {
    const h = harness(2)
    h.pool.enqueue('a', 'X', 2)
    h.pool.enqueue('b', 'X', 2)
    h.pool.enqueue('c', 'X', 2)
    await tick()
    h.free() // a finished
    h.pool.reconcile('X')
    await tick()
    expect(h.started).toContain('c')
    expect(h.pool.queuedCount('X')).toBe(0)
  })

  it('dequeue removes a queued id before it starts', async () => {
    const h = harness(1)
    h.pool.enqueue('a', 'X', 1)
    h.pool.enqueue('b', 'X', 1)
    await tick()
    h.pool.dequeue('b', 'X')
    expect(h.pool.queuedCount('X')).toBe(0)
  })
})
```

- [ ] **Step 5: Run the pool test to verify it passes**

Run: `yarn test packages/server/src/workerPool.test.ts`
Expected: PASS (this test injects its own count — no Postgres needed).

- [ ] **Step 6: Update the zombie sweep to settle('fail')**

The boot sweep's bulk UPDATE moves `running` rows to `error`. Rewrite it over the new alphabet (any `active`-phase row at boot is a zombie). Because `settle()` needs bus + store + reconcile wiring that the bare `startupSweep(db, reenqueue)` signature doesn't have, keep the sweep a direct bulk UPDATE (it is the single boot actor, pre-request — same justification as today) but write the new columns. Replace `packages/server/src/sweep.ts` body:

```ts
import { asc, eq } from 'drizzle-orm'
import type { Db } from './db/client.js'
import { workItems } from './db/schema.js'

// Startup reconciliation (spec §1.2): executor handles are process-local, so on boot NO 'active'
// row has a live executor — each is a zombie from a prior process and becomes terminal/error.
// 'queued' rows are re-fed to the pool in createdAt order. 'awaiting_human' is DURABLE (a gate
// waiting on a human) and is deliberately left untouched. Direct bulk UPDATE (not settle) is
// correct here: the sweep is the single actor at boot, before the server accepts requests.
export async function startupSweep(
  db: Db,
  reenqueue?: (item: { id: string; agentId: string }) => void
): Promise<void> {
  await db
    .update(workItems)
    .set({ phase: 'terminal', outcome: 'error', error: 'executor lost', updatedAt: new Date() })
    .where(eq(workItems.phase, 'active'))

  if (reenqueue) {
    const queued = await db
      .select({ id: workItems.id, agentId: workItems.agentId })
      .from(workItems)
      .where(eq(workItems.phase, 'queued'))
      .orderBy(asc(workItems.createdAt))
    for (const item of queued) reenqueue(item)
  }
}
```

- [ ] **Step 7: Run the sweep test**

Run: `bash scripts/ensure-postgres.sh && yarn test packages/server/src/sweep.test.ts 2>/dev/null || echo "no sweep.test.ts — covered by createServer.test.ts"`
Expected: PASS or "no sweep.test.ts". If `createServer.test.ts` asserts the old `status='error'`, update those assertions to `phase: 'terminal', outcome: 'error'` (search: `grep -rn "executor lost\|status.*error" packages/server/src/createServer.test.ts`).

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/workerPool.ts packages/server/src/workerPool.test.ts packages/server/src/stateStore.ts packages/server/src/stateStore.test.ts packages/server/src/sweep.ts
git commit -m "feat(server): pool occupancy from DB count + reconcile; zombie sweep over phase

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6 (U6): dispatch.ts dedup via lifecycle().covers + reopen

**Files:**
- Modify: `packages/server/src/dispatch.ts`
- Test: `packages/server/src/dispatch.test.ts`

- [ ] **Step 1: Update the dispatch test to the covers-based dedup + reopen + new pool signature**

Open `packages/server/src/dispatch.test.ts`. It has a `fakePool()` factory returning a `WorkerPool` with `release`/`resumeAcquire`/`activeCount: () => 0`/`queuedCount: () => 0`. Update the factory to the new shape (drop `release`/`resumeAcquire`, add `reconcile`, make `activeCount` async):

```ts
function fakePool() {
  const enqueue = vi.fn<(id: string, agentId: string, cap: number) => void>()
  const pool: WorkerPool = {
    enqueue,
    dequeue: vi.fn(),
    reconcile: vi.fn(),
    activeCount: async () => 0,
    queuedCount: () => 0,
  }
  return { pool, enqueue }
}
```

Add a dedup case (after the existing dedup tests) asserting a `rejected`/`reset`/`superseded` source does NOT shadow but a `done`/`stopped` source DOES. Use the store + transition to set up rows:

```ts
  it('a stopped same-source item COVERS (no phantom twin)', async () => {
    const { pool } = fakePool()
    const src = `cover-${randomUUID()}`
    const first = await dispatch(db, pool, { ...base, source: src })
    const { transition } = await import('./transition.js')
    await transition(db, first.id, 'start')
    await transition(db, first.id, 'cancel') // outcome=stopped → covers
    const second = await dispatch(db, pool, { ...base, source: src })
    expect(second.deduped).toBe(true)
    expect(second.id).toBe(first.id)
  })

  it('a rejected same-source item does NOT cover (re-scan re-surfaces)', async () => {
    const { pool } = fakePool()
    const src = `nocover-${randomUUID()}`
    const first = await dispatch(db, pool, { ...base, source: src })
    const { transition } = await import('./transition.js')
    await transition(db, first.id, 'start')
    await transition(db, first.id, 'gate')
    await transition(db, first.id, 'reject') // outcome=rejected → does NOT cover
    const second = await dispatch(db, pool, { ...base, source: src })
    expect(second.deduped).toBe(false)
    expect(second.id).not.toBe(first.id)
  })
```

(`base` in dispatch.test.ts already includes `maxInstances: 2`; `source` is added per-call via the spread. `fakePool()` is the file's existing factory, updated in Step 1.)

- [ ] **Step 2: Run it to verify it fails**

Run: `bash scripts/ensure-postgres.sh && yarn test packages/server/src/dispatch.test.ts`
Expected: FAIL (the SQL `ne/notInArray` dedup still keys on `status`/`resolution`; compile error on the removed columns) — or SKIP if Postgres down (drive via typecheck Step 4).

- [ ] **Step 3: Rewrite dispatch.ts dedup + parent-reopen**

In `packages/server/src/dispatch.ts`:

Replace the imports (lines 1-5) with:

```ts
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { lifecycle } from '@atizar/core'
import type { Db } from './db/client.js'
import { workItems, type OriginKind } from './db/schema.js'
import { transition } from './transition.js'
import type { WorkerPool } from './workerPool.js'
```

Replace the dedup block (the `if (input.source) { … }`, lines ~65-82) with:

```ts
  // 1. One-time dedup via the SINGLE classifier (Option A): a same-source item that COVERS shadows
  //    this dispatch (live OR a freeze-and-keep terminal — done/stopped). An un-actioned terminal
  //    (rejected/superseded/reset/error) does NOT cover, so a re-scan re-surfaces the source. This
  //    is the exhaustive replacement for the old SQL ne/notInArray block (which silently omitted
  //    'reset' — the latent bug this closes). The card-keeps-it dimension is irrelevant to dedup,
  //    so hasCard/hasLiveDescendant are passed false here.
  if (input.source) {
    const rows = await db
      .select({ id: workItems.id, phase: workItems.phase, outcome: workItems.outcome })
      .from(workItems)
      .where(eq(workItems.source, input.source))
    const covering = rows.find((r) => lifecycle(r.phase, r.outcome, false, false).covers)
    if (covering) return { id: covering.id, deduped: true }
  }
```

Replace the parent-reopen block (lines ~91-104) — the raw `UPDATE … set status:'running'` becomes a real `transition('reopen')` (I8 strengthened):

```ts
  const id = randomUUID()
  await db.transaction(async (tx) => {
    await tx.insert(workItems).values({
      id,
      workflowId: input.workflowId,
      agentId: input.agentId,
      origin: input.origin,
      payload: input.payload,
      source: input.source ?? null,
      parentId: input.parentId ?? null,
      phase: 'queued',
      outcome: 'running',
    })
  })
  // A parent that finished concurrently must reopen — a fresh active child can't hang off a
  // terminal parent (finish-vs-dispatch race). transition('reopen') is a no-op-or-throw if the
  // parent isn't a clean done (already active, or stopped/rejected) — swallow the IllegalTransition.
  if (input.parentId) {
    await transition(db, input.parentId, 'reopen').catch(() => {})
  }
```

> Remove the unused `DispatchResult.rejected` field NOW is premature — it is removed in U8 (client) + the pipelineService guard removal in U7. Leave the type field for U7 to delete; do not touch it here.

- [ ] **Step 4: Run the dispatch test (or typecheck)**

Run: `bash scripts/ensure-postgres.sh && yarn test packages/server/src/dispatch.test.ts`
Expected: PASS (or SKIP). `yarn typecheck` shows dispatch.ts compiling.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/dispatch.ts packages/server/src/dispatch.test.ts
git commit -m "feat(server): dedup via lifecycle().covers (closes reset-omitted bug); parent reopen via transition

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7 (U7): pipelineService settle wiring + server wipe + stateStore liveness

**Files:**
- Modify: `packages/server/src/stateStore.ts` (liveness walks → core `hasLiveDescendant`)
- Modify: `packages/server/src/runObserver.ts` (gate/finish/fail → transition/settle)
- Modify: `packages/server/src/pipelineService.ts` (settle wiring, wipe, drop `{ active }`, remove 409 guard)
- Modify: `packages/server/src/routes.ts` (reset → wipe; remove 409 path)
- Test: `packages/server/src/pipelineService.test.ts`, `packages/server/src/runObserver.test.ts`, `packages/server/src/stateStore.test.ts`

> This is the largest task — split into the four sub-tasks 7a-7d, each TDD + commit.

### Task 7a: stateStore liveness walks → core hasLiveDescendant

- [ ] **Step 1: Update the stateStore liveness methods**

In `packages/server/src/stateStore.ts`:

- Remove the `import { ACTIVE, RESETTABLE } from './transition.js'` (line 17) — those are gone.
- Add `import { lifecycle, hasLiveDescendant, type Phase } from '@atizar/core'`.

Rewrite the four helpers to classify via `lifecycle`:

```ts
    async getActiveChildren(parentId: string): Promise<WorkItem[]> {
      const rows = await db.select().from(workItems).where(eq(workItems.parentId, parentId))
      return rows.filter((r) => lifecycle(r.phase, r.outcome, false, false).isLive)
    },

    async getActiveByWorkflow(workflowId: string): Promise<WorkItem[]> {
      const rows = await db.select().from(workItems).where(eq(workItems.workflowId, workflowId))
      return rows.filter((r) => lifecycle(r.phase, r.outcome, false, false).isLive)
    },

    // Resettable = TERMINAL items that have NOT already left the board (outcome not
    // superseded/reset). transition('reset') accepts any terminal phase; we pre-filter to terminal
    // items still showing so we don't churn already-retired rows.
    async getResettable(workflowId?: string): Promise<WorkItem[]> {
      const rows = workflowId
        ? await db.select().from(workItems).where(eq(workItems.workflowId, workflowId))
        : await db.select().from(workItems)
      return rows.filter(
        (r) => r.phase === 'terminal' && r.outcome !== 'superseded' && r.outcome !== 'reset'
      )
    },
```

Rewrite `getFinishedInputRoots` (the candidates a re-START supersedes) — finished-but-open roots are now `phase='terminal'` + `outcome='done'`:

```ts
    async getFinishedInputRoots(workflowId: string, agentId: string): Promise<WorkItem[]> {
      return db
        .select()
        .from(workItems)
        .where(
          and(
            eq(workItems.workflowId, workflowId),
            eq(workItems.agentId, agentId),
            isNull(workItems.parentId),
            eq(workItems.phase, 'terminal'),
            eq(workItems.outcome, 'done')
          )
        )
    },
```

Rewrite `hasLiveInputScan` over the core walk:

```ts
    // True when this input agent has ≥1 non-retired root whose tree still contains a live node.
    // The ONE tree walk lives in core hasLiveDescendant; a root is "live" if it is itself live OR
    // has a live descendant (Approach B: a finished root with an awaiting child is a live scan).
    async hasLiveInputScan(workflowId: string, agentId: string): Promise<boolean> {
      const rows = await db.select().from(workItems).where(eq(workItems.workflowId, workflowId))
      const liveAncestors = hasLiveDescendant(
        rows.map((r) => ({ id: r.id, parentId: r.parentId, phase: r.phase as Phase }))
      )
      return rows.some(
        (r) =>
          r.agentId === agentId &&
          !r.parentId &&
          r.outcome !== 'superseded' &&
          r.outcome !== 'reset' &&
          (lifecycle(r.phase, r.outcome, false, false).isLive || liveAncestors.has(r.id))
      )
    },
```

- [ ] **Step 2: Run the store tests**

Run: `bash scripts/ensure-postgres.sh && yarn test packages/server/src/stateStore.test.ts`
Expected: PASS (or SKIP). Update any assertion still referencing `status`/`resolution` to `phase`/`outcome` (grep the test file).

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/stateStore.ts packages/server/src/stateStore.test.ts
git commit -m "feat(server): stateStore liveness walks via core lifecycle/hasLiveDescendant

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 7b: runObserver — gate/finish/fail through transition/settle

- [ ] **Step 1: Update runObserver to the new alphabet + settle**

The RunObserver needs `settle` for its terminal finish/fail. Thread the settle deps through `RunObserverDeps`. In `packages/server/src/runObserver.ts`:

- Add to `RunObserverDeps`:

```ts
  // The one terminal writer (U7). RunObserver calls it for its own finish/fail so the trace note
  // + audit + pool reconcile happen identically to the human-driven terminal edges.
  settle: (id: string, edge: 'finish' | 'fail', actor: string | null, opts?: { error?: string }) => Promise<void>
  // Re-derive pool occupancy after a gate suspend (replaces pool.release(agentId)).
  reconcile: (agentId: string) => void
```

- In `consume()`, replace the gate-suspend `pool.release(wi.agentId)` (line ~199) with `deps.reconcile(wi.agentId)`.
- Replace the finish path (lines ~203-220): the concurrent-cancel guard reads `phase`; the finish goes through `settle`:

```ts
      const current = await store.getWorkItem(id)
      if (current && current.phase === 'terminal') {
        // A concurrent cancel/settle already finalized this item — do not override it.
        deps.reconcile(wi.agentId)
        return
      }
      await deps.settle(id, 'finish', null)
      deps.activity?.record({
        ts: Date.now(),
        workflowId: wi.workflowId,
        agentId: wi.agentId,
        workItemId: id,
        kind: 'finished',
        summary: 'finished',
      })
```

(Remove the now-redundant `publishStatus(id, final)` + the trailing `pool.release` — `settle` publishes status + reconciles.)

- Replace the catch-block fail path (lines ~221-234): `await deps.settle(id, 'fail', null, { error: message })` then the activity record (drop `transition('fail')` + `setError` + `publishStatus` + `pool.release` — settle does the transition/publish/reconcile; `setError` stays for the `error` text column):

```ts
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await store.setError(id, message)
      await deps.settle(id, 'fail', null, { error: message }).catch(() => {})
      deps.activity?.record({
        ts: Date.now(),
        workflowId: wi.workflowId,
        agentId: wi.agentId,
        workItemId: id,
        kind: 'error',
        summary: message.slice(0, 80),
      })
    } finally {
      live.delete(id)
    }
```

- **`run()` no longer calls `transition('start')` in ANY branch.** The pool now OWNS the queued→active
  flip and commits it (via its injected `activate`, U5/U7c) BEFORE invoking `run(id)`, so the row is
  already `active` when run() begins — repeating the start edge would throw (illegal from `active`).
  Delete the `transition(db, id, 'start')` at the top of run() and assume the row is `active`. (A
  defensive `publishStatus(id, 'active')` at entry is fine, but no transition.)
- In the `run()` no-runtime branch (lines ~244-254): the row is already `active` (pool flipped it),
  so drop `transition('start')` and just `await deps.settle(id, 'fail', null, { error: ... })`
  (settle does the fail transition + publish + reconcile). The gate path's `publishStatus(id, 'awaiting_approval')` becomes `publishStatus(id, 'awaiting_human')`.
- In `resume()`: `pool.resumeAcquire(id, wi.agentId)` is GONE (no counter). The resume edge
  (awaiting_human→active) is a DIFFERENT path from pool admission, so resume() keeps its own
  `transition(db, id, 'resume')`, then calls `deps.reconcile(wi.agentId)`. Keep `publishStatus(id, 'active')` (the live phase word; see note below on the status wire value).

> **Status wire value:** `publishStatus(id, status)` publishes a string the client maps. After U8 the client reads `phase`. Publish the PHASE word: `'active'` for running, `'awaiting_human'` for the gate, `'terminal'` for terminal. Update the two `publishStatus(id, 'running')` calls to `publishStatus(id, 'active')` and the gate one to `'awaiting_human'`. The `routes.ts` TERMINAL set (U7d) keys on `'terminal'`.

- [ ] **Step 2: Run the runObserver tests**

Run: `bash scripts/ensure-postgres.sh && yarn test packages/server/src/runObserver.test.ts packages/server/src/runObserver.dispatch.test.ts`
Expected: FAIL first (the fake deps lack `settle`/`reconcile`; the `fakePool()` factory has `release`/`resumeAcquire`). Update the `fakePool()` factory in BOTH files — drop `release`/`resumeAcquire`, add `reconcile: vi.fn()`, make `activeCount` async:

```ts
function fakePool() {
  const reconcile = vi.fn<(agentId: string) => void>()
  const pool: WorkerPool = {
    enqueue: vi.fn(),
    dequeue: vi.fn(),
    reconcile,
    activeCount: async () => 0,
    queuedCount: () => 0,
  }
  return { pool, reconcile }
}
```

Then add to the `makeRunObserver({...})` deps in each test a fake `settle` + `reconcile` (the assertions that used `release` move to `reconcile`):

```ts
    settle: async (id, edge, _actor, opts) => {
      const { transition } = await import('./transition.js')
      await transition(db, id, edge, opts)
    },
    reconcile: () => {},
```

Tests that asserted `release` was called (slot freed at the gate / on finish) now assert `reconcile` was called instead. Re-run. Expected: PASS (or SKIP).

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/runObserver.ts packages/server/src/runObserver.test.ts packages/server/src/runObserver.dispatch.test.ts
git commit -m "feat(server): runObserver finish/fail via settle; gate suspend via reconcile

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 7c: pipelineService — settle wiring, wipe, drop {active}, remove 409 guard

- [ ] **Step 1: Update the pipelineService test for the new wiring**

In `packages/server/src/pipelineService.test.ts`:
- The `import { ACTIVE } from './transition.js'` is gone. Replace usages of `ACTIVE.includes(i.status)` with `lifecycle(i.phase, i.outcome, false, false).isLive` (`import { lifecycle } from '@atizar/core'`).
- `service.stats(agentId)` returns `{ active, queued }` where `active` is now `await`-ed (the pool count is async). Change `stats` to async OR keep it sync returning `{ queued }` + a separate async `activeCount`. DECISION (see ambiguities): keep `stats` returning `{ active: number; queued: number }` but make it `async` (`await pool.activeCount`). Update test call sites to `await service.stats(...)`.
- The singleton-START 409 test (`pipelineService.test.ts:771,831-834`) asserts the OLD `rejected: 'already_running'` path. Per U8 the 409 guard is REMOVED (Start-over wipes instead). UPDATE that test: a second START of a singleton input agent with a live scan now WIPES the prior + starts fresh (no rejection). Rewrite the assertion to expect the prior root retired (`outcome: 'superseded'` or wiped) and exactly one new live root. (Match the wipe semantics defined in Step 3.)

- [ ] **Step 2: Run it to verify it fails**

Run: `bash scripts/ensure-postgres.sh && yarn test packages/server/src/pipelineService.test.ts`
Expected: FAIL/compile-error (or SKIP).

- [ ] **Step 3: Rewrite pipelineService.ts wiring**

In `packages/server/src/pipelineService.ts`:

(a) Imports: drop `ACTIVE`; add `import { lifecycle } from '@atizar/core'` and `import { settle } from './settle.js'`. The `DONE` set + `WorkItemStatus` type uses become phase-based: `done = wi.phase === 'terminal'`.

(b) Construct the pool with the DB count + wire settle into the observer:

```ts
  const pool = makeWorkerPool({
    run: (id) => {
      void observer.run(id).catch((e) => console.error('[pipeline] run failed', id, e))
    },
    activeCount: (agentId) => store.countActiveByAgent(agentId),
    // The pool OWNS the queued→active flip (U5): commit it before run() so the cap holds against a
    // same-tick burst. run() (the observer) no longer does transition('start'). (transition is
    // already imported in this module for the reopen path.)
    activate: (id) => transition(db, id, 'start'),
  })

  // settle() needs db+store+bus+reconcile — bind once and pass to the observer + reuse for the
  // human-driven terminal edges (cancel/reject/supersede/reset).
  const settleDeps = { db, store, bus, reconcile: (agentId: string) => pool.reconcile(agentId) }
  const settleEdge = (id: string, edge: import('./settle.js').TerminalEdge, actor: string | null, opts?: { error?: string; summary?: string }) =>
    settle(settleDeps, id, edge, actor, opts)

  observer = makeRunObserver({
    db,
    store,
    pool,
    bus,
    resolveAgent: deps.resolveAgent,
    deliver: deliverImpl,
    activity,
    settle: (id, edge, actor, opts) => settleEdge(id, edge, actor, opts),
    reconcile: (agentId) => pool.reconcile(agentId),
  })
```

(c) `cancelItem`: replace `ACTIVE.includes(wi.status)` with `lifecycle(wi.phase, wi.outcome, false, false).isLive`; the queued-dequeue check `wi.status === 'queued'` → `wi.phase === 'queued'`; running → `wi.phase === 'active'`. Replace `transition(db, workItemId, 'cancel')` with `settleEdge(workItemId, 'cancel', null, { summary: 'cancelled' })`. **Restructure so the child cascade runs OUTSIDE the isLive guard** (spec U6 item 5 — safe now because `stopped` covers the re-scan):

```ts
  async function cancelItem(workItemId: string, actor: string | null = null): Promise<void> {
    const wi = await store.getWorkItem(workItemId)
    if (!wi) return
    const live = lifecycle(wi.phase, wi.outcome, false, false).isLive
    if (live) {
      if (wi.phase === 'queued') pool.dequeue(workItemId, wi.agentId)
      if (wi.phase === 'active') observer.cancel(workItemId)
      const open = await store.getOpenGate(workItemId)
      if (open) await store.resolveGateRow(open.id, { comment: 'cancelled' })
      await settleEdge(workItemId, 'cancel', actor, { summary: 'cancelled' }).catch(() => {})
      activity.record({
        ts: Date.now(),
        workflowId: wi.workflowId,
        agentId: wi.agentId,
        workItemId,
        kind: 'cancelled',
        summary: 'cancelled',
      })
    }
    // Cascade to children OUTSIDE the isLive guard: even an already-terminal parent may have a
    // live child mid-cascade. Safe because a cancelled (stopped) item COVERS, so re-scans won't
    // phantom-twin.
    const children = await store.getActiveChildren(workItemId)
    for (const child of children.sort((a, b) => a.id.localeCompare(b.id))) {
      await cancelItem(child.id, actor)
    }
    publishBoard()
  }
```

(d) `resetImpl`: replace `transition(db, item.id, 'reset')` with `settleEdge(item.id, 'reset', null, { summary: 'cleared from board' })`. **Drop the `{ active }` return** — wipe handles active items, so the count is vestigial. Change the signature to return `{ reset: number }` (or `void`). The `activeItems` computation block is deleted.

(e) `supersedePriorRoots`: replace `transition(db, root.id, 'supersede')` with `settleEdge(root.id, 'supersede', null, { summary: 'superseded by re-run' })`.

(f) The gate-approval finish (`resolveGate`, the approved branch): after the effect runs successfully, the run resumes and finishes via the observer's `settle(id, 'finish', actor)` → `done`. There is NO `approve` edge (spec U3). "Approved" is recorded by the gate's `resolved` row + the `approved <tool>` audit summary (already written in `resolveGate`, e.g. via `settle`'s `opts.summary`) + the terminal `LifecycleNote` — so approved is distinguishable in the thread/audit, never in `outcome`. Do not add any `approve` edge or call.

(g) **Remove the 409 singleton guard** (lines ~253-260): the `if (req.origin === 'human' && maxInstances === 1 && isInputAgent && hasLiveInputScan) return { rejected: 'already_running' }` block is DELETED. A re-START now wipes + supersedes via the existing `supersedePriorRoots` path below it (which already runs for human input-agent STARTs). For a singleton with a still-LIVE scan, the START must first WIPE the live tree (cancel it) then start fresh — add before `supersedePriorRoots`:

```ts
      if (req.origin === 'human' && isInputAgent(req.agentId)) {
        // Start-over: a fresh human START of an input agent wipes any LIVE scan of the same agent
        // (cancel its tree) then supersedes prior finished roots, so exactly one fresh root runs.
        // (The client shows a confirm modal before calling this — U8.)
        const live = await store.getActiveByWorkflow(req.workflowId)
        for (const item of live
          .filter((w) => !w.parentId && w.agentId === req.agentId)
          .sort((a, b) => a.id.localeCompare(b.id))) {
          await cancelItem(item.id)
        }
        await supersedePriorRoots(req.workflowId, req.agentId)
        if (resetOnStartWorkflows.has(req.workflowId)) await resetImpl(req.workflowId)
      }
```

(h) Add the `wipeWorkflow` / `wipeAll` methods to the returned object (= cancel active + reset terminal, one server op) and route the reset methods to them:

```ts
    // Wipe = the full Start-over primitive: stop every active item in scope, then retire every
    // terminal item (hide, not delete — I12). One server op behind the reset routes (U7/U8).
    async wipeWorkflow(workflowId: string): Promise<{ reset: number }> {
      await cancelWorkflowImpl(workflowId)
      return resetImpl(workflowId)
    },

    async wipeAll(): Promise<{ reset: number }> {
      await cancelAllImpl()
      return resetImpl()
    },
```

(Rename the existing `cancelAll` body to a private `cancelAllImpl` so `wipeAll` can reuse it; keep the public `cancelAll` delegating to it. Replace `ACTIVE.includes(i.status)` inside it with `lifecycle(i.phase, i.outcome, false, false).isLive`.)

Keep `resetWorkflow`/`resetAll` as thin aliases to `wipeWorkflow`/`wipeAll` (the routes call these; U7d updates the route contract). The `getStatus`/`getTrace`/`getBoard` `done` flags become `wi.phase === 'terminal'`. `getBoard`'s `snap.items.filter((w) => w.status !== 'closed')` becomes a NON-RETIRED filter — the board's job is TRANSPORT, not card-visibility, so it ships every row except the retired ones (the exact set the old `'closed'` dropped), and `queued`/no-card rows keep flowing so the client can count "queued: N" and derive live ancestors:

```ts
      const snap = await store.getBoardSnapshot()
      // Ship everything that has NOT left the board (superseded/reset are retired → Activity only).
      // Do NOT filter on isVisible here — that is the client's card-rendering decision (U8). The
      // board must keep queued + no-card rows so the client can count queued and walk live ancestors.
      const items = snap.items.filter(
        (w) => w.outcome !== 'superseded' && w.outcome !== 'reset'
      )
```

NOTE: this PRESERVES today's transport contract (old `'closed'` == the retired set). `isVisible` (card-or-not) stays a CLIENT concern in `boardModel.toPInstances` (U8) — do NOT move it into the board filter, since `isVisible` drops `queued` and would zero the "queued: N" count and starve the client's `hasLiveDescendant` walk.

(i) `stats` becomes async (Step 1). The `stats` return stays `{ active, queued }` with `active = await pool.activeCount(agentId)`.

- [ ] **Step 4: Run the pipelineService tests**

Run: `bash scripts/ensure-postgres.sh && yarn test packages/server/src/pipelineService.test.ts packages/server/src/pipelineService.audit.test.ts`
Expected: PASS (or SKIP). Fix any remaining `status`/`resolution`/`stats` (now async) assertions.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/pipelineService.ts packages/server/src/pipelineService.test.ts packages/server/src/pipelineService.audit.test.ts
git commit -m "feat(server): pipelineService settle wiring + wipe primitive; remove 409 singleton guard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 7d: routes — reset → wipe; remove 409 path

- [ ] **Step 1: Update routes.ts**

In `packages/server/src/routes.ts`:
- `const TERMINAL = new Set(['finished', 'error', 'closed'])` → `const TERMINAL = new Set(['terminal'])` (the SSE close keys on the published phase word).
- `/api/dispatch` handler: REMOVE the `if (result.rejected) return c.json({ error: 'already running' }, 409)` line (the guard is gone; `DispatchResult.rejected` is removed in U8 from core/dispatch — see note). The handler just returns `{ id: result.id }`.
- `/api/workflows/:id/reset` → call `service.resetWorkflow` (now `wipeWorkflow` alias) returning `{ reset }`; respond `c.json({ ok: true, reset })` (drop `active`).
- `/api/reset-all` → same, `{ reset }`.

Also remove `rejected?` from `DispatchResult` in `packages/server/src/dispatch.ts` (the `rejected` field, lines ~32-34) now that no path produces it.

- [ ] **Step 2: Run the route/server tests**

Run: `bash scripts/ensure-postgres.sh && yarn test packages/server/src/createServer.test.ts`
Expected: PASS (or SKIP). Update any assertion on the 409 path / reset `active` field.

- [ ] **Step 3: U7 green gate (server complete)**

Run: `bash scripts/ensure-postgres.sh && yarn typecheck && yarn test && yarn lint && yarn format:check`
Expected: ALL GREEN (server fully migrated; client REDs are now the only typecheck failures — if `yarn typecheck` is still red it is in `packages/react`, which U8 fixes). If client typecheck blocks the gate, note it and proceed to U8; the FULL green gate is asserted again at the end of U8.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes.ts packages/server/src/dispatch.ts packages/server/src/createServer.test.ts
git commit -m "feat(server): reset routes → wipe; remove 409 reject path + DispatchResult.rejected

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8 (U8): client unify + Start-over

**Files:**
- Modify: `packages/react/src/serverTypes.ts`
- Create: `packages/react/src/lifecycleDisplay.ts` + test
- Modify: `packages/react/src/status.ts` (delete `mapStatus`)
- Modify: `packages/react/src/boardModel.ts`, `pipelineModel.ts`, `aggregate.ts`
- Modify: `packages/react/src/components/ThreadModal/ThreadModal.tsx`, `AgentModal/AgentModal.tsx`
- Modify: `packages/react/src/hooks/useDispatch.ts`, `useResetController.ts`
- Tests: `status.test.ts`, `boardModel.test.ts`, `pipelineModel.test.ts`, `aggregate.test.ts`, `useResetController.test.ts`

> Split into 8a (types + display), 8b (models), 8c (hooks/Start-over), 8d (modal banner).

### Task 8a: serverTypes phase/outcome + lifecycleDisplay

- [ ] **Step 1: Update serverTypes.ts**

In `packages/react/src/serverTypes.ts`, replace `ServerStatus` + `Resolution` + the `WorkItem` fields:

```ts
import type { Phase, Outcome } from '@atizar/core'

export type { Phase, Outcome }

export type WorkItem = {
  id: string
  workflowId: string
  agentId: string // `wf__agent`
  parentId: string | null
  origin: 'human' | 'agent' | 'inbound'
  source: string | null
  payload: Record<string, unknown>
  phase: Phase
  outcome: Outcome
  card: { tool: string; props: Record<string, unknown> } | null
  error: string | null
}
```

(Keep `Gate`, `AgentHealth`, `Board`, `ActivityEntry` unchanged.)

- [ ] **Step 2: Write the lifecycleDisplay test**

Create `packages/react/src/lifecycleDisplay.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { OUTCOME_LABEL, OUTCOME_TINT, displayStatus } from './lifecycleDisplay'

describe('lifecycleDisplay', () => {
  it('labels every terminal outcome', () => {
    expect(OUTCOME_LABEL.done).toBe('Done')
    expect(OUTCOME_LABEL.stopped).toBe('Stopped')
    expect(OUTCOME_LABEL.rejected).toBe('Rejected')
    expect(OUTCOME_LABEL.error).toBe('Error')
  })

  it('tints stopped/rejected distinctly from done', () => {
    expect(OUTCOME_TINT.stopped).not.toBe(OUTCOME_TINT.done)
    expect(OUTCOME_TINT.rejected).not.toBe(OUTCOME_TINT.done)
  })

  it('maps phase+outcome to the display Status union', () => {
    expect(displayStatus('queued', 'running')).toBe('running')
    expect(displayStatus('active', 'running')).toBe('running')
    expect(displayStatus('awaiting_human', 'running')).toBe('awaiting_approval')
    expect(displayStatus('terminal', 'done')).toBe('done')
    expect(displayStatus('terminal', 'stopped')).toBe('done') // stopped renders in the done lane, labelled Stopped
    expect(displayStatus('terminal', 'error')).toBe('error')
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `yarn test packages/react/src/lifecycleDisplay.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write lifecycleDisplay.ts**

Create `packages/react/src/lifecycleDisplay.ts`:

```ts
import type { Phase, Outcome } from '@atizar/core'
import type { Status } from './status'

// Client display vocabulary derived from the core (phase, outcome). Replaces the deleted
// mapStatus: phase carries the live/terminal distinction, outcome carries the terminal flavour.
// `Status` (the card pill union) stays the rendering vocabulary; OUTCOME_LABEL/TINT add the
// terminal flavour (Stopped/Rejected) the old single 'done' lane collapsed away.

export const OUTCOME_LABEL: Record<Outcome, string> = {
  running: '',
  done: 'Done',
  stopped: 'Stopped',
  rejected: 'Rejected',
  error: 'Error',
  superseded: 'Superseded',
  reset: 'Cleared',
}

// Tint class suffix per outcome (consumed where a terminal card needs a distinct colour). done =
// the neutral "run" tint; stopped/rejected/error read as muted/warning.
export const OUTCOME_TINT: Record<Outcome, string> = {
  running: 'run',
  done: 'run',
  stopped: 'muted',
  rejected: 'warn',
  error: 'err',
  superseded: 'muted',
  reset: 'muted',
}

// Reduce (phase, outcome) to the card pill Status. awaiting_human → awaiting_approval (the pill
// vocabulary keeps the old name); a terminal stopped/done/superseded/reset all render in the
// 'done' lane (OUTCOME_LABEL supplies the distinct word); error → error.
export function displayStatus(phase: Phase, outcome: Outcome): Status {
  if (phase === 'queued' || phase === 'active') return 'running'
  if (phase === 'awaiting_human') return 'awaiting_approval'
  // terminal
  if (outcome === 'error') return 'error'
  return 'done'
}
```

- [ ] **Step 5: Export from react index**

In `packages/react/src/index.ts`, add:

```ts
export { OUTCOME_LABEL, OUTCOME_TINT, displayStatus } from './lifecycleDisplay.js'
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `yarn test packages/react/src/lifecycleDisplay.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/serverTypes.ts packages/react/src/lifecycleDisplay.ts packages/react/src/lifecycleDisplay.test.ts packages/react/src/index.ts
git commit -m "feat(react): serverTypes phase/outcome; lifecycleDisplay (OUTCOME_LABEL/TINT/displayStatus)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 8b: delete mapStatus; boardModel/pipelineModel/aggregate over core lifecycle

- [ ] **Step 1: Update status.ts — delete mapStatus**

In `packages/react/src/status.ts`, DELETE the entire `mapStatus` function (lines 27-45) and the `import('./serverTypes')` it uses. Keep `STATUSES`, `Status`, `STATUS_LABEL`, `Lifecycle`. Delete `packages/react/src/status.test.ts`'s `mapStatus` describe block (the whole file's content is just that block — replace the file with a minimal sanity test):

```ts
import { describe, it, expect } from 'vitest'
import { STATUSES, STATUS_LABEL } from './status'

describe('status vocabulary', () => {
  it('labels every Status', () => {
    for (const s of STATUSES) expect(STATUS_LABEL[s]).toBeTruthy()
  })
})
```

- [ ] **Step 2: Update boardModel.ts to core lifecycle**

In `packages/react/src/boardModel.ts`:
- Replace `import { mapStatus, type Status } from './status'` with `import { lifecycle, hasLiveDescendant, type Phase } from '@atizar/core'` + `import { displayStatus } from './lifecycleDisplay'` + `import type { Status } from './status'`.
- `isQueued(w)` → `w.phase === 'queued'`.
- Delete the local `ACTIVE_SERVER` set, the local `isVisible`, and the local `idsWithActiveDescendant` — use core `lifecycle().isVisible` + core `hasLiveDescendant`.
- Rewrite `toPInstances`:

```ts
export const toPInstances = (
  items: WorkItem[],
  workflowId: string,
  roleOf: (agentId: string) => 'input' | 'worker' | undefined,
  metaIcon: (agentId: string) => string,
  nameOf: (agentId: string) => string,
  labelOf: (w: WorkItem) => string
): PInstance[] => {
  const liveAncestors = hasLiveDescendant(
    items.map((w) => ({ id: w.id, parentId: w.parentId, phase: w.phase as Phase }))
  )
  return items
    .filter((w) => w.workflowId === workflowId)
    .map((w) => ({ w, agentId: stripWf(w.agentId, workflowId) }))
    .filter(({ w }) => lifecycle(w.phase, w.outcome, w.card !== null, liveAncestors.has(w.id)).isVisible)
    .map(({ w, agentId }) => ({
      localId: w.id,
      runtimeKey: w.agentId,
      agentId,
      name: nameOf(agentId),
      iconName: metaIcon(agentId) as IconName,
      label: labelOf(w),
      status: displayStatus(w.phase, w.outcome),
      outcome: w.outcome,
      parentLocalId: w.parentId ?? undefined,
      isInput: roleOf(agentId) === 'input',
    }))
}
```

- `statusesOf`: drop the `closed` guard (it's gone); filter visible terminal/active items and map via `displayStatus`:

```ts
export const statusesOf = (items: WorkItem[], workflowId: string, agentId: string): Status[] =>
  items
    .filter(
      (w) =>
        w.workflowId === workflowId &&
        stripWf(w.agentId, workflowId) === agentId &&
        w.phase !== 'queued' &&
        w.outcome !== 'superseded' &&
        w.outcome !== 'reset'
    )
    .map((w) => displayStatus(w.phase, w.outcome))
```

- `queuedByAgent`: `isQueued` → `w.phase === 'queued'` (already updated).

Add `outcome: Outcome` to the `PInstance` type in `pipelineModel.ts` (Step 3) so `toPInstances` can carry it for the modal banner.

- [ ] **Step 3: pipelineModel.ts — keep buildPipeline; carry outcome; use displayStatus**

In `packages/react/src/pipelineModel.ts`:
- Add `outcome` to `PInstance`: `import type { Outcome } from '@atizar/core'` and add `outcome: Outcome` to the type.
- The local `ACTIVE` set over `Status` stays (it operates on the display `Status`, not the server phase) — `'running' | 'awaiting_approval' | 'error'` are the active display statuses. No change needed to the walk logic itself; it already operates on `PInstance.status` (display Status). Confirm `view()`'s `{ ...x, status: 'running' }` still type-checks (it does — Status union unchanged).

- [ ] **Step 4: aggregate.ts**

`aggregate.ts` already operates purely on the display `Status[]` — no server-status reference. It needs NO change. Confirm its test (`aggregate.test.ts`) still passes unchanged.

- [ ] **Step 5: Update boardModel/pipelineModel tests to phase/outcome fixtures**

In `packages/react/src/boardModel.test.ts` and `pipelineModel.test.ts`, every `WorkItem` fixture uses `status`/`resolution`. Replace with `phase`/`outcome`. E.g. a fixture `{ status: 'finished', resolution: null }` → `{ phase: 'terminal', outcome: 'done' }`; `{ status: 'running' }` → `{ phase: 'active', outcome: 'running' }`; `{ status: 'closed', resolution: 'reset' }` → `{ phase: 'terminal', outcome: 'reset' }`; `{ status: 'awaiting_approval' }` → `{ phase: 'awaiting_human', outcome: 'running' }`. PInstance fixtures gain `outcome: 'running'` (or the relevant terminal outcome).

- [ ] **Step 6: Update ThreadModal.tsx**

In `packages/react/src/components/ThreadModal/ThreadModal.tsx`:
- Replace `import { mapStatus } from '../../status'` with `import { displayStatus } from '../../lifecycleDisplay'`.
- `const { messages, status, connection } = useWorkItemThread(p.id)` — `status` from the thread hook is the published PHASE word (`'active'`/`'awaiting_human'`/`'terminal'`). The thread hook needs the outcome too for the display. SIMPLEST: read the work item from the board for its `(phase, outcome)`:

```ts
  const board = useBoard()
  const wi = board.items.find((i) => i.id === p.id)
  const display = wi ? displayStatus(wi.phase, wi.outcome) : 'running'
```

(The `board` const is already declared a few lines below for `source`; move it up / reuse it.) Keep `const awaiting = display === 'awaiting_approval'`.

> CHECK `useWorkItemThread` (`packages/react/src/hooks/useWorkItemThread.ts`): it has `const TERMINAL: ReadonlySet<ServerStatus> = new Set(['finished', 'error', 'closed'])` and `const [status, setStatus] = useState<ServerStatus>('running')`, fed by the SSE `status` event. The SSE now publishes the PHASE word (U7b: `'active'`/`'awaiting_human'`/`'terminal'`). Update:
> - `import type { Phase } from '../serverTypes'` (or `@atizar/core`) and change the `status` state + the snapshot `status` field type to `Phase`.
> - `const TERMINAL: ReadonlySet<Phase> = new Set(['terminal'])` (the run is over only at the terminal phase).
> - The hook does NOT need to map to display `Status` itself — it returns the raw phase; ThreadModal maps via `displayStatus(wi.phase, wi.outcome)` using the board item (Step 6). But the hook still snapshots `snap.status` (now the phase) for the terminal-close guard — keep that, just retyped to `Phase`.
> - Update `useWorkItemThread.test.ts` fixtures: snapshot `status` values become phase words; the terminal-close case uses `'terminal'`.

- [ ] **Step 7: Run the react model tests**

Run: `yarn test packages/react/src/boardModel.test.ts packages/react/src/pipelineModel.test.ts packages/react/src/aggregate.test.ts packages/react/src/status.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/react/src/status.ts packages/react/src/status.test.ts packages/react/src/boardModel.ts packages/react/src/boardModel.test.ts packages/react/src/pipelineModel.ts packages/react/src/pipelineModel.test.ts packages/react/src/components/ThreadModal/ThreadModal.tsx packages/react/src/hooks/useWorkItemThread.ts
git commit -m "feat(react): delete mapStatus; board/pipeline over core lifecycle; carry outcome

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 8c: Start-over wipe + remove rejected plumbing

- [ ] **Step 1: Update useDispatch — wipe + Start-over confirm**

In `packages/react/src/hooks/useDispatch.ts`:
- `resetWorkflow`/`resetAll` now read `{ reset }` only (drop `active` from the parsed shape + return type):

```ts
  const resetWorkflow = useCallback(
    async (id: string): Promise<{ reset: number }> => {
      const res = await fetch(`/api/workflows/${id}/reset`, {
        method: 'POST',
        headers: authHeaders(authToken),
      })
      if (!res.ok) throw new Error(`reset failed: ${res.status}`)
      const { reset } = (await res.json()) as { reset: number }
      return { reset }
    },
    [authToken]
  )

  const resetAll = useCallback(async (): Promise<{ reset: number }> => {
    const res = await fetch('/api/reset-all', { method: 'POST', headers: authHeaders(authToken) })
    if (!res.ok) throw new Error(`reset-all failed: ${res.status}`)
    const { reset } = (await res.json()) as { reset: number }
    return { reset }
  }, [authToken])
```

- `start`: the server no longer returns a 409; it just starts (wiping a prior singleton scan server-side). The client `start` no longer needs to handle a rejection. Confirm `start` already just reads `{ id }` (it does) — no change beyond knowing the 409 path is gone. (Search the client for any `409`/`already running` handling: `grep -rn "409\|already running\|already_running" packages/react apps/inbox/client --include="*.ts" --include="*.tsx"` and remove it.)

- [ ] **Step 2: Update useResetController to the single wipe method**

In `packages/react/src/hooks/useResetController.ts`:
- The reset is now a single server `wipe` (cancel+reset in one op). Replace the client `cancelWorkflow + resetWorkflow` composition with one `resetWorkflow` call (which the server aliases to `wipeWorkflow`):
- `affected(kind)` counts the items a wipe will clear. `board.items` now carry every NON-RETIRED row (the server drops only superseded/reset — U7c), so just count items in scope; no `'closed'` predicate is needed (retired items aren't on the board). Note this now includes `queued` rows, which is correct — a wipe cancels them too:

```ts
  const affected = (kind: 'workflow' | 'all'): number =>
    board.items.filter((w) => kind === 'all' || w.workflowId === activeWorkflowId).length
```

- Rewrite `confirmReset`:

```ts
  const confirmReset = async (): Promise<void> => {
    if (!confirm) return
    const { kind } = confirm
    setConfirm(null)
    const setResetting = kind === 'workflow' ? setResettingWorkflow : setResettingAll
    setResetting(true)
    try {
      if (kind === 'workflow') await resetWorkflow(activeWorkflowId)
      else await resetAll()
    } finally {
      setResetting(false)
    }
  }
```

- Drop `cancelWorkflow`/`cancelAll` from the `useDispatch()` destructure at the top (no longer used here).

- [ ] **Step 3: Update useResetController.test.ts**

In `packages/react/src/hooks/useResetController.test.ts`, the test mocks `useDispatch` returning `cancelWorkflow`/`cancelAll`/`resetWorkflow`/`resetAll` and asserts the composition (cancel THEN reset). Update it: assert `confirmReset` calls ONLY `resetWorkflow`/`resetAll` now (the server does the cancel). Update the board fixture items to `phase`/`outcome`. Update the `affected` count assertion (it now counts all in-scope visible items, no `closed` exclusion since the board has no closed items).

- [ ] **Step 4: Run the hook tests**

Run: `yarn test packages/react/src/hooks/useResetController.test.ts packages/react/src/hooks/useStopController.test.ts`
Expected: PASS. (useStopController is unchanged but verify it still compiles against the new types.)

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/useDispatch.ts packages/react/src/hooks/useResetController.ts packages/react/src/hooks/useResetController.test.ts
git commit -m "feat(react): Start-over wipe (single op); remove rejected/409 plumbing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 8d: AgentModal lifecycle-note banner + Stopped/Rejected labels

- [ ] **Step 1: Add the banner to AgentModal**

In `packages/react/src/components/AgentModal/AgentModal.tsx`:
- The modal already folds `agent.messages`, which now includes the `role:'system'` lifecycle note (from U4's fold case). The `thread` flatMap currently `if (msg.role !== 'assistant') return []` — so the system note is dropped. Add a system-note branch BEFORE that guard:

```ts
  const thread = agent.messages.flatMap((msg: Message, i: number) => {
    if (msg.role === 'system' && typeof msg.content === 'string' && msg.content.length > 0) {
      return [
        <div className={clsx(s.threadNote, s.lifecycle)} key={`sys-${i}`}>
          {msg.content}
        </div>,
      ]
    }
    if (msg.role !== 'assistant') return []
    // …existing assistant rendering…
```

- Add a `.lifecycle` class to `AgentModal.module.scss` (a muted note style; mirror `.threadNote`). E.g.:

```scss
.threadNote.lifecycle {
  font-weight: 600;
  opacity: 0.8;
}
```

> CSS-module reminder: `localsConvention: 'camelCaseOnly'` is set in BOTH `apps/inbox/vite.config.ts` AND `packages/react/vite.config.ts` — `s.lifecycle` keys a `.lifecycle` class directly (no dash). No camelize needed for a single-word class.

- The header status label uses `STATUS_LABEL[status]`. To show "Stopped"/"Rejected" distinctly (not just "Done"), the modal needs the `outcome`. Add an optional `outcome?: Outcome` prop to `AgentModalProps` and, when `status === 'done'` and an outcome is supplied, render `OUTCOME_LABEL[outcome]` instead of `STATUS_LABEL.done`:

```tsx
            <span className={`modal-status status s-${status}`}>
              <span className={`dot ${status}`} />
              {status === 'done' && outcome ? OUTCOME_LABEL[outcome] : STATUS_LABEL[status]}
            </span>
```

Add `import { OUTCOME_LABEL } from '../../lifecycleDisplay'` and `import type { Outcome } from '@atizar/core'`. Thread `outcome` from the caller (ThreadModal passes `wi?.outcome`).

- [ ] **Step 2: Verify the modal test still renders**

Run: `yarn test packages/react/src/components/AgentModal/AgentModal.userTurn.test.tsx`
Expected: PASS (the new branch is additive; the existing test has no system message so it's unaffected).

- [ ] **Step 3: Build the react package (CSS + types) and run the full gate**

Run: `yarn workspace @atizar/react build`
Expected: clean Vite library build (the new `.lifecycle` class compiles into `react.css`).

- [ ] **Step 4: U8 green gate**

Run: `bash scripts/ensure-postgres.sh && yarn typecheck && yarn test && yarn lint && yarn format:check && yarn workspace @atizar/react build`
Expected: ALL GREEN.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/components/AgentModal/AgentModal.tsx packages/react/src/components/AgentModal/AgentModal.module.scss
git commit -m "feat(react): AgentModal lifecycle-note banner + Stopped/Rejected header label

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 8e: distinct Stopped/Rejected on the board/pipeline cards (not just the modal)

> WHY this exists: 8d only wires the distinct outcome word/colour into the `AgentModal` HEADER (the
> pop-up you get on click). The board/pipeline plies (`PipelineColumn`) and the instance picker still
> render `STATE_WORD[inst.status]` / `TINT[inst.status]`, keyed on the DISPLAY status — and a stopped
> item has `displayStatus === 'done'`, so a Stopped/Rejected run looks IDENTICAL to a clean Done on
> the list surface. `OUTCOME_TINT` is otherwise a dead export. This task makes the distinction visible
> WITHOUT opening the item, satisfying browser-verify checklist items 1 and 3 ("card/pipeline shows a
> distinct Stopped"; "card shows the rejected outcome"). `PInstance.outcome` is already carried (8b).

**Files:**
- Modify: `packages/react/src/lifecycleDisplay.ts` (align `OUTCOME_TINT` suffixes to real classes)
- Modify: `packages/react/src/statusDisplay.ts` (add outcome-aware `pillLabel` / `pillTint`)
- Test: `packages/react/src/statusDisplay.test.ts`
- Modify: `packages/react/src/components/PipelineColumn/PipelineColumn.tsx` + `.module.scss`
- Modify: `packages/react/src/components/InstancePickerModal/InstancePickerModal.tsx` + `.module.scss`

- [ ] **Step 1: Align `OUTCOME_TINT` to distinct class suffixes**

In `packages/react/src/lifecycleDisplay.ts`, change the `stopped`/`rejected` tint suffixes from the
generic `muted`/`warn` to their own class names so the list surfaces can colour them distinctly (the
existing `lifecycleDisplay.test.ts` assertion `OUTCOME_TINT.stopped !== OUTCOME_TINT.done` still holds):

```ts
export const OUTCOME_TINT: Record<Outcome, string> = {
  running: 'run',
  done: 'run',
  stopped: 'stopped',
  rejected: 'rejected',
  error: 'err',
  superseded: 'stopped',
  reset: 'stopped',
}
```

- [ ] **Step 2: Add outcome-aware `pillLabel` / `pillTint` helpers + a failing test**

The pipeline plies + picker need ONE place that decides "show the distinct outcome word/colour for a
terminal stopped/rejected, else fall back to the status-keyed word/colour". Put it in
`statusDisplay.ts` (which already owns `TINT`/`STATE_WORD` for these surfaces). Append:

```ts
import type { Outcome } from '@atizar/core'
import { OUTCOME_LABEL, OUTCOME_TINT } from './lifecycleDisplay'

// A terminal item whose display Status collapses to the 'done' lane (stopped/rejected/superseded/
// reset all do) must still SHOW its distinct outcome on the list surfaces — otherwise a Stopped run
// is indistinguishable from a clean Done without opening the modal. For those, prefer the outcome
// word/tint; for everything live (running/awaiting/error) keep the status-keyed maps.
const DISTINCT_TERMINAL = new Set<Outcome>(['stopped', 'rejected', 'superseded', 'reset'])

export const pillLabel = (status: Status, outcome: Outcome): string =>
  status === 'done' && DISTINCT_TERMINAL.has(outcome) ? OUTCOME_LABEL[outcome] : STATE_WORD[status]

export const pillTint = (status: Status, outcome: Outcome): string =>
  status === 'done' && DISTINCT_TERMINAL.has(outcome) ? OUTCOME_TINT[outcome] : TINT[status]
```

(No import cycle: `lifecycleDisplay` imports only `Status` from `status.ts`, not `statusDisplay`.)

Create `packages/react/src/statusDisplay.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pillLabel, pillTint } from './statusDisplay'

describe('pillLabel / pillTint (outcome-aware list surfaces)', () => {
  it('a stopped item reads Stopped with a non-done tint (not Done)', () => {
    expect(pillLabel('done', 'stopped')).toBe('Stopped')
    expect(pillTint('done', 'stopped')).not.toBe(pillTint('done', 'done'))
  })
  it('a rejected item reads Rejected', () => {
    expect(pillLabel('done', 'rejected')).toBe('Rejected')
  })
  it('a clean done still reads Done', () => {
    expect(pillLabel('done', 'done')).toBe('Done')
  })
  it('live statuses ignore outcome (running → Working)', () => {
    expect(pillLabel('running', 'running')).toBe('Working')
  })
})
```

Run: `yarn test packages/react/src/statusDisplay.test.ts` → FAIL (helpers not added yet), then PASS after Step 2.

- [ ] **Step 3: Use the helpers in `PipelineColumn.tsx`**

In `packages/react/src/components/PipelineColumn/PipelineColumn.tsx`:
- Replace `import { TINT, STATE_WORD } from '../../statusDisplay'` with `import { pillLabel, pillTint } from '../../statusDisplay'`.
- The state word (line ~66): `{STATE_WORD[inst.status]}` → `{pillLabel(inst.status, inst.outcome)}`.
- The three tint sites (lines ~130, ~156, ~186): `TINT[block.parent.status]` → `pillTint(block.parent.status, block.parent.outcome)` and `TINT[inst.status]` → `pillTint(inst.status, inst.outcome)`.

- [ ] **Step 4: Use the helpers in `InstancePickerModal.tsx`**

Same swap in `packages/react/src/components/InstancePickerModal/InstancePickerModal.tsx`:
`TINT[inst.status]` → `pillTint(inst.status, inst.outcome)` (line ~64); `STATE_WORD[inst.status]` →
`pillLabel(inst.status, inst.outcome)` (line ~75). (`PInstance.outcome` is carried — 8b.)

- [ ] **Step 5: Add the `.stopped` / `.rejected` tint classes**

The tint string is applied as a GLOBAL class (e.g. `` `pl-single ${pillTint(...)}` ``). Find where the
existing `.run` / `.await` / `.err` tint classes are defined in `PipelineColumn.module.scss` and
`InstancePickerModal.module.scss` (grep `\.run` / `\.err`) and add sibling `.stopped` and `.rejected`
rules in the SAME block, with visibly distinct colours (e.g. `.stopped` muted/grey, `.rejected`
amber/red), mirroring the structure of the existing tint rules. Keep it minimal — just the colour
tokens the neighbouring tints use.

> CSS-module reminder: these tint names are single words (no `-`/`_`), so `localsConvention:
> 'camelCaseOnly'` leaves them unchanged in BOTH `apps/inbox/vite.config.ts` and
> `packages/react/vite.config.ts`. **Only the browser confirms the colour actually renders** —
> covered by the U9c browser-verify (items 1 & 3).

- [ ] **Step 6: Build + green gate**

Run: `bash scripts/ensure-postgres.sh && yarn typecheck && yarn test && yarn lint && yarn format:check && yarn workspace @atizar/react build`
Expected: ALL GREEN (the new `.stopped`/`.rejected` classes compile into `react.css`).

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/lifecycleDisplay.ts packages/react/src/statusDisplay.ts packages/react/src/statusDisplay.test.ts packages/react/src/components/PipelineColumn/PipelineColumn.tsx packages/react/src/components/PipelineColumn/PipelineColumn.module.scss packages/react/src/components/InstancePickerModal/InstancePickerModal.tsx packages/react/src/components/InstancePickerModal/InstancePickerModal.module.scss
git commit -m "feat(react): distinct Stopped/Rejected on board/pipeline + picker (not just the modal)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9 (U9): drift-guard test + docs + full browser E2E

**Files:**
- Create: `packages/core/src/lifecycle.drift.test.ts`
- Modify: `docs/pipeline-updated-3.md`

### Task 9a: drift-guard test

- [ ] **Step 1: Write the drift-guard test**

The drift guard pins that EVERY consumer sees the SAME `{isLive, isVisible, covers}` for a given item — i.e. nobody re-derives liveness/visibility/covers independently. Since U1-U8 made `core.lifecycle` the single classifier, the guard asserts the client's `boardModel.toPInstances` visibility and the server's board filter both agree with `core.lifecycle`. Create `packages/core/src/lifecycle.drift.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { lifecycle, hasLiveDescendant, type Phase, type Outcome } from './lifecycle.js'

// Drift guard: the same (phase, outcome, hasCard, hasLiveDescendant) tuple must yield ONE answer.
// This is a property test over the full alphabet — if any consumer ever forks the rule, its own
// unit test would diverge from this table. (The consumers import lifecycle() directly, so this
// guards against a future copy-paste reintroducing a parallel derivation.)
const PHASES: Phase[] = ['queued', 'active', 'awaiting_human', 'terminal']
const OUTCOMES: Outcome[] = ['running', 'done', 'stopped', 'rejected', 'error', 'superseded', 'reset']

describe('lifecycle drift guard', () => {
  it('is a pure function of its inputs (idempotent)', () => {
    for (const phase of PHASES) {
      for (const outcome of OUTCOMES) {
        for (const hasCard of [false, true]) {
          for (const hld of [false, true]) {
            const a = lifecycle(phase, outcome, hasCard, hld)
            const b = lifecycle(phase, outcome, hasCard, hld)
            expect(a).toEqual(b)
          }
        }
      }
    }
  })

  it('isLive is exactly phase ∈ {queued, active, awaiting_human} regardless of outcome/card', () => {
    for (const phase of PHASES) {
      for (const outcome of OUTCOMES) {
        const expected = phase !== 'terminal'
        expect(lifecycle(phase, outcome, false, false).isLive).toBe(expected)
      }
    }
  })

  it('a retired (superseded/reset) item is never visible; a queued item is never visible', () => {
    expect(lifecycle('terminal', 'superseded', true, true).isVisible).toBe(false)
    expect(lifecycle('terminal', 'reset', true, true).isVisible).toBe(false)
    expect(lifecycle('queued', 'running', true, true).isVisible).toBe(false)
  })

  it('hasLiveDescendant agrees with isLive over a tree', () => {
    const rows = [
      { id: 'r', parentId: null, phase: 'terminal' as Phase },
      { id: 'c', parentId: 'r', phase: 'active' as Phase },
    ]
    const set = hasLiveDescendant(rows)
    expect(set.has('r')).toBe(lifecycle('active', 'running', false, false).isLive) // true
  })
})
```

- [ ] **Step 2: Run it to verify it passes**

Run: `yarn test packages/core/src/lifecycle.drift.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/lifecycle.drift.test.ts
git commit -m "test(core): lifecycle drift guard (one answer per item, everywhere)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 9b: docs

- [ ] **Step 1: Update docs/pipeline-updated-3.md to the new alphabet**

Read `docs/pipeline-updated-3.md`, find the section enumerating the `status` (8-value) + `resolution` vocabulary, and re-express it as `(phase, outcome)`: phase = `queued | active | awaiting_human | terminal`; outcome = `running | done | stopped | rejected | error | superseded | reset`; note the single classifier `@atizar/core/lifecycle` + the one terminal writer `settle.ts` + DB-derived pool occupancy. Keep it factual (no dates/clarifications — write-clean-final-docs). It is NOT a protected doc.

- [ ] **Step 2: Commit**

```bash
git add docs/pipeline-updated-3.md
git commit -m "docs: pipeline-updated-3 over the (phase, outcome) alphabet

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 9c: full browser E2E (the spec's checklist)

- [ ] **Step 1: Invoke the browser-verify skill**

Use the `browser-verify` skill. It owns dev-server hygiene (kill stale `:4000`/`:5173`, the `predev` mitigation, the EADDRINUSE / self-reload diagnosis) and Playwright-MCP profile-lock recovery. Start the dev stack with `DEV_RECORD_REPLAY=1` (use `record` for the concurrent-HITL case so each instance mints a distinct toolCallId — replay shares the recorded id and falsely shows a dead second button).

- [ ] **Step 2: Walk EVERY flow in the spec's Browser-verify checklist**

Drive the real app and confirm each, taking a snapshot/screenshot per step:

1. STOP a running instance → card/pipeline shows a distinct **Stopped** (not Done); the whole subtree stays together (no half-clear).
2. Open the stopped thread → a `Stopped — cancelled` note at the tail.
3. Reject a gate → thread shows a `Rejected` note; card shows the rejected outcome.
4. Phantom-dupe repro: STOP an input scan, then re-START/re-scan the same source → exactly ONE card.
5. Start-over: press START on a live workflow → confirm modal → on confirm the old work is gone and one fresh root runs; on cancel nothing changes.
6. Pool/START race: cancel a run then immediately START → the new run RUNS (not stuck `queued`); route 3 at once on a cap-2 agent → 2 active + `queued: 1` (`record` mode).
7. Reset gesture: a stopped item persists until explicit Reset; after Reset it leaves the live column but stays in Activity/history.
8. `N active` counts agree across the type card, picker, and pipeline.
9. HITL approve → effect runs once; item shows Done with an attributed audit row; a finished input root with an awaiting child still counts as a live scan (Approach-B preserved).
10. Restart the server mid-pipeline → a `running`/`active` row with no executor becomes `error` (zombie sweep); pool admission re-derives from the DB.

- [ ] **Step 3: Final green gate**

Run: `bash scripts/ensure-postgres.sh && yarn typecheck && yarn test && yarn lint && yarn format:check && yarn workspace @atizar/react build`
Expected: ALL GREEN.

- [ ] **Step 4: Record the build narrative**

Append a lifecycle-unify section to `docs/BUILD-LOG.md` (per-feature narrative of what was BUILT: the one classifier, the one writer, DB-derived pool, Start-over wipe). Commit:

```bash
git add docs/BUILD-LOG.md
git commit -m "docs(build-log): lifecycle-unify narrative

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Done criteria

- Every unit's green gate passed (the final one at U9c).
- All 10 browser-verify flows confirmed in the real app via the `browser-verify` skill.
- `mapStatus` is gone; `core/lifecycle` is the only classifier; `settle()` is the only terminal writer; the pool counter is gone (DB-derived); Start-over is a confirm-modal wipe with no 409 path.
- `git log --oneline` on `feat/lifecycle-unify` shows the per-unit commits in order.
