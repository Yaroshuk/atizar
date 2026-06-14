# WS1 — Re-run Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** A human START of an input agent retires the prior *finished* scan root of the same `workflow × input-agent` into a preserved `closed`/`superseded` history bucket (never destroyed) and the new scan becomes the single current one; item-level dedup is scoped to OPEN items so a re-scan re-surfaces un-actioned items while the effect ledger guards against double irreversible actions; the live pipeline shows exactly one input-agent row, labeled correctly (Working while running, Done when finished).

**Architecture:** The supersede goes through the `transition()` edge map (invariant I8 — every `work_items.status` write goes through `transition()`), reusing the existing `closed` status with a new `superseded` resolution marker. `pipelineService.dispatch()` invokes the supersede on a human START of an input agent *before* minting the new root; `dispatch.ts` narrows its dedup SELECT to non-closed/unsuperseded items; the React `boardModel.isVisible` hides `closed`/superseded roots and `pipelineModel.view()` stops mislabeling a finished root as "Working". A `rerun?: 'refresh' | 'history'` knob is declared on `WorkflowDescriptor` (default `'refresh'`), with only `'refresh'` wired and a commented branch point for `'history'`.

**Tech Stack:** TypeScript, Drizzle ORM + Postgres (server), Vitest (unit/integration tests, real Postgres via global setup), React + @testing-library (client model unit tests), Vite library build for `@atizar/react`.

---

## Foundation guard-rails (BINDING — restate before every status-touching step)

This WS touches the foundation. The §0 guard-rails from the spec are binding; do not drift past them:

- **I8** — every `work_items.status` write goes through `transition()`. The supersede is a NEW edge in the edge map (`transition.ts`), **never** a side-write in `dispatch.ts`, `pipelineService.ts`, or a route. Gate against this: if you find yourself writing `db.update(workItems).set({ status: ... })` outside `transition.ts`, STOP.
- **I12** — "supersede" means the new scan becomes the *current* one and the prior finished scan is **moved to a preserved `closed`/`superseded` bucket** (still human-openable via Activity/trace, still human-closable), **NOT destroyed**. Do **NOT** cancel the prior scan's children — per-item work items are the durable unit and stay live/durable. Nothing a human started is silently deleted. Gate against this: the supersede must touch only the prior ROOT row; no cascade to children.
- **I1** — a human START must **always** do something visible. Do **NOT** implement "no-op when nothing changed." Item-level dedup at the child level is fine; refusing the human's explicit START gesture is not. Gate against this: the human START always mints a new root and always supersedes the prior one (when one exists) — it never short-circuits to "nothing to do."
- **I9** — the irreversible action stays server-executed + gated, keyed `workItemId+gateId` (the `action_ledger` table). The dedup-scope change leans on this ledger as the real double-action guard. Gate against this: do NOT weaken or bypass `store.claimLedger` in `resolveGate`.

Run the `check-foundation` skill once the supersede edge + dedup change are drafted (it touches actions, `@atizar/core`, and the framework boundary). If any implementation detail tempts past a guard-rail, STOP and re-read §0 of the spec.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/server/src/db/schema.ts` | Modify | Add `'superseded'` to the `resolution_kind` pg enum (line 32). |
| `packages/server/src/db/migrations/0002_<name>.sql` | Create (generated) | `ALTER TYPE "public"."resolution_kind" ADD VALUE 'superseded';` + journal/snapshot. |
| `packages/server/src/transition.ts` | Modify | Add the `supersede` edge (`finished | result → closed`) to `EDGES` (21-29) and `superseded` to `EDGE_RESOLUTION` (32-35); widen its type. |
| `packages/server/src/transition.test.ts` | Modify | Test the `finished → closed` supersede edge sets `resolution='superseded'`; illegal from `running`. |
| `packages/server/src/dispatch.ts` | Modify | Narrow the dedup SELECT (62-75) to OPEN/unclosed items only (exclude `closed` status and `superseded`/`cancelled` resolution). |
| `packages/server/src/dispatch.test.ts` | Modify | Test: a closed/superseded same-source item does NOT dedup (re-surfaces); a live/finished one still does. |
| `packages/server/src/stateStore.ts` | Modify | Add `getFinishedInputRoots(workflowId, agentId)` reader (finished, parentless, not yet closed). |
| `packages/server/src/pipelineService.ts` | Modify | In `dispatch()` (163-183): on a human START of an input agent, supersede the prior finished root(s) before minting the new one; record a `superseded` activity entry. |
| `packages/server/src/pipelineService.test.ts` | Modify | Test: a 2nd human START of an input agent supersedes the prior finished root (status `closed`, resolution `superseded`) and mints a new running one; children untouched; concurrent 2nd START still 409. |
| `packages/core/src/defineWorkflow.ts` | Modify | Add `rerun?: 'refresh' | 'history'` to `WorkflowDescriptor` (29-43); document the `'history'` branch point. |
| `packages/core/src/defineWorkflow.test.ts` | Modify | Test: `rerun` round-trips; defaults to `undefined` (treated as `'refresh'`). |
| `packages/react/src/serverTypes.ts` | Modify | Add `'superseded'` to the `Resolution` union (line 15). |
| `packages/react/src/boardModel.ts` | Modify | `isVisible` (17-21): hide a `closed`/superseded input root from the live column. |
| `packages/react/src/boardModel.test.ts` | Modify | Test: a `closed`+`superseded` input root is filtered out; a `finished` input root stays. |
| `packages/react/src/pipelineModel.ts` | Modify | `view()` (61-63): relabel a parent to `running` only when it has a LIVE child. |
| `packages/react/src/pipelineModel.test.ts` | Modify | Test: a finished input root with no live child keeps `done` (not relabeled to running); with a live child it still shows working. |
| `packages/react/src/aggregate.ts` | Verify only | Confirm Done still reads right (no code change expected). |

---

### Task 1: Declare the `rerun` knob on `WorkflowDescriptor` (core, config-as-data / I7)

**Files:**
- `packages/core/src/defineWorkflow.ts` (type `WorkflowDescriptor`, lines 29-43)
- `packages/core/src/defineWorkflow.test.ts` (add cases after line 111)

- [ ] **Step 1: Write a failing test for the `rerun` round-trip.** Add these two cases inside the `describe('defineWorkflow', …)` block in `packages/core/src/defineWorkflow.test.ts`, immediately before the closing `})` on line 112:
```ts
  it('round-trips the rerun knob', () => {
    expect(defineWorkflow({ ...base, rerun: 'refresh' }).rerun).toBe('refresh')
    expect(defineWorkflow({ ...base, rerun: 'history' }).rerun).toBe('history')
  })
  it('leaves rerun undefined when not declared (defaults to refresh at the call site)', () => {
    expect(defineWorkflow(base).rerun).toBeUndefined()
  })
```

- [ ] **Step 2: Run the test, expect FAIL (type error / compile).** From the repo root:
```
yarn test packages/core/src/defineWorkflow.test.ts
```
Expected: a TypeScript/Vitest failure — `rerun` is not a known property of the descriptor literal (`Object literal may only specify known properties`).

- [ ] **Step 3: Add the `rerun` field to `WorkflowDescriptor`.** In `packages/core/src/defineWorkflow.ts`, inside the `WorkflowDescriptor` type, add the field after `connections?` (currently the last field, line 42). Insert before the closing `}` on line 43:
```ts
  // Re-run policy when a human STARTs an input agent that already has a finished scan root
  // (config-as-data, I7). Default 'refresh': the prior finished root is superseded
  // (status 'closed', resolution 'superseded') and the new scan becomes current; per-item
  // work items the scan surfaced stay durable. 'history' (reserved, NOT wired in the beta):
  // no auto-supersede — every finished scan is kept and the human chooses which is current.
  // The 'history' branch point lives in pipelineService.dispatch(); see its comment there.
  rerun?: 'refresh' | 'history'
```

- [ ] **Step 4: Run the test, expect PASS.**
```
yarn test packages/core/src/defineWorkflow.test.ts
```
Expected: all `defineWorkflow` cases green, including the two new `rerun` cases.

- [ ] **Step 5: Commit.**
```
git add packages/core/src/defineWorkflow.ts packages/core/src/defineWorkflow.test.ts
git commit -m "feat(core): declare rerun knob on WorkflowDescriptor (refresh|history)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add the `superseded` resolution to the schema + generate the migration

The `closed` status already exists in the `work_item_status` enum (`db/schema.ts:28`). We add a `superseded` *resolution* marker (orthogonal to status, honest audit trail — the same pattern as `cancelled`/`rejected`).

**Files:**
- `packages/server/src/db/schema.ts` (`resolutionKind` enum, line 32)
- `packages/server/src/db/migrations/0002_*.sql` (generated by drizzle-kit)
- `packages/react/src/serverTypes.ts` (client `Resolution` union, line 15)

- [ ] **Step 1: Add `'superseded'` to the `resolutionKind` pg enum.** In `packages/server/src/db/schema.ts`, change line 32:
```ts
export const resolutionKind = pgEnum('resolution_kind', ['cancelled', 'rejected', 'superseded'])
```
(Keep the surrounding comment on line 31 — it already says "A terminal *outcome* marker, orthogonal to status".)

- [ ] **Step 2: Add `'superseded'` to the client `Resolution` union.** In `packages/react/src/serverTypes.ts`, change line 15:
```ts
export type Resolution = 'cancelled' | 'rejected' | 'superseded' | null
```

- [ ] **Step 3: Generate the migration with drizzle-kit.** Run from the `apps/inbox` workspace (this is where `drizzle.config.ts` and the `db:generate` script live, pointing `out` at `packages/server/src/db/migrations`):
```
yarn workspace inbox db:generate
```
Expected: drizzle-kit writes a new `packages/server/src/db/migrations/0002_<random_name>.sql` containing `ALTER TYPE "public"."resolution_kind" ADD VALUE 'superseded';`, plus a `0002_snapshot.json` and an updated `_journal.json`.

- [ ] **Step 4: Verify the generated migration is the expected single ALTER TYPE.** Read the new file:
```
ls packages/server/src/db/migrations/0002_*.sql
```
Then open it and confirm it contains exactly the enum extension (no unintended table changes). Expected content:
```sql
ALTER TYPE "public"."resolution_kind" ADD VALUE 'superseded';
```
If drizzle generated extra unrelated statements (e.g. it picked up a drifted local DB), discard those edits and hand-author the migration file + journal entry to contain only the `ALTER TYPE` statement, matching the style of `0001_fantastic_red_ghost.sql` (a single statement, no `--> statement-breakpoint` needed for one statement). Note: Postgres requires `ALTER TYPE … ADD VALUE` to run **outside** a transaction in older versions — drizzle's migrator handles this; if `yarn workspace inbox db:migrate` errors with "ALTER TYPE ... ADD VALUE cannot run inside a transaction block", the generated SQL already accounts for it (drizzle 0.31 emits it standalone). Do not wrap it.

- [ ] **Step 5: Apply the migration to the dev DB and confirm the test DB will pick it up.** The integration tests apply all migrations via `test-global-setup.ts` (real Postgres). Apply to the dev DB now so the browser-verify later works:
```
yarn workspace inbox db:migrate
```
Expected: `[db] migrations applied` (or silent success). If Postgres is not running locally, the integration tests `describe.skipIf(!reachable)` will skip — that is acceptable for the green gate but you MUST start Postgres before the browser-verify step.

- [ ] **Step 6: Typecheck — confirm the enum widening compiles across server + client.**
```
yarn typecheck
```
Expected: PASS. `WorkItemStatus` is unchanged; `ResolutionKind` now includes `'superseded'`; the client `Resolution` union matches.

- [ ] **Step 7: Commit.**
```
git add packages/server/src/db/schema.ts packages/react/src/serverTypes.ts packages/server/src/db/migrations
git commit -m "feat(db): add 'superseded' resolution marker + migration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Add the `supersede` edge to `transition()` (I8 — the ONLY status writer)

The supersede must route through `transition()`. Add an edge that lands a finished/result root in `closed` and stamps `resolution='superseded'`. **Do NOT** add a child auto-finish for this edge — `closed` is not in `TERMINAL_STATUSES` for the parent-walk, and we do not want to disturb children (I12).

**Files:**
- `packages/server/src/transition.ts` (`Edge` type line 12, `EDGES` 21-29, `EDGE_RESOLUTION` 32-35)
- `packages/server/src/transition.test.ts` (add cases after line 91)

- [ ] **Step 1: Write failing tests for the supersede edge.** Add these cases inside the `describe('transition() edge guards (real Postgres)', …)` block in `packages/server/src/transition.test.ts`, before the closing `})` on line 92:
```ts
  it('supersede from finished → closed with resolution superseded', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await transition(db, id, 'finish')
    await transition(db, id, 'supersede')
    const row = await store.getWorkItem(id)
    expect(row?.status).toBe('closed')
    expect(row?.resolution).toBe('superseded')
  })

  it('supersede is illegal from running (only a finished/result root can be superseded)', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await expect(transition(db, id, 'supersede')).rejects.toThrow(/cannot "supersede"/)
  })

  it('supersede does NOT cascade to the parent (children stay durable, I12)', async () => {
    const { id: parent } = await newQueued()
    await transition(db, parent, 'start')
    await transition(db, parent, 'finish')
    // a child still active under the parent
    const { id: child } = await newQueued({ parentId: parent })
    await transition(db, child, 'start')
    await transition(db, parent, 'supersede')
    // the child is untouched by the parent's supersede
    expect((await store.getWorkItem(child))?.status).toBe('running')
    expect((await store.getWorkItem(parent))?.status).toBe('closed')
  })
```

- [ ] **Step 2: Run the tests, expect FAIL.**
```
yarn test packages/server/src/transition.test.ts
```
Expected: FAIL — TypeScript rejects `'supersede'` as an `Edge` (the literal is not assignable), and at runtime `EDGES['supersede']` would be `undefined`. (If Postgres is unreachable the suite skips; in that case rely on the typecheck failure in step 4 to confirm the red — but you should start Postgres for this WS.)

- [ ] **Step 3: Add `supersede` to the `Edge` type.** In `packages/server/src/transition.ts`, change line 12:
```ts
export type Edge = 'start' | 'gate' | 'resume' | 'finish' | 'fail' | 'cancel' | 'reject' | 'supersede'
```

- [ ] **Step 4: Add the `supersede` edge to `EDGES`.** In `packages/server/src/transition.ts`, add a line inside the `EDGES` map (after the `reject` line, currently line 28):
```ts
  // Re-run/refresh (WS1): retire a prior FINISHED scan root into the preserved Done bucket.
  // 'closed' is NOT in TERMINAL_STATUSES, so this edge never triggers the parent auto-finish
  // walk — and there is no children cascade here (per-item work items stay durable, I12).
  supersede: { from: ['finished', 'result'], to: 'closed' },
```

- [ ] **Step 5: Add the `superseded` resolution stamp.** In `packages/server/src/transition.ts`, change the `EDGE_RESOLUTION` map (32-35). Widen its value type and add the `supersede` entry:
```ts
// Terminal-outcome marker set by explicit human commands (orthogonal to status).
const EDGE_RESOLUTION: Partial<Record<Edge, 'cancelled' | 'rejected' | 'superseded'>> = {
  cancel: 'cancelled',
  reject: 'rejected',
  supersede: 'superseded',
}
```

- [ ] **Step 6: Run the tests, expect PASS.**
```
yarn test packages/server/src/transition.test.ts
```
Expected: all `transition()` cases green, including the three new supersede cases. The existing edge already writes `resolution` from `EDGE_RESOLUTION[edge]` (line 100) and only walks the parent when `spec.to` is in `TERMINAL_STATUSES` (line 107) — `closed` is not, so the no-cascade case passes with no extra code.

- [ ] **Step 7: Commit.**
```
git add packages/server/src/transition.ts packages/server/src/transition.test.ts
git commit -m "feat(transition): add supersede edge (finished|result → closed, resolution superseded)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Narrow the `dispatch.ts` dedup SELECT to OPEN/unclosed items

Today the dedup matches any same-source item that is not `error` and not `rejected` — so a *closed/superseded* item (a stale scan's processed leaf) shadows a re-scan and the un-actioned item is never re-surfaced. Narrow the SELECT to exclude `closed` status and the `superseded`/`cancelled` resolutions, keeping the existing `error`/`rejected` exclusion. The `workItemId+gateId` effect ledger (I9) remains the real double-action guard.

**Files:**
- `packages/server/src/dispatch.ts` (dedup SELECT, lines 62-75; imports line 2)
- `packages/server/src/dispatch.test.ts` (add cases after line 95)

- [ ] **Step 1: Write a failing test — a closed/superseded same-source item does NOT dedup.** Add these cases inside the `describe('dispatch() chokepoint (real Postgres)', …)` block in `packages/server/src/dispatch.test.ts`, before the closing `})` on line 96. (`transition` is already imported at the top of the file.)
```ts
  it('re-surfaces a source whose prior item is closed/superseded (open-scoped dedup)', async () => {
    const { pool } = fakePool()
    const source = `thread:${randomUUID()}`
    const first = await dispatch(db, pool, { ...base, source })
    // drive the first item to closed+superseded (a stale scan's leaf)
    await transition(db, first.id, 'start')
    await transition(db, first.id, 'finish')
    await transition(db, first.id, 'supersede')

    const second = await dispatch(db, pool, { ...base, source })
    expect(second.deduped).toBe(false)
    expect(second.id).not.toBe(first.id)
  })

  it('still dedups a source whose prior item is FINISHED-but-open (not closed)', async () => {
    const { pool } = fakePool()
    const source = `thread:${randomUUID()}`
    const first = await dispatch(db, pool, { ...base, source })
    await transition(db, first.id, 'start')
    await transition(db, first.id, 'finish')

    const second = await dispatch(db, pool, { ...base, source })
    expect(second).toEqual({ id: first.id, deduped: true })
  })

  it('still dedups a source whose prior item is live (running)', async () => {
    const { pool } = fakePool()
    const source = `thread:${randomUUID()}`
    const first = await dispatch(db, pool, { ...base, source })
    await transition(db, first.id, 'start')
    const second = await dispatch(db, pool, { ...base, source })
    expect(second).toEqual({ id: first.id, deduped: true })
  })
```

- [ ] **Step 2: Run the tests, expect FAIL.**
```
yarn test packages/server/src/dispatch.test.ts
```
Expected: the first new case FAILS — the current SELECT (which only excludes `error`/`rejected`) matches the `closed`/`superseded` item, so `second.deduped` is `true` instead of `false`. The other two new cases pass with the old code (they confirm we don't break the live/finished dedup).

- [ ] **Step 3: Narrow the dedup SELECT.** In `packages/server/src/dispatch.ts`, update the imports on line 2 to add `notInArray`:
```ts
import { and, eq, ne, or, isNull, notInArray } from 'drizzle-orm'
```
Then replace the comment + dedup block (lines 59-75) with the open-scoped version:
```ts
  // 1. One-time dedup, scoped to OPEN/unclosed items only (WS1): a same-source WorkItem that is
  //    still queued|running|awaiting_approval|awaiting_input, OR finished-but-not-yet-closed,
  //    already covers this source. A 'closed' item (a superseded scan's leaf), or one resolved
  //    'rejected' / 'cancelled' / 'superseded', does NOT shadow — a re-scan re-surfaces the
  //    un-actioned source. The `workItemId+gateId` effect ledger (I9) is the real guard against
  //    a double irreversible action; this dedup only prevents a duplicate OPEN card.
  if (input.source) {
    const [existing] = await db
      .select({ id: workItems.id })
      .from(workItems)
      .where(
        and(
          eq(workItems.source, input.source),
          ne(workItems.status, 'error'),
          ne(workItems.status, 'closed'),
          or(
            isNull(workItems.resolution),
            notInArray(workItems.resolution, ['rejected', 'cancelled', 'superseded'])
          )
        )
      )
      .limit(1)
    if (existing) return { id: existing.id, deduped: true }
  }
```

- [ ] **Step 4: Run the tests, expect PASS.**
```
yarn test packages/server/src/dispatch.test.ts
```
Expected: all `dispatch()` cases green — the closed/superseded source re-surfaces (`deduped: false`), the finished-open and live sources still dedup, and the original "dedups a repeated source while the first is live" + "does NOT dedup when source is absent" cases still pass.

- [ ] **Step 5: Commit.**
```
git add packages/server/src/dispatch.ts packages/server/src/dispatch.test.ts
git commit -m "fix(dispatch): scope source dedup to open/unclosed items (re-surface un-actioned on re-scan)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Add a `getFinishedInputRoots` reader to the StateStore

`pipelineService.dispatch()` needs to find the prior *finished* root of the same `workflow × input-agent` to supersede it. Add a thin, tested reader on the store (the only place CRUD lives). A "root" is parentless (the input agent is always dispatched with `parentId = null`); "finished" means status `finished` and not yet `closed`, with no terminal resolution.

**Files:**
- `packages/server/src/stateStore.ts` (add a method after `getActiveByWorkflow`, lines 186-189; imports line 2)

- [ ] **Step 1: Add the reader (no separate test — covered by the pipelineService integration test in Task 6, the canonical level for store readers; matches `getActiveByWorkflow` which has no standalone test).** In `packages/server/src/stateStore.ts`, ensure `isNull` is imported. Line 2 currently is:
```ts
import { and, asc, count, eq, gte } from 'drizzle-orm'
```
Change it to:
```ts
import { and, asc, count, eq, gte, isNull } from 'drizzle-orm'
```
Then add this method inside the returned object, after `getActiveByWorkflow` (after line 189, before the closing `}` on line 190):
```ts
    // The prior FINISHED, parentless scan roots of a given workflow × input-agent — the
    // candidates a fresh human START supersedes (WS1). Finished-but-open only: a 'closed'
    // (already-superseded) root, or one with a terminal resolution, is excluded. Children
    // (parentId != null) are never roots and are never superseded (I12 — they stay durable).
    async getFinishedInputRoots(workflowId: string, agentId: string): Promise<WorkItem[]> {
      return db
        .select()
        .from(workItems)
        .where(
          and(
            eq(workItems.workflowId, workflowId),
            eq(workItems.agentId, agentId),
            isNull(workItems.parentId),
            eq(workItems.status, 'finished'),
            isNull(workItems.resolution)
          )
        )
    },
```

- [ ] **Step 2: Typecheck.**
```
yarn typecheck
```
Expected: PASS — the new method returns `Promise<WorkItem[]>` and `isNull` is now imported.

- [ ] **Step 3: Commit.**
```
git add packages/server/src/stateStore.ts
git commit -m "feat(stateStore): getFinishedInputRoots reader for re-run supersede

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Supersede the prior finished root on a human START (pipelineService — the orchestration seam)

This is where `'refresh'` is wired. On a human START of an **input agent**, before minting the new root, supersede every prior finished root of the same `workflow × input-agent` (status `closed`, resolution `superseded`, via `transition()`). The concurrency rule is unchanged: a 2nd *concurrent* START of the singleton input still 409s (`already_running`) — that check (lines 169-171) runs first and short-circuits before any supersede. The supersede only matters for the *sequential* re-run (the prior root is already finished, so the pool's active count is 0, so the 409 guard does not fire).

We determine "is this an input agent?" from `deps.descriptors` (the `WorkflowDescriptor[]` already injected). The dispatched `req.agentId` is `wf__agent`; map it to its descriptor's agent role.

**Files:**
- `packages/server/src/pipelineService.ts` (the `dispatch` method, lines 163-183; add a private helper near `cancelWorkflowImpl`, lines 155-160; imports lines 6-9, 20-21)
- `packages/server/src/pipelineService.test.ts` (add a describe block)

- [ ] **Step 1: Write failing integration tests.** Add this `describe` block at the end of `packages/server/src/pipelineService.test.ts`, after the last closing `})` (line 499). It uses a descriptor so the service can resolve the input role, and a provider that finishes immediately (so the first scan becomes `finished` and the slot frees, allowing the sequential re-START). Add `instanceId` to the existing `@atizar/core` import at the top of the file (line 6-14) if not present.
```ts
describe.skipIf(!reachable)('PipelineService re-run supersede (WS1)', () => {
  // A provider that finishes immediately (one text chunk, no gate) — the scan goes
  // queued → running → finished, freeing the singleton slot for a sequential re-START.
  function quickProvider(): Provider {
    return {
      async *run(_input: RunAgentInput) {
        yield ev({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm1', delta: 'scanned' })
      },
    }
  }

  const inputWf = defineWorkflow({
    id: 'rerun-wf',
    label: 'R',
    iconName: 'inbox',
    agents: [
      {
        agent: defineAgent({
          id: 'sorter',
          name: 's',
          provider: 'mock',
          instructions: 'x',
          tools: ['t'],
          approvals: [],
          renders: {},
        }),
        role: 'input',
      },
    ],
    entryAgentId: 'sorter',
    inputs: [],
  })

  function makeReRunService() {
    const runtime: AgentRuntime = {
      provider: quickProvider(),
      renderToolNames: [],
      maxInstances: 1,
      effects: {},
      dispatchToolNames: [],
      handoffs: [],
    }
    return makePipelineService({ db, resolveAgent: () => runtime, descriptors: [inputWf] })
  }

  it('a sequential human re-START supersedes the prior finished root and mints a new one', async () => {
    const svc = makeReRunService()
    const agentId = 'rerun-wf__sorter'
    const first = await svc.dispatch({
      workflowId: 'rerun-wf',
      agentId,
      origin: 'human',
      payload: {},
    })
    await waitFor(async () => (await svc.getStatus(first.id))?.status === 'finished')

    const second = await svc.dispatch({
      workflowId: 'rerun-wf',
      agentId,
      origin: 'human',
      payload: {},
    })
    expect(second.rejected).toBeUndefined()
    expect(second.id).not.toBe(first.id)

    // the prior finished root is now closed + superseded (preserved, not destroyed — I12)
    const firstStatus = await svc.getStatus(first.id)
    expect(firstStatus?.status).toBe('closed')
    const board = await svc.getBoard()
    const firstRow = board.items.find((i) => i.id === first.id)
    expect(firstRow?.resolution).toBe('superseded')
    // the prior row still exists (openable via Activity/trace) — not deleted
    expect(firstRow).toBeDefined()
  })

  it('the supersede is recorded in the Activity log', async () => {
    const svc = makeReRunService()
    const agentId = 'rerun-wf__sorter'
    const first = await svc.dispatch({ workflowId: 'rerun-wf', agentId, origin: 'human', payload: {} })
    await waitFor(async () => (await svc.getStatus(first.id))?.status === 'finished')
    await svc.dispatch({ workflowId: 'rerun-wf', agentId, origin: 'human', payload: {} })
    const entry = svc.getActivity().find((e) => e.workItemId === first.id && e.kind === 'superseded')
    expect(entry).toBeDefined()
  })

  it('a 2nd CONCURRENT human START of the singleton input still 409s (supersede does not change concurrency)', async () => {
    // blockingProvider keeps the first scan RUNNING (slot occupied) — the concurrency guard fires
    // before any supersede; the prior root is not finished, so there is nothing to supersede.
    const runtime: AgentRuntime = {
      provider: blockingProvider(),
      renderToolNames: [],
      maxInstances: 1,
      effects: {},
      dispatchToolNames: [],
      handoffs: [],
    }
    const svc = makePipelineService({ db, resolveAgent: () => runtime, descriptors: [inputWf] })
    const agentId = 'rerun-wf__sorter'
    const first = await svc.dispatch({ workflowId: 'rerun-wf', agentId, origin: 'human', payload: {} })
    expect(first.rejected).toBeUndefined()
    const second = await svc.dispatch({ workflowId: 'rerun-wf', agentId, origin: 'human', payload: {} })
    expect(second.rejected).toBe('already_running')
  })

  it('a non-input agent human START does NOT supersede (only input roots refresh)', async () => {
    // dispatch a worker-role agent directly (origin human) twice; finishing the first should
    // NOT close it — refresh applies only to input agents.
    const runtime: AgentRuntime = {
      provider: quickProvider(),
      renderToolNames: [],
      maxInstances: 2,
      effects: {},
      dispatchToolNames: [],
      handoffs: [],
    }
    const svc = makePipelineService({ db, resolveAgent: () => runtime, descriptors: [inputWf] })
    const first = await svc.dispatch({
      workflowId: 'rerun-wf',
      agentId: 'rerun-wf__worker-x', // not a declared input agent in inputWf
      origin: 'human',
      payload: {},
    })
    await waitFor(async () => (await svc.getStatus(first.id))?.status === 'finished')
    await svc.dispatch({
      workflowId: 'rerun-wf',
      agentId: 'rerun-wf__worker-x',
      origin: 'human',
      payload: {},
    })
    expect((await svc.getStatus(first.id))?.status).toBe('finished') // NOT closed
  })
})
```

- [ ] **Step 2: Run the tests, expect FAIL.**
```
yarn test packages/server/src/pipelineService.test.ts
```
Expected: the supersede cases FAIL — the prior root stays `finished` (status not `closed`, no `superseded` resolution, no `superseded` activity entry) because the supersede is not yet wired. The concurrency-409 case and the non-input case pass on the old code (no regression). If Postgres is unreachable the suite skips — start it.

- [ ] **Step 3: Import the supersede dependencies.** In `packages/server/src/pipelineService.ts`, the `@atizar/core` import block (lines 2-9) and the `transition` import (line 20) already cover what we need. Add `instanceId` to the `@atizar/core` import so we can map a descriptor's agent id to its `wf__agent` runtime key. Change the import block (lines 2-9) to add `instanceId`:
```ts
import {
  resolveDelivery,
  deliveryKey,
  instanceId,
  type Destination,
  type GateResolution,
  type WorkflowDescriptor,
  type HealthCheck,
} from '@atizar/core'
```

- [ ] **Step 4: Add an `isInputAgent` helper.** In `packages/server/src/pipelineService.ts`, add this helper inside `makePipelineService`, just before the `return {` on line 162 (after `cancelWorkflowImpl`, line 160):
```ts
  // True when `agentId` (= wf__agent) is the runtime key of a role:'input' agent in some loaded
  // descriptor. The set of input runtime keys is derived once from deps.descriptors; refresh
  // applies ONLY to input roots (a worker re-START is an ordinary new dispatch, never a refresh).
  const inputAgentKeys = new Set<string>(
    deps.descriptors.flatMap((wf) =>
      wf.agents.filter((a) => a.role === 'input').map((a) => instanceId(wf.id, a.agent.id))
    )
  )
  const isInputAgent = (agentId: string): boolean => inputAgentKeys.has(agentId)

  // 'refresh' re-run (WS1, I1/I8/I12): on a human START of an input agent, retire each prior
  // FINISHED root of the same workflow × input-agent into the preserved Done bucket (status
  // 'closed', resolution 'superseded') via transition() — children are NOT touched (durable).
  // BRANCH POINT for rerun:'history' (reserved, NOT wired in the beta): when a workflow declares
  // rerun:'history', skip this supersede entirely — every finished scan stays current and the
  // human chooses. Look up the descriptor's `rerun` here and early-return before superseding.
  async function supersedePriorRoots(workflowId: string, agentId: string): Promise<void> {
    const roots = await store.getFinishedInputRoots(workflowId, agentId)
    for (const root of roots) {
      await transition(db, root.id, 'supersede').catch(() => {})
      activity.record({
        ts: Date.now(),
        workflowId: root.workflowId,
        agentId: root.agentId,
        workItemId: root.id,
        kind: 'superseded',
        summary: 'superseded by re-run',
      })
    }
  }
```

- [ ] **Step 5: Invoke the supersede in `dispatch()` before minting the new root.** In `packages/server/src/pipelineService.ts`, in the `dispatch` method (163-183), insert the supersede call after the 409 guard (after line 171) and before `dispatchChokepoint` (line 172):
```ts
      // F6: a second human START of a singleton agent (maxInstances=1) is rejected (not queued).
      // Applies only to singletons — agents with maxInstances > 1 continue to queue overflow.
      // Machine dispatch (origin 'agent') is unaffected — the chokepoint handles its own cap/queue.
      if (req.origin === 'human' && maxInstances === 1 && pool.activeCount(req.agentId) >= 1) {
        return { id: '', deduped: false, rejected: 'already_running' }
      }
      // WS1 'refresh': a human START of an input agent supersedes its prior finished root(s)
      // BEFORE minting the new one — I1 (the START always does something visible: a fresh root
      // appears AND the prior moves to history). Concurrency is unchanged: the 409 guard above
      // already short-circuited a concurrent START, so we only ever reach here for a sequential
      // re-run (prior root already finished, slot free).
      if (req.origin === 'human' && isInputAgent(req.agentId)) {
        await supersedePriorRoots(req.workflowId, req.agentId)
      }
      const result = await dispatchChokepoint(db, pool, { ...req, maxInstances })
```

- [ ] **Step 6: Run the tests, expect PASS.**
```
yarn test packages/server/src/pipelineService.test.ts
```
Expected: all `PipelineService` cases green, including the four new re-run cases — the prior root is `closed`+`superseded` and preserved, a `superseded` activity entry is recorded, the concurrent 2nd START still 409s, and a non-input agent does not supersede.

- [ ] **Step 7: Commit.**
```
git add packages/server/src/pipelineService.ts packages/server/src/pipelineService.test.ts
git commit -m "feat(pipeline): supersede prior finished input root on human re-START (refresh)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Hide superseded roots from the live column (`boardModel.isVisible`)

A superseded root has status `closed` and resolution `superseded`. Today `isVisible` keeps any input root forever (`isInput || …` on line 20) and keeps a `closed` item if it has a card or resolution — so a superseded root would stay in the live column. Hide it: a `closed` input root with `resolution === 'superseded'` drops out of the live pipeline (still reachable via Activity/trace — I12).

**Files:**
- `packages/react/src/boardModel.ts` (`isVisible`, lines 17-21)
- `packages/react/src/boardModel.test.ts` (add a case)

- [ ] **Step 1: Write a failing test.** In `packages/react/src/boardModel.test.ts`, add a superseded root to the fixture and assert it is filtered out. Add this `describe` block after the existing `statusesOf` describe (after line 58):
```ts
describe('toPInstances superseded roots (WS1)', () => {
  const withSuperseded: WorkItem[] = [
    wi({ id: 'Q1', agentId: 'lead-inbox__qualifier', status: 'closed', resolution: 'superseded' }),
    wi({ id: 'Q2', agentId: 'lead-inbox__qualifier', status: 'running' }),
  ]
  it('hides a closed+superseded input root, keeps the current running one', () => {
    const out = toPInstances(withSuperseded, 'lead-inbox', roleOf, metaIcon, nameOf, labelOf)
    expect(out.map((p) => p.localId)).toEqual(['Q2'])
  })
  it('still keeps a plain finished input root (not superseded)', () => {
    const finishedRoot: WorkItem[] = [
      wi({ id: 'Q3', agentId: 'lead-inbox__qualifier', status: 'finished' }),
    ]
    const out = toPInstances(finishedRoot, 'lead-inbox', roleOf, metaIcon, nameOf, labelOf)
    expect(out.map((p) => p.localId)).toEqual(['Q3'])
  })
})
```

- [ ] **Step 2: Run the test, expect FAIL.**
```
yarn test packages/react/src/boardModel.test.ts
```
Expected: the first new case FAILS — the current `isVisible` returns `true` for the `closed`+`superseded` input root (because `isInput` is true), so `out` is `['Q1', 'Q2']` instead of `['Q2']`.

- [ ] **Step 3: Hide superseded roots in `isVisible`.** In `packages/react/src/boardModel.ts`, update the `isVisible` function (17-21). Add an early-out for a superseded item, then keep the rest unchanged:
```ts
// An item is shown in the pipeline once it is past `queued` AND still relevant: active
// (running/awaiting), an input agent (the pipeline root, kept after it finishes), errored,
// or carrying a result to show (a card, or a cancelled/rejected marker). A plain finished
// leaf worker with nothing to show drops out — matches the old "done workers torn down".
// A superseded root (WS1: status 'closed', resolution 'superseded') drops out of the LIVE
// column entirely — it lives on in Activity/trace (preserved, not destroyed — I12).
const isVisible = (w: WorkItem, isInput: boolean): boolean => {
  if (isQueued(w)) return false
  if (w.resolution === 'superseded') return false
  if (w.status !== 'finished' && w.status !== 'closed') return true
  return isInput || w.card !== null || w.resolution !== null
}
```

- [ ] **Step 4: Run the test, expect PASS.**
```
yarn test packages/react/src/boardModel.test.ts
```
Expected: all `boardModel` cases green — the superseded root is hidden, the plain finished root and the running root stay, and the original `toPInstances`/`queuedByAgent`/`statusesOf` cases are unaffected.

- [ ] **Step 5: Commit.**
```
git add packages/react/src/boardModel.ts packages/react/src/boardModel.test.ts
git commit -m "fix(boardModel): hide superseded roots from the live pipeline column

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Fix the "Working" mislabel (`pipelineModel.view()` — relabel only with a LIVE child)

Today `view()` (61-63) relabels ANY kept-but-not-active instance to `running`, so a finished input root reads "Working" even when nothing is live under it. Fix: relabel a parent to `running` only when it has a **live** child; a kept root with no live child keeps its true status (e.g. `done`). A leaf instance (no children) keeps its own status.

**Files:**
- `packages/react/src/pipelineModel.ts` (`view()` and its call sites, lines 61-96)
- `packages/react/src/pipelineModel.test.ts` (add cases)

- [ ] **Step 1: Write failing tests.** In `packages/react/src/pipelineModel.test.ts`, add these cases inside the `describe('buildPipeline', …)` block, before its closing `})` on line 126:
```ts
  it('a finished input root with no live child keeps Done (not relabeled Working)', () => {
    const blocks = buildPipeline(
      [i({ localId: 'in', agentId: 'sorter', isInput: true, status: 'done', label: '' })],
      {}
    )
    expect(blocks[0].parent.status).toBe('done')
  })

  it('a kept input root WITH a live child still shows Working', () => {
    const blocks = buildPipeline(
      [
        i({ localId: 'in', agentId: 'sorter', isInput: true, status: 'done' }),
        i({ localId: 'c1', agentId: 'reply', parentLocalId: 'in', status: 'running' }),
      ],
      {}
    )
    expect(blocks[0].parent.status).toBe('running')
  })

  it('a kept-but-done intermediate parent (live grandchild) shows Working', () => {
    const blocks = buildPipeline(
      [
        i({ localId: 'in', agentId: 'sorter', isInput: true, status: 'done' }),
        i({ localId: 'r1', agentId: 'reply', parentLocalId: 'in', status: 'done' }),
        i({ localId: 'b1', agentId: 'bugfix', parentLocalId: 'r1', status: 'running' }),
      ],
      {}
    )
    // 'in' has a live descendant (b1 under r1) so it shows Working; r1 also shows Working.
    expect(blocks.find((bl) => bl.parent.localId === 'in')!.parent.status).toBe('running')
    expect(blocks.find((bl) => bl.parent.localId === 'r1')!.parent.status).toBe('running')
  })
```

- [ ] **Step 2: Run the tests, expect FAIL.**
```
yarn test packages/react/src/pipelineModel.test.ts
```
Expected: the first new case FAILS — `view()` currently relabels the lone done root to `running`, so `parent.status` is `'running'` not `'done'`. The "WITH a live child" cases pass on the old code (it relabels everything), but they pin the behavior we must preserve.

- [ ] **Step 3: Make `view()` relabel only with a live child/descendant.** In `packages/react/src/pipelineModel.ts`, the `view()` closure (61-63) is called for both `parent` (line 95) and child instances (line 91). It needs to know whether a node has a live (active) child to decide relabeling. Replace the `view` definition (lines 61-63) with a version that takes a "has live descendant" predicate computed over the instance tree:
```ts
  // A "live descendant" exists if any node in the subtree rooted at x is ACTIVE (running /
  // awaiting_approval / error). Precompute per-localId so view() is O(1).
  const childrenById = childrenOf
  const hasLiveDescendant = new Map<string, boolean>()
  const computeLive = (x: PInstance): boolean => {
    if (hasLiveDescendant.has(x.localId)) return hasLiveDescendant.get(x.localId)!
    let live = false
    for (const kid of childrenById.get(x.localId) ?? []) {
      if (ACTIVE.has(kid.status) || computeLive(kid)) live = true
    }
    hasLiveDescendant.set(x.localId, live)
    return live
  }
  for (const x of instances) computeLive(x)

  // A parent is shown "Working" (running) ONLY while it has a live descendant; otherwise it
  // keeps its true status (a finished/closed root with no live child reads Done — WS1 label fix).
  // An already-active node keeps its own status as-is.
  const view = (x: PInstance): PInstance =>
    ACTIVE.has(x.status) || hasLiveDescendant.get(x.localId)
      ? ACTIVE.has(x.status)
        ? x
        : { ...x, status: 'running' as Status }
      : x
```
Note: `childrenOf` is built earlier in the function (lines 37-43); `ACTIVE` is the module-level set (line 29). This block must be placed AFTER `childrenOf` is populated (after line 43) and BEFORE `view` is first used (it currently sits at 61-63, which is already after `childrenOf`). Keep it in the same location.

- [ ] **Step 4: Run the tests, expect PASS.**
```
yarn test packages/react/src/pipelineModel.test.ts
```
Expected: all `buildPipeline` cases green — the lone done root keeps `done`, a root with a live child shows `running`, an intermediate done parent with a live grandchild shows `running`, and the existing structural cases (single-instance group, grouping, queued count, drop-done-worker, depth-2 repeat) are unaffected.

- [ ] **Step 5: Commit.**
```
git add packages/react/src/pipelineModel.ts packages/react/src/pipelineModel.test.ts
git commit -m "fix(pipelineModel): label a kept parent Working only with a live descendant

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Verify aggregate Done still reads right (no code change expected)

The big "type" card aggregates an agent's live instance statuses (`aggregate.ts`). With the supersede in place, a superseded root is `closed` → maps to `done` via `mapStatus`. But superseded roots are now filtered out of `toPInstances` (Task 7), so they never reach `statusesOf`/the aggregate. Confirm the aggregate still reads `Done` for a single finished current scan and shows nothing stale.

**Files:**
- `packages/react/src/aggregate.ts` (verify only — read, do not edit unless a test fails)
- `packages/react/src/aggregate.test.ts` (add a confirmation case if cheap)

- [ ] **Step 1: Read `aggregate.ts` and confirm the logic.** Confirm `aggregateAgent` counts `ACTIVE` (`running`/`awaiting_approval`/`error`) for `activeCount`, and `aggregateLabel` returns `''` when `activeCount === 0`. A finished current scan (status `done`) contributes 0 to `activeCount`, so the label is empty and `status` resolves to `'done'` via `PRIORITY`. This is correct — no change needed.

- [ ] **Step 2: Add a confirmation test (cheap regression pin).** In `packages/react/src/aggregate.test.ts`, add a case asserting a single `done` status aggregates to `status: 'done'` with empty label (mirror the file's existing test style — read it first to match the import/describe shape):
```ts
  it('a single finished scan aggregates to Done with no active label', () => {
    const a = aggregateAgent(['done'])
    expect(a.status).toBe('done')
    expect(a.activeCount).toBe(0)
    expect(aggregateLabel(a)).toBe('')
  })
```
(Place it inside the existing `describe` for `aggregateAgent`/`aggregateLabel`; if the file imports `aggregateAgent`/`aggregateLabel` differently, match that.)

- [ ] **Step 3: Run the test, expect PASS (no implementation change).**
```
yarn test packages/react/src/aggregate.test.ts
```
Expected: PASS with no edit to `aggregate.ts`.

- [ ] **Step 4: Commit (test-only).**
```
git add packages/react/src/aggregate.test.ts
git commit -m "test(aggregate): pin Done headline for a single finished scan

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Set `rerun: 'refresh'` explicitly on the three input workflows (config-as-data)

The default at the call site is `'refresh'` (Task 6 treats `undefined` as refresh — the `isInputAgent` path always supersedes). Declaring it explicitly on each workflow documents the intent and exercises the new field end-to-end. All three input agents (`sorter`/`triage`/`qualifier`) are live-source scans, so `'refresh'` is correct for all.

**Files:**
- `apps/inbox/workflows/email-inbox/descriptor.ts` (the `emailInbox` descriptor, lines 80-96)
- `apps/inbox/workflows/github-triage/descriptor.ts` (the `githubTriage` descriptor, lines 44-56)
- `apps/inbox/workflows/lead-inbox/descriptor.ts` (the `leadInbox` descriptor, lines 29-42)

- [ ] **Step 1: Add `rerun: 'refresh'` to `emailInbox`.** In `apps/inbox/workflows/email-inbox/descriptor.ts`, add the field to the `defineWorkflow({…})` call. Insert after `iconName: 'inbox',` (line 83):
```ts
  rerun: 'refresh', // human re-START supersedes the prior finished scan (live-source inbox scan)
```

- [ ] **Step 2: Add `rerun: 'refresh'` to `githubTriage`.** In `apps/inbox/workflows/github-triage/descriptor.ts`, add the field after `iconName: 'git',` (line 47):
```ts
  rerun: 'refresh', // human re-START re-reads the board; the prior scan moves to history
```

- [ ] **Step 3: Add `rerun: 'refresh'` to `leadInbox`.** In `apps/inbox/workflows/lead-inbox/descriptor.ts`, add the field after `iconName: 'inbox',` (line 32):
```ts
  rerun: 'refresh', // human re-START re-reads the latest email; the prior scan moves to history
```

- [ ] **Step 4: Typecheck — confirm the descriptors compile with the new field.**
```
yarn typecheck
```
Expected: PASS (the `rerun` field is now declared on `WorkflowDescriptor`).

- [ ] **Step 5: Commit.**
```
git add apps/inbox/workflows/email-inbox/descriptor.ts apps/inbox/workflows/github-triage/descriptor.ts apps/inbox/workflows/lead-inbox/descriptor.ts
git commit -m "chore(workflows): declare rerun:'refresh' on the three input workflows

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Full green gate (typecheck + test + lint + format + @atizar/react build)

The green gate from spec §4: `yarn typecheck` && `yarn test` && `yarn lint` && `yarn format:check`, and because this WS changes `@atizar/react`, ALSO `yarn build` of that package.

- [ ] **Step 1: Run check-foundation.** This WS touches `@atizar/core`, the transition edge map (status writes / I8), the dedup chokepoint (I9-adjacent), and the framework boundary. Invoke the `check-foundation` skill against the full diff. Expected: CLEAR with the §0 guard-rails honored (supersede through `transition()`, children preserved, human START always visible, ledger intact). If it WARNs, STOP and reconcile before continuing.

- [ ] **Step 2: Typecheck (whole workspace).**
```
yarn typecheck
```
Expected: PASS — `tsc --build` across all packages + `apps/inbox`.

- [ ] **Step 3: Run the full test suite.**
```
yarn test
```
Expected: all suites green (450+ tests). The server integration suites (`transition`, `dispatch`, `pipelineService`) run against real Postgres via the global setup; if Postgres is down they `skipIf` — start Postgres (`docker compose up -d` or the project's compose) so they actually run for the gate.

- [ ] **Step 4: Lint.**
```
yarn lint
```
Expected: GREEN (no errors). If a new import (`notInArray`, `instanceId`, `isNull`) is flagged unused anywhere, remove it; if `no-unused-vars` flags the `childrenById` alias in `pipelineModel.ts`, inline it.

- [ ] **Step 5: Format check.**
```
yarn format:check
```
Expected: PASS. If it fails, run `yarn format` and re-stage.

- [ ] **Step 6: Build `@atizar/react` (lib build gate for the package's changes).**
```
yarn workspace @atizar/react build
```
Expected: Vite library build succeeds (ESM + rolled-up `.d.ts` + `react.css`). This catches CSS-Module/`development`-condition issues that the monorepo `./src` dev path masks.

- [ ] **Step 7: Commit any format fixes (if step 5 required `yarn format`).**
```
git add -p
git commit -m "style: format WS1 changes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
(Skip if nothing changed.)

---

### Task 12: Browser-verify (project HARD RULE — drive the real app)

Invoke the `browser-verify` skill first (dev-server hygiene + Playwright-MCP recovery). Then drive the real app — reload-masking bugs only the browser catches (e.g. the per-WorkItem SSE storm). Ensure Postgres is running and the migration is applied (`yarn workspace inbox db:migrate`) before starting.

- [ ] **Step 1: Start the dev stack** per the `browser-verify` skill (kill stale stacks, free `:4000`/`:5173`, then `yarn dev`). Wait for both server (:4000) and client (:5173).

- [ ] **Step 2: Two sequential STARTs of `email-inbox` → exactly ONE EMAIL SORTER row, labeled correctly.** Open the app, START the email-inbox `EMAIL SORTER`. Wait for the scan to finish (label flips `Working` → `Done`; never a finished root showing `Working`). START it again. Confirm: exactly **one** EMAIL SORTER row in the live Pipeline column (the latest), `Working` while running and `Done` when finished. The prior scan must NOT stack as a second live row.

- [ ] **Step 3: The prior scan is still reachable.** Open the Activity log / trace and confirm the superseded scan's events are still present (a `superseded` activity entry for the prior root). The prior root is preserved, not destroyed (I12).

- [ ] **Step 4: An un-actioned email is re-surfaced, an approved one is never double-sent.** With an un-actioned email from scan #1 still open (e.g. a reply/batch card not yet approved), re-START. Confirm the un-actioned item is NOT duplicated (open-scoped dedup keeps the single open card). Then approve a draft (HITL flow) and re-START again — confirm the already-approved/sent email is never re-surfaced as a new actionable item and the effect runs exactly once (effect ledger, I9). Verify the approval flow itself in-browser (this project's standing rule: always verify HITL in the browser).

- [ ] **Step 5: Spot-check the other two input workflows.** Repeat the two-sequential-START + label check for `github-triage` (TRIAGE) and `lead-inbox` (LEAD QUALIFIER) — all three must behave per `rerun:'refresh'` (one current row, prior superseded).

- [ ] **Step 6: Verify the branch is correct before finishing.**
```
git rev-parse --abbrev-ref HEAD
```
Expected: `analysis/workflow-rerun-semantics` (the WS plan is authored on this branch context; the implementation may be on its own branch off `master` per the spec — confirm you are NOT on `master` and have not switched branches mid-run).

---

## Done when

(WS1 Acceptance criteria, copied from spec §2 WS1)

- [ ] **(a)** Two sequential STARTs of `email-inbox` leave exactly **one** `EMAIL SORTER` row in the live column (the latest), labeled correctly (`Working` while running, `Done` when finished — never a finished root showing `Working`); the prior scan is still reachable in Activity/history.
- [ ] **(b)** An un-actioned email from scan #1 is NOT duplicated by scan #2 (open-scoped dedup), and an already-approved/sent email is never double-sent (effect ledger).
- [ ] **(c)** All three workflows behave per `rerun: 'refresh'`.
- [ ] **(d)** Green gate (`yarn typecheck` && `yarn test` && `yarn lint` && `yarn format:check` && `yarn workspace @atizar/react build`) + browser-verified.

Foundation guard-rails honored:
- [ ] I8 — the supersede is a `transition()` edge; no status side-writes in `dispatch.ts`/`pipelineService.ts`/routes.
- [ ] I12 — the prior root is `closed`/`superseded` (preserved, openable, closable), NOT destroyed; no child cascade.
- [ ] I1 — every human START mints a new visible root (and supersedes the prior one); no "no-op when nothing changed."
- [ ] I9 — `store.claimLedger` (`workItemId+gateId`) is intact as the double-action guard; dedup change does not weaken it.

## Browser-verify

This project's HARD RULE: drive the REAL app in a browser for every user-visible flow — do not stop at unit/integration tests. Reload-masking bugs only the browser catches (the per-WorkItem SSE reconnect storm; a finished root mislabeled `Working` that a reload would hide). For WS1 specifically: the two-sequential-START + label check (Task 12 steps 2-5) and the HITL approval flow (step 4 — approve a draft, confirm the effect runs exactly once and a re-START never double-sends). Invoke the `browser-verify` skill before starting (dev-server hygiene, port `:4000`/`:5173` recovery, Playwright-MCP profile-lock recovery). Ensure Postgres is up and the `0002` migration is applied before driving the app.
