# Single `isLive` Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the THREE divergent "live/active" computations (`pipelineModel.ACTIVE`, `aggregate.BUSY`, the inline `liveCount` set in `InstancePickerModal`) with ONE shared `isLive`/`isBusy` predicate module, then layer an `isLive`-filter on the instance heads in `useBoardNavigation` so the card, picker, and open-routing show only live instances while the pipeline keeps its `isLive(self) || hasLiveDescendant` tree rule.

**Architecture:** A new pure `packages/react/src/liveness.ts` defines `isLive(status)` (`running | awaiting_approval | error` — "shown in live UI") and `isBusy(status)` (`running | awaiting_approval` — the START-slot gate), two questions over one `Status` that differ ONLY on `error`. Each consumer asks the right question: the pipeline tree asks `isLive`; the card aggregate and picker `liveCount` ask `isBusy`; `useBoardNavigation`'s `instancesOf`/`liveOf` filter instance heads to `isLive` so card + picker + `openAgent` routing only ever see live instances. `boardModel.toPInstances` is untouched — it keeps filtering by core `isVisible` (board membership); `isLive` is the live-list filter layered on top.

**Tech Stack:** TypeScript, Vitest, React + Testing Library, `@atizar/react` (Vite library mode build). `Status` from `packages/react/src/status.ts`; `hasLiveDescendant` from `@atizar/core` (already used in `boardModel`/`pipelineModel`).

## Global Constraints

> **READ FIRST — two standing rules for whoever implements this (the reason this whole plan set exists). Hold them on EVERY task:**
> 1. **Always think about the framework/app boundary.** Before placing any non-trivial code, ask: generic *mechanism* every workflow needs (→ `@atizar/*`) or *one workflow's policy* (→ `apps/inbox/...`)? A framework symbol carries ZERO workflow knowledge — no `reply/reader/spam/email/ticket` literals. Unsure → default to the app; lift only when a 2nd consumer proves it generic. Don't let the two get confused.
> 2. **Never multiply sources of truth.** One derivation per concept (liveness, status, priority, counts). Reuse the existing predicate/classifier; a new question is asked OF the one status, never a forked new set.

- **Framework/app boundary (I5):** everything here is **framework-generic** client code in `@atizar/react`. `liveness.ts` knows only the client `Status` union — zero workflow literals (no `reply/reader/spam/email/sorter`). The one app file touched (`BoardInner.tsx` `aggOf`) is glue that already calls the framework helpers; it needs no edit beyond inheriting the filtered `instancesOf`.
- **One derivation per concept (single-source invariant):** after this plan there is exactly ONE definition of "live" and ONE of "busy". The three local sets (`ACTIVE`, `BUSY`, the picker's inline `running/awaiting` filter) are DELETED — re-introducing any of them is a regression. `PRIORITY`/`pickHead` are a separate concept (status ordering) and stay where they are.
- **TDD:** no production code without a failing test first. Watch each test fail, then pass.
- **Green gate before "done":** `yarn typecheck && yarn test && yarn lint && yarn format:check` from repo root, plus `yarn workspace @atizar/react build` (this plan changes `@atizar/react`). Tests run via `yarn test` (vitest) from repo root.
- **`check-foundation` is NOT needed here.** This is client-only presentation: no `@atizar/core` lifecycle classifier change, no provider, no server transition, no new edge/phase. `boardModel`'s core `lifecycle()`/`isVisible`/`hasLiveDescendant` usage is unchanged. The acknowledge edge, the `awaiting_agents` phase, and the resume contract (the parts of the spec that DO touch the foundation) are explicitly OUT of scope for P0 — they are later plans.
- **Status union note:** the client `Status` is `'idle' | 'running' | 'awaiting_approval' | 'done' | 'error'` (`status.ts`). The spec's `stopped`/`rejected`/acknowledge-`dismissed` distinctions are core **`Outcome`** values that `displayStatus` already collapses into the `'done'` lane — so at the `Status` level, "recede" = "not `isLive`", and `done` (incl. stopped/rejected) is correctly excluded by `isLive`. P0 needs no new `Status` member.

---

### Task 1: The shared `liveness.ts` predicate (the keystone — TDD)

This is the contract the other surfaces (and 5 downstream plans) depend on. Define it exactly.

**Files:**
- Create: `packages/react/src/liveness.ts`
- Test: `packages/react/src/liveness.test.ts`
- Modify: `packages/react/src/index.ts` (export `isLive`/`isBusy` — verify the export list; add alongside the other client-status exports)

**Interfaces:**
- Produces:
  - `isLive(status: Status): boolean` — `true` for `running | awaiting_approval | error`. "Shown in the live UI." (Per spec §1, `error` is `isLive` until acknowledged; acknowledge moves the run's core `Outcome` off `error` → `displayStatus` no longer yields `error` Status → it drops out automatically. P0 ships the predicate; the acknowledge edge is a later plan.)
  - `isBusy(status: Status): boolean` — `true` for `running | awaiting_approval`. "Occupies the agent's slot." `error` is deliberately excluded so a crashed input agent still offers START.
  - These differ ONLY on `error`: `isLive('error') === true`, `isBusy('error') === false`; identical on every other status.
- Consumes: `Status` from `./status`.

- [ ] **Step 1: Write the failing test**

Create `packages/react/src/liveness.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isLive, isBusy } from './liveness'
import { STATUSES, type Status } from './status'

describe('isLive', () => {
  it('is true for running, awaiting_approval, error', () => {
    expect(isLive('running')).toBe(true)
    expect(isLive('awaiting_approval')).toBe(true)
    expect(isLive('error')).toBe(true)
  })
  it('is false for idle and done', () => {
    expect(isLive('idle')).toBe(false)
    expect(isLive('done')).toBe(false)
  })
})

describe('isBusy', () => {
  it('is true for running and awaiting_approval', () => {
    expect(isBusy('running')).toBe(true)
    expect(isBusy('awaiting_approval')).toBe(true)
  })
  it('is false for error (a crashed agent frees its slot — START stays)', () => {
    expect(isBusy('error')).toBe(false)
  })
  it('is false for idle and done', () => {
    expect(isBusy('idle')).toBe(false)
    expect(isBusy('done')).toBe(false)
  })
})

describe('isLive vs isBusy', () => {
  it('differ ONLY on error', () => {
    const differ = (STATUSES as readonly Status[]).filter((s) => isLive(s) !== isBusy(s))
    expect(differ).toEqual(['error'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test packages/react/src/liveness.test.ts`
Expected: FAIL — `Cannot find module './liveness'` (file not created yet).

- [ ] **Step 3: Implement `liveness.ts`**

Create `packages/react/src/liveness.ts`:

```ts
import type { Status } from './status'

// SINGLE SOURCE for "live or not" (replaces pipelineModel.ACTIVE, aggregate.BUSY, and the
// inline running/awaiting set in InstancePickerModal). Two questions over the ONE Status:
// they differ ONLY on `error`.
//
//   isLive  — shown in the live UI (pipeline node, card overlay, picker, open-routing).
//             Includes `error` (per spec §1/§7: an unacknowledged crash stays visible; once the
//             acknowledge edge moves the run's Outcome off `error`, displayStatus no longer yields
//             the `error` Status and the instance recedes automatically — no separate flag).
//   isBusy  — occupies the agent's slot (the START-slot gate, the "N active" rollup count).
//             Excludes `error`: a crashed input agent has a FREE slot, so START must stay.
const LIVE: ReadonlySet<Status> = new Set(['running', 'awaiting_approval', 'error'])
const BUSY: ReadonlySet<Status> = new Set(['running', 'awaiting_approval'])

export const isLive = (status: Status): boolean => LIVE.has(status)
export const isBusy = (status: Status): boolean => BUSY.has(status)
```

- [ ] **Step 4: Export from the package index**

Open `packages/react/src/index.ts`, find where `status.ts` symbols (e.g. `Status`/`STATUSES`/`STATUS_LABEL`) or the other pure model helpers are re-exported, and add alongside them:

```ts
export { isLive, isBusy } from './liveness'
```

(If `index.ts` does not currently re-export `status`/`aggregate` symbols, add the `liveness` export in the same grouping as `aggregate`/`pipelineModel` — match the file's existing style; verify the exact insertion point before editing.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn test packages/react/src/liveness.test.ts`
Expected: PASS (all four `describe` blocks green).

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/liveness.ts packages/react/src/liveness.test.ts packages/react/src/index.ts
git commit -m "feat(react): shared isLive/isBusy predicate (single source for liveness)"
```

---

### Task 2: Migrate `pipelineModel.ts` to `isLive` (keep the tree rule)

**Files:**
- Modify: `packages/react/src/pipelineModel.ts` (delete the local `ACTIVE` set at line 46; replace its 3 uses — `shown` seed at line 67, `computeLive` at line 88, `view` at lines 99/101 — with `isLive`)
- Test: `packages/react/src/pipelineModel.test.ts` (existing suite is the regression guard; add one explicit assertion that `error` is live and `done` recedes)

**Interfaces:**
- Consumes: `isLive` from `./liveness` (Task 1).
- Produces: identical `PipelineBlock[]` output — the tree rule stays `isLive(self) || hasLiveDescendant`. `ACTIVE` and `isLive` cover the same three statuses (`running | awaiting_approval | error`), so this is a behavior-preserving swap; the value is killing the duplicate set.

- [ ] **Step 1: Add a failing/guard test for the tree rule via the shared predicate**

In `packages/react/src/pipelineModel.test.ts`, add (the existing `i(...)` factory builds a `PInstance`):

```ts
it('an errored instance stays in the pipeline; a done lone instance recedes', () => {
  const errored = buildPipeline([i({ localId: 'e1', status: 'error', isInput: true })], {})
  expect(errored).toHaveLength(1) // error is live → shown

  const doneOnly = buildPipeline([i({ localId: 'd1', status: 'done', isInput: true })], {})
  expect(doneOnly).toHaveLength(0) // done with no live descendant → recedes
})
```

- [ ] **Step 2: Run to verify the new test passes against current code (guard) and the suite is green**

Run: `yarn test packages/react/src/pipelineModel.test.ts`
Expected: PASS — current `ACTIVE` already includes `error` and excludes `done`, so this guard locks the behavior before the swap. (If it does not exist, this test additionally documents the contract.)

- [ ] **Step 3: Swap `ACTIVE` → `isLive`**

In `packages/react/src/pipelineModel.ts`:

1. Add the import at the top (next to the existing `import { PRIORITY } from './aggregate'`):

```ts
import { isLive } from './liveness'
```

2. Delete the local set (line 46):

```ts
const ACTIVE: ReadonlySet<Status> = new Set(['running', 'awaiting_approval', 'error'])
```

3. Replace its three uses:

- The `shown` seed (line 67):

```ts
  for (const x of instances) if (isLive(x.status)) shown.add(x.localId)
```

- Inside `computeLive` (line 88):

```ts
      if (isLive(kid.status) || computeLive(kid)) live = true
```

- Inside `view` (lines 99–101) — replace the two `ACTIVE.has(x.status)` checks:

```ts
  const view = (x: PInstance): PInstance =>
    isLive(x.status) || hasLiveDescendant.get(x.localId)
      ? isLive(x.status)
        ? x
        : { ...x, status: 'running' as Status }
      : x
```

(`hasLiveDescendant` here is the local `Map`, not the core helper — leave that name as-is. The `Status` import is still used by the `'running' as Status` cast, so keep it.)

- [ ] **Step 4: Run the pipeline suite to verify it still passes**

Run: `yarn test packages/react/src/pipelineModel.test.ts`
Expected: PASS — output unchanged (behavior-preserving swap).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/pipelineModel.ts packages/react/src/pipelineModel.test.ts
git commit -m "refactor(react): pipelineModel uses shared isLive; drop local ACTIVE set"
```

---

### Task 3: Migrate `aggregate.ts` to `isBusy` (the active-count question)

**Files:**
- Modify: `packages/react/src/aggregate.ts` (delete the local `BUSY` set at line 8; replace its one use in `aggregateAgent` at line 33 with `isBusy`)
- Test: `packages/react/src/aggregate.test.ts` (existing suite is the regression guard; add one assertion that an error-only agent reads 0 active — C2)

**Interfaces:**
- Consumes: `isBusy` from `./liveness` (Task 1).
- Produces: identical `AgentAggregate` — `activeCount` = count of `isBusy` instances. `BUSY` and `isBusy` cover the same two statuses (`running | awaiting_approval`); behavior-preserving swap. `PRIORITY` stays in `aggregate.ts` (a different concept — status ordering — and `pipelineModel` imports it from here).

- [ ] **Step 1: Add a guard test for C2 (error-only ⇒ 0 active)**

In `packages/react/src/aggregate.test.ts`, add (helpers `live`/`term` already defined at top):

```ts
it('an error-only agent reads 0 active (error ∉ isBusy → START stays exposed)', () => {
  const a = aggregateAgent([{ status: 'error', outcome: 'error' }])
  expect(a.activeCount).toBe(0)
  expect(aggregateLabel(a)).toBe('') // empty headline → never hides START
})
```

- [ ] **Step 2: Run to verify it passes against current code (guard)**

Run: `yarn test packages/react/src/aggregate.test.ts`
Expected: PASS — current `BUSY` already excludes `error`, so this locks the behavior before the swap.

- [ ] **Step 3: Swap `BUSY` → `isBusy`**

In `packages/react/src/aggregate.ts`:

1. Add the import at the top:

```ts
import { isBusy } from './liveness'
```

2. Delete the local set (line 8 + its comment block lines 5–8 about `error` deliberately not busy — fold that rationale away; the rationale now lives in `liveness.ts`):

```ts
// "Busy" = an instance is actively holding the agent's slot: running or awaiting a human.
// `error` is deliberately NOT busy (Unit 4.2): an agent whose only instance errored has a
// FREE slot, so START must stay available — the error shows as a badge alongside the button.
const BUSY: ReadonlySet<Status> = new Set(['running', 'awaiting_approval'])
```

3. Replace its use in `aggregateAgent` (line 33):

```ts
  const activeCount = statuses.filter((s) => isBusy(s)).length
```

(Check whether `Status` is still referenced in `aggregate.ts` after the deletion — `AgentEntry`/`AgentAggregate` and `PRIORITY: Status[]` still use it, so keep the `import type { Status }`. ESLint will flag it if it becomes unused.)

- [ ] **Step 4: Run the aggregate suite to verify it passes**

Run: `yarn test packages/react/src/aggregate.test.ts`
Expected: PASS — output unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/aggregate.ts packages/react/src/aggregate.test.ts
git commit -m "refactor(react): aggregate activeCount uses shared isBusy; drop local BUSY set"
```

---

### Task 4: Filter instance heads to `isLive` in `useBoardNavigation` (card + picker + open-routing)

This is the behavioral change that unlocks R1–R5, PK1, T1–T3, C3: the card overlay, the instance picker, and `openAgent` routing must see ONLY live instances. `aggOf` (BoardInner) and `pickerInstances` both read `instancesOf`, so filtering there propagates to all three surfaces in one place. `openRuns` (the open thread) stays UNFILTERED (spec §3 / §7 — the modal shows all runs of the instance, incl. a `done` one).

**Files:**
- Modify: `packages/react/src/hooks/useBoardNavigation.ts` (`instancesOf` at lines 71–79 — filter the head to `isLive`; leave `liveOf` as the raw per-agent slice that `instancesOf` groups; leave `openRuns` at lines 130–132 UNFILTERED)
- Test: `packages/react/src/hooks/useBoardNavigation.test.ts` (add R4/R5/PK1 cases)

**Interfaces:**
- Consumes: `isLive` from `../liveness` (Task 1); `pickHead` (existing).
- Produces: `instancesOf(agentId)` returns one head `PInstance` per key WHERE the head's status `isLive`. `openAgent` then routes by the **live** count (0 → type view, 1 → thread, ≥2 → picker); `pickerInstances` (= `instancesOf(openPickerId)`) lists only live; `aggOf` (BoardInner, unchanged) now aggregates only live heads. `openRuns` stays the full set of the OPEN item's runs (unfiltered).

Note on naming: the spec §9 says "filter heads to `isLive` in `instancesOf`/`liveOf`". In the current code the head-selection lives in `instancesOf`; `liveOf` is the raw board slice that feeds it. Filtering the produced **head** inside `instancesOf` is the correct single seam — it covers card/picker/open-routing without double-filtering. Do NOT also filter `liveOf` (the pipeline's `pInstances` does not flow through `liveOf`; `buildPipeline` runs over `pInstances` directly and keeps its own tree rule from Task 2).

- [ ] **Step 1: Write the failing tests (R4, R5, PK1)**

In `packages/react/src/hooks/useBoardNavigation.test.ts`, inside the top `describe('useBoardNavigation', …)`, add:

```ts
it('R4: a lone TERMINAL instance does not route to a dead thread — opens the type view', () => {
  items = [
    {
      id: 'a__reply#1',
      workflowId: 'a',
      agentId: 'a__reply',
      key: 'alice',
      phase: 'done',
      status: 'done',
      outcome: 'done',
      card: null,
      parentId: null,
      payload: {},
    },
  ]
  const { result } = renderHook(() => useBoardNavigation(cfg, 'a'))
  act(() => result.current.openAgent('reply'))
  expect(result.current.openTypeId).toBe('reply') // 0 LIVE instances → type view
  expect(result.current.openId).toBeNull()
  expect(result.current.openPickerId).toBeNull()
})

it('R5: [1 running, 1 done] opens the single LIVE thread, not the picker', () => {
  items = [
    {
      id: 'a__reply#1',
      workflowId: 'a',
      agentId: 'a__reply',
      key: 'alice',
      phase: 'active',
      status: 'running',
      outcome: 'running',
      card: null,
      parentId: null,
      payload: {},
    },
    {
      id: 'a__reply#2',
      workflowId: 'a',
      agentId: 'a__reply',
      key: 'bob',
      phase: 'done',
      status: 'done',
      outcome: 'done',
      card: null,
      parentId: null,
      payload: {},
    },
  ]
  const { result } = renderHook(() => useBoardNavigation(cfg, 'a'))
  act(() => result.current.openAgent('reply'))
  expect(result.current.openId).toBe('a__reply#1') // count = 1 live → its thread
  expect(result.current.openPickerId).toBeNull()
})

it('PK1: the picker lists only LIVE instances (a done instance does not appear)', () => {
  items = [
    {
      id: 'a__reply#1',
      workflowId: 'a',
      agentId: 'a__reply',
      key: 'alice',
      phase: 'active',
      status: 'running',
      outcome: 'running',
      card: null,
      parentId: null,
      payload: {},
    },
    {
      id: 'a__reply#2',
      workflowId: 'a',
      agentId: 'a__reply',
      key: 'bob',
      phase: 'active',
      status: 'awaiting_approval',
      outcome: 'running',
      card: {},
      parentId: null,
      payload: {},
    },
    {
      id: 'a__reply#3',
      workflowId: 'a',
      agentId: 'a__reply',
      key: 'carol',
      phase: 'done',
      status: 'done',
      outcome: 'done',
      card: null,
      parentId: null,
      payload: {},
    },
  ]
  const { result } = renderHook(() => useBoardNavigation(cfg, 'a'))
  act(() => result.current.openAgent('reply'))
  expect(result.current.openPickerId).toBe('reply') // 2 live instances → picker
  expect(result.current.pickerInstances).toHaveLength(2) // carol (done) excluded
  expect(result.current.pickerInstances.map((p) => p.key).sort()).toEqual(['alice', 'bob'])
})
```

(These items carry the `phase`/`outcome`/`card` fields `toPInstances` reads via the core `lifecycle()` visibility check — a `done` item with `card: null` is still board-visible for the tree/dedup, so the *new* `isLive` filter in `instancesOf` is what excludes it from the live lists. Match the field set the existing `notesFor`/`startInput` tests use.)

- [ ] **Step 2: Run to verify they fail**

Run: `yarn test packages/react/src/hooks/useBoardNavigation.test.ts -t "R4|R5|PK1"`
Expected: FAIL — current `instancesOf` does NOT filter by liveness, so R4 routes to a thread (count 1) instead of the type view, R5 opens the picker (count 2), and PK1 lists 3.

- [ ] **Step 3: Filter the head to `isLive` in `instancesOf`**

In `packages/react/src/hooks/useBoardNavigation.ts`:

1. Add the import at the top (next to `import { pickHead, type PInstance } from '../pipelineModel'`):

```ts
import { isLive } from '../liveness'
```

2. Replace `instancesOf` (lines 71–79) so the head is kept only when it is live:

```ts
  const instancesOf = (agentId: string): PInstance[] => {
    const byKey = new Map<string, PInstance[]>()
    for (const p of liveOf(agentId)) {
      const arr = byKey.get(p.key) ?? []
      arr.push(p)
      byKey.set(p.key, arr)
    }
    // One head Run per key; KEEP only instances whose head is live (running/awaiting/error).
    // A done/stopped/rejected instance recedes from the card overlay, the picker, and the
    // open-routing count — but stays in `openRuns` (the open thread is unfiltered) and in the
    // board data (tree/dedup). One source: pickHead for the head, isLive for the live filter.
    return [...byKey.values()].map(pickHead).filter((h) => isLive(h.status))
  }
```

Leave `openRuns` (lines 130–132) and `liveOf` UNCHANGED.

- [ ] **Step 4: Run to verify they pass + the existing suite is green**

Run: `yarn test packages/react/src/hooks/useBoardNavigation.test.ts`
Expected: PASS — R4/R5/PK1 green; the existing `openAgent`/`notesFor`/`startInput` cases still pass (they use `running` instances, which are live).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/useBoardNavigation.ts packages/react/src/hooks/useBoardNavigation.test.ts
git commit -m "feat(react): instancesOf keeps only live heads — card/picker/open-routing show live only"
```

---

### Task 5: Migrate `InstancePickerModal` `liveCount` to `isBusy` (PK2)

The picker header shows `{liveCount} active` over its rows. With Task 4, `pickerInstances` is already all-live, but the header's inline `running/awaiting` filter is a fourth divergent copy and the count must equal the rows shown (PK2). Use `isBusy` so the header counts the same way the card does.

**Files:**
- Modify: `packages/react/src/components/InstancePickerModal/InstancePickerModal.tsx` (replace the inline `liveCount` filter at lines 39–41 with `isBusy`)
- Test: `packages/react/src/components/InstancePickerModal/InstancePickerModal.test.tsx` (new — assert the header count equals the busy rows)

**Interfaces:**
- Consumes: `isBusy` from `../../liveness` (Task 1).
- Produces: header `liveCount` = count of rows whose status `isBusy`. (After Task 4 the picker only receives live instances, so an `error` row could appear; `isBusy` excludes it from the "active" count — matching the card's `activeCount` semantics. PK2's "header equals rows" is satisfied for the running/awaiting case the spec asserts; an errored row is shown but not "active", consistent with the aggregate.)

- [ ] **Step 1: Write the failing test**

Create `packages/react/src/components/InstancePickerModal/InstancePickerModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InstancePickerModal } from './InstancePickerModal'

describe('InstancePickerModal', () => {
  it('PK2: header active count equals the busy rows (running + awaiting)', () => {
    render(
      <InstancePickerModal
        title='Reply'
        iconName='inbox'
        instances={[
          { localId: '1', label: 'Alice', name: 'Reply', status: 'running', outcome: 'running' },
          {
            localId: '2',
            label: 'Bob',
            name: 'Reply',
            status: 'awaiting_approval',
            outcome: 'running',
          },
        ]}
        onOpenInstance={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('2 active')).toBeInTheDocument()
  })
})
```

(If the project lacks a jsdom setup default for `*.test.tsx` here, mirror the harness of an existing component test such as `AgentCard`/`AgentModal` tests — verify how they import `render`/`screen` and any `@testing-library/jest-dom` matcher import before writing.)

- [ ] **Step 2: Run to verify it passes against current code (guard) — then confirm via the swap**

Run: `yarn test packages/react/src/components/InstancePickerModal/InstancePickerModal.test.tsx`
Expected: PASS against the current inline filter (running+awaiting = 2) — this guards the count semantics so the swap to `isBusy` (same two statuses) stays behavior-preserving.

- [ ] **Step 3: Swap the inline filter → `isBusy`**

In `packages/react/src/components/InstancePickerModal/InstancePickerModal.tsx`:

1. Add the import (next to the other `../../` imports):

```ts
import { isBusy } from '../../liveness'
```

2. Replace `liveCount` (lines 39–41):

```ts
  // "Active" = busy (running / awaiting approval). Shared isBusy — one source with the card
  // aggregate, so the header never disagrees with the count the type card shows.
  const liveCount = instances.filter((i) => isBusy(i.status)).length
```

- [ ] **Step 4: Run to verify it passes**

Run: `yarn test packages/react/src/components/InstancePickerModal/InstancePickerModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/components/InstancePickerModal/InstancePickerModal.tsx packages/react/src/components/InstancePickerModal/InstancePickerModal.test.tsx
git commit -m "refactor(react): picker liveCount uses shared isBusy (one source with the card)"
```

---

### Task 6: Verify consumers, dead-set scan, green gate, lib build

**Files:** none (verification + a final scan only).

- [ ] **Step 1: Confirm the three local sets are gone (single-source invariant)**

Run: `git grep -nE "new Set\(\[.*(running|awaiting_approval|error)" packages/react/src`
Expected: the ONLY remaining match is in `packages/react/src/liveness.ts` (`LIVE`/`BUSY`). No `ACTIVE` in `pipelineModel.ts`, no `BUSY` in `aggregate.ts`, no inline filter in `InstancePickerModal.tsx`. If anything else matches, migrate it to `isLive`/`isBusy`.

Also confirm `BoardInner.tsx` `aggOf` is unchanged and correct: it calls `aggregateAgent(nav.instancesOf(agentId)...)` — `instancesOf` is now live-filtered (Task 4) and `aggregateAgent` uses `isBusy` (Task 3), so the card overlay (C2/C3/C6) follows automatically with NO app edit.

Run: `git grep -n "aggOf\|instancesOf" apps/inbox/client/src/BoardApp/BoardInner.tsx`
Expected: `aggOf` still reads `nav.instancesOf(...)`; no change needed.

- [ ] **Step 2: Verify the AgentCard consumer needs no change**

Run: `git grep -nE "running|awaiting_approval|error" packages/react/src/components/AgentCard/AgentCard.tsx`
Expected: `AgentCard` consumes the precomputed `AgentAggregate` (`activeCount`/`status`/`outcome`) — it should NOT re-derive liveness. If it does (an inline status set), migrate it to `isLive`/`isBusy` in this task and add a guard test. (Spec §9 lists AgentCard as "re-verify", not necessarily edit.)

- [ ] **Step 3: Full green gate from repo root**

Run: `yarn typecheck && yarn test && yarn lint && yarn format:check`
Expected: all PASS. Fix any fallout (an orphaned `import type { Status }` after a deletion → ESLint flags it; remove only if truly unused).

- [ ] **Step 4: Build the react library (CSS + rolled-up types)**

Run: `yarn workspace @atizar/react build`
Expected: clean build — `isLive`/`isBusy` are in the rolled-up `.d.ts` (they were added to `index.ts` in Task 1).

- [ ] **Step 5: Browser-verify the live-list surfaces (per `always-run-browser-e2e`)**

Invoke the `browser-verify` skill. Start `yarn dev`, run a sorter scan, drive a reply to `done`/`stopped`, and confirm against the e2e cases this plan unlocks:
- **R4/R1:** open a worker whose only instance is terminal → descriptive type-view, not a dead thread.
- **R5:** an agent with [1 running, 1 done] opens the single live thread (no picker).
- **PK1/PK2:** with ≥2 instances incl. a terminal one, the picker lists only the live rows and the header `N active` equals the rows.
- **C2/C3:** the card overlay count drops the terminal instances; a worker with only terminal instances reads idle/ready, not "Done"/"Stopped".
- **P3/P6 (regression):** an errored instance still shows in the pipeline (red); a done parent with a live child stays "Working".

(Use `DEV_RECORD_REPLAY=1` for deterministic replays; the concurrent-HITL `record` caveat does not apply to these single-instance assertions.)

- [ ] **Step 6: Final commit (if verification produced fixes)**

```bash
git add -p
git commit -m "test: verify single isLive migration across card/picker/pipeline (green gate + browser)"
```

---

## Self-Review

- **Spec coverage (P0):** the single `isLive`/`isBusy` keystone (Task 1, TDD, the exact contract 5 downstream plans depend on); `pipelineModel.ACTIVE` → `isLive`, tree rule `isLive(self) || hasLiveDescendant` preserved (Task 2); `aggregate.BUSY` → `isBusy` for `activeCount` (Task 3); `useBoardNavigation.instancesOf` filters heads to `isLive` so card + picker + open-routing show live only, `openRuns` left unfiltered (Task 4); the picker's inline `liveCount` set → `isBusy` (Task 5, the fourth divergent copy the spec didn't name but exists); consumer re-verify + dead-set scan + green gate + lib build + browser-verify (Task 6). This unlocks e2e cases **C2, C3, R1–R5, PK1, PK2, T1–T3** at the model level (the linger/fade timing of P7/T1–T3 and the `error` acknowledge of T4/PK3/A1–A4 are explicitly LATER plans, not P0).
- **`boardModel.toPInstances` untouched (confirmed):** it keeps filtering by core `isVisible` (board membership for the tree/dedup walk); `isLive` is layered on top in `useBoardNavigation` as the LIVE-list filter. No core lifecycle change → `check-foundation` not required (stated in Global Constraints).
- **Single-source invariant honored:** after this plan there is exactly ONE `isLive` and ONE `isBusy`; Task 6 Step 1 is an explicit grep that the three (four) local sets are gone. `PRIORITY`/`pickHead` (status ordering, a separate concept) intentionally stay in `aggregate.ts`/`pipelineModel.ts`.
- **Type consistency:** `isLive`/`isBusy` (Task 1) are the exact symbols imported in Tasks 2 (`pipelineModel`), 3 (`aggregate`), 4 (`useBoardNavigation`), 5 (`InstancePickerModal`) and exported from `index.ts` for the lib build. All operate on the client `Status` union from `status.ts`; the spec's stopped/rejected/dismissed are core `Outcome`s already collapsed into the `done`/`error` `Status` lane by `displayStatus`, so no new `Status` member is needed in P0.
- **Behavior-preserving swaps vs the one behavioral change:** Tasks 2/3/5 are pure refactors (identical status sets, output unchanged — guarded by adding-then-keeping the suite green); Task 4 is the ONE behavioral change (terminal heads recede from the live lists) and carries new failing-first tests R4/R5/PK1.
- **Placeholder scan:** the only "adapt to existing harness" notes are in Task 5 Step 1 (jsdom/jest-dom import style) and the field set of Task 4's items — those are harness-matching against verified existing test files (`useBoardNavigation.test.ts`, the component test suites), not logic placeholders. Every production edit (`liveness.ts`, the three swaps, the `instancesOf` filter) is concrete real code with exact line references verified against the current source.
