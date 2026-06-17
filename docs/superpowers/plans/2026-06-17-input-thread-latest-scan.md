# Input Thread = Latest Scan Only — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The input agent's (sorter's) open thread renders **only the latest scan's content** — one INBOX SORTED card — never the stacked history of every prior scan. Older scans that are kept alive server-side to host their live descendants (reply drafts awaiting approval) contribute their children to the pipeline tree / the child agents' cards, **not** a repeated scan card in the sorter thread.

**Architecture:** The bug is a presentation artifact, not a state bug. The input agent has a **CONSTANT instance key** (`apps/inbox/server/index.ts:25-34` — `instanceKeyOf` returns the bare `agentId` for the sorter), so every scan run collapses into one instance `(agentId, key)`. On re-START, the server deliberately **does not supersede** a finished prior scan that still has a live descendant — superseding the root would orphan the children (`packages/server/src/pipelineService.ts:295-302`, the `if (liveAnc.has(root.id)) continue` branch). So those older scan roots survive on the board, all share the constant key, and `openRuns` (`packages/react/src/hooks/useBoardNavigation.ts:130-132`) returns **all** of them — `InstanceView` (`apps/inbox/client/src/BoardApp/BoardInner.tsx:129-132`) renders one sub-thread per run, producing the stacked "3 runs / 3 INBOX SORTED cards" the screenshots show.

The fix is **client-side and role-aware**, with **zero server change**: the board snapshot is already returned in **creation order** (`packages/server/src/stateStore.ts:101` — `orderBy(asc(workItems.createdAt))`; `getBoard` only `.filter()`s, and `toPInstances` only `.filter().map()`s — all order-preserving), so among an input agent's scan-root runs the **last** element of `openRuns` is the **latest scan**. A new pure helper `latestScanRuns(runs, isInput)` returns only that last run for an input agent, and **all runs unchanged** for a worker agent (a worker instance's several runs = a sender's several drafts, which MUST all show). `useBoardNavigation` wires the helper into `openRuns` using the existing `roleOf`/`canStart` (`roleOf(agentId) === 'input'`).

**Deeper alternative (noted, NOT chosen for the beta).** The cleaner end-state is to **re-parent** the live children onto the new scan root at supersede time (in `pipelineService.ts:295-307`) — then the old scan is always superseded, the children are preserved under the fresh scan, and nothing ever stacks (no special read-side rule needed). That touches the **server supersede path** (and the locked lifecycle/transition seam → `check-foundation`), and is more work + more risk for the beta. Deferred. This plan changes **only the DISPLAY** of the input thread; the server supersede logic (keep-finished-scan-with-live-descendants) is left **exactly as-is**, so S4/S5 stay intact.

**Tech Stack:** TypeScript, Vitest, React + Testing Library, `@atizar/react` (Vite library build).

## Global Constraints

> **READ FIRST — two standing rules for whoever implements this (the reason this whole plan set exists). Hold them on EVERY task:**
> 1. **Always think about the framework/app boundary.** Before placing any non-trivial code, ask: generic *mechanism* every workflow needs (→ `@atizar/*`) or *one workflow's policy* (→ `apps/inbox/...`)? A framework symbol carries ZERO workflow knowledge — no `reply/reader/spam/email/ticket` literals. "Input vs worker" is the generic `role` flag, NOT an agent-id check. Unsure → default to the app. Don't let the two get confused.
> 2. **Never multiply sources of truth.** One derivation per concept (liveness, status, priority, counts). Reuse the existing predicate/classifier; a new question is asked OF the one status, never a forked new set.

- **TDD:** no production code without a failing test first. Watch each test fail, then pass.
- **Framework/app boundary (I5):** the helper + the wiring live in `@atizar/react` and carry **zero** workflow knowledge — no `sorter`/`email`/`reply` literal. "Input vs worker" is the existing generic `role` flag (`roleOf` / `PInstance.isInput`), not an agent-id check. The email-inbox literals stay in `apps/inbox/server/index.ts` (`instanceKeyOf`) — untouched.
- **No server change (beta path).** The server supersede logic (`pipelineService.ts:295-302` keep-finished-scan-with-live-descendants) is NOT modified. The deeper re-parent alternative is explicitly deferred (see Architecture).
- **Worker path is provably unchanged.** A worker instance's multiple runs (a sender's drafts) MUST all keep rendering — asserted directly in the unit test.
- **Order source of truth:** rely on the existing creation-order board snapshot (`stateStore.ts:101`). The helper does NOT re-sort; it trusts the input order and picks the last element. (If a future change reorders the board, that test guards it.)
- **Green gate before "done":** `yarn typecheck && yarn test && yarn lint && yarn format:check` from repo root, plus `yarn workspace @atizar/react build` (any `@atizar/react` source change).
- **`check-foundation`:** **NOT required** for this plan. The beta path is **client-only presentation** in `@atizar/react`; it does not touch actions, providers, `@atizar/core`, the framework/userland boundary, or `PHILOSOPHY.md`/`ARCHITECTURE.md`. (It WOULD be required for the deferred re-parent alternative, which edits the server supersede/transition path — out of scope here.)

---

### Task 1: React — pure `latestScanRuns` selector (role-aware)

**Files:**
- Create: `packages/react/src/latestScanRuns.ts`
- Modify: `packages/react/src/index.ts` (export the helper — verify the package's public barrel; if `latestScanRuns` is purely internal to `useBoardNavigation`, the export can be skipped, but export it so it is unit-test-importable and reusable)
- Test: `packages/react/src/latestScanRuns.test.ts`

**Interfaces:**
- Produces: `latestScanRuns(runs: PInstance[], isInput: boolean): PInstance[]` — pure. `runs` is the board-ordered (creation-order) slice of one instance's runs (same `agentId` + `key`). For `isInput === true` returns `runs.length ? [runs[runs.length - 1]] : []` (the latest scan only). For `isInput === false` returns `runs` unchanged (worker: all drafts show). Empty input → `[]` for both.
- Consumes: `PInstance` from `./pipelineModel.js`.

- [ ] **Step 1: Write the failing test**

Create `packages/react/src/latestScanRuns.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { latestScanRuns } from './latestScanRuns.js'
import type { PInstance } from './pipelineModel'

// Minimal PInstance fixture — only the fields the selector reads (localId) plus the
// type-required ones. Board order is creation order: oldest first, newest LAST.
const run = (localId: string, over: Partial<PInstance> = {}): PInstance => ({
  localId,
  runtimeKey: 'a__sorter',
  agentId: 'sorter',
  key: 'sorter', // constant key → all scans collapse into one instance
  name: 'Sorter',
  iconName: 'inbox',
  label: 'INBOX SORTED',
  status: 'done',
  outcome: 'done',
  isInput: true,
  ...over,
})

describe('latestScanRuns', () => {
  it('input agent: returns only the LATEST scan (last in board/creation order)', () => {
    const runs = [run('scan-1'), run('scan-2'), run('scan-3')] // 3 stacked scans
    expect(latestScanRuns(runs, true).map((r) => r.localId)).toEqual(['scan-3'])
  })

  it('input agent with a single scan: returns that scan', () => {
    const runs = [run('scan-1')]
    expect(latestScanRuns(runs, true).map((r) => r.localId)).toEqual(['scan-1'])
  })

  it('worker agent: returns ALL runs unchanged (a sender keeps every draft)', () => {
    const drafts = [
      run('draft-1', { agentId: 'reply', key: 'alice', isInput: false }),
      run('draft-2', { agentId: 'reply', key: 'alice', isInput: false }),
    ]
    expect(latestScanRuns(drafts, false)).toBe(drafts) // same reference, not narrowed
    expect(latestScanRuns(drafts, false).map((r) => r.localId)).toEqual(['draft-1', 'draft-2'])
  })

  it('empty input: returns [] for both roles', () => {
    expect(latestScanRuns([], true)).toEqual([])
    expect(latestScanRuns([], false)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test packages/react/src/latestScanRuns.test.ts`
Expected: FAIL — `Cannot find module './latestScanRuns.js'`.

- [ ] **Step 3: Implement the selector**

Create `packages/react/src/latestScanRuns.ts`:

```ts
import type { PInstance } from './pipelineModel'

// An INPUT agent has a CONSTANT instance key, so every scan run collapses into one instance
// (same agentId + key). On re-START the server keeps a finished prior scan that still has live
// descendants (it would otherwise orphan the children — pipelineService.ts:295-302), so older
// scan roots survive on the board and the open thread would stack one sub-thread per scan.
//
// The board snapshot is creation-ordered (stateStore.ts: orderBy created_at ASC) and every
// transform downstream (getBoard filter, toPInstances filter/map) preserves order, so the LAST
// element of an input instance's runs IS the latest scan. Render only that one in the input
// thread; the older kept-for-children scans still host their children in the pipeline tree / the
// child agents' cards — they just stop drawing a repeated scan card in the sorter thread.
//
// A WORKER instance's several runs are a sender's several drafts — all must keep showing, so the
// worker path returns the runs unchanged. Pure + role-driven (the generic `isInput` flag), no
// workflow literals (I5).
export function latestScanRuns(runs: PInstance[], isInput: boolean): PInstance[] {
  if (!isInput) return runs
  return runs.length ? [runs[runs.length - 1]] : []
}
```

- [ ] **Step 4: Export from the package barrel**

In `packages/react/src/index.ts` add (place it with the other model/util exports; verify the surrounding export style in the file first):

```ts
export { latestScanRuns } from './latestScanRuns'
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn test packages/react/src/latestScanRuns.test.ts`
Expected: PASS (all 4 cases green).

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/latestScanRuns.ts packages/react/src/latestScanRuns.test.ts packages/react/src/index.ts
git commit -m "feat(react): pure latestScanRuns selector — input thread shows only the latest scan"
```

---

### Task 2: React — wire `latestScanRuns` into `openRuns` (input thread = latest scan)

**Files:**
- Modify: `packages/react/src/hooks/useBoardNavigation.ts:130-133` (apply the selector to `openRuns`)
- Test: `packages/react/src/hooks/useBoardNavigation.test.ts` (add an input-stacked-scans case + a worker regression case)

**Interfaces:**
- Consumes: `latestScanRuns` (Task 1); the existing `roleOf` from `lookups` (returns `'input' | 'worker' | undefined`) and the existing per-run filter (`p.agentId === stripAgent(openItem) && p.key === openItem.key`).
- Produces: `openRuns` for an INPUT open item = only the latest scan run; for a WORKER open item = all of its instance's runs (unchanged). `openHead`/`onStop` continue to derive from `openRuns` (now the latest scan for an input — the correct head to represent / stop).

- [ ] **Step 1: Write the failing hook tests**

In `packages/react/src/hooks/useBoardNavigation.test.ts`, add (match the file's existing `items`-mock harness — `qualifier` is the workflow `a` **input** agent, `reply` is the worker; set `open` via `setOpenId`):

```ts
it('INPUT open item: openRuns returns ONLY the latest scan (last by board order), not the stack', () => {
  // Three scan roots sharing the input agent's CONSTANT key — board/creation order is array order.
  items = [
    { id: 'scan-1', workflowId: 'a', agentId: 'a__qualifier', key: 'qualifier', status: 'done', payload: {} },
    { id: 'scan-2', workflowId: 'a', agentId: 'a__qualifier', key: 'qualifier', status: 'done', payload: {} },
    { id: 'scan-3', workflowId: 'a', agentId: 'a__qualifier', key: 'qualifier', status: 'running', payload: {} },
  ]
  const { result } = renderHook(() => useBoardNavigation(cfg, 'a'))
  act(() => result.current.setOpenId('scan-1')) // open via ANY of the instance's runs
  // Only the latest scan root is rendered in the input thread (no stacking).
  expect(result.current.openRuns.map((r) => r.localId)).toEqual(['scan-3'])
})

it('WORKER open item: openRuns keeps ALL of the instance runs (a sender keeps every draft)', () => {
  items = [
    { id: 'd1', workflowId: 'a', agentId: 'a__reply', key: 'alice', status: 'awaiting_approval', payload: {} },
    { id: 'd2', workflowId: 'a', agentId: 'a__reply', key: 'alice', status: 'running', payload: {} },
  ]
  const { result } = renderHook(() => useBoardNavigation(cfg, 'a'))
  act(() => result.current.setOpenId('d1'))
  expect(result.current.openRuns.map((r) => r.localId).sort()).toEqual(['d1', 'd2'])
})
```

(Use the same `status`/`payload`-shaped `items` the existing tests use; `toPInstances` maps `phase`/`outcome` via `displayStatus` — if the existing fixtures already carry `phase`/`outcome` instead of `status`, copy that exact field set from a neighbouring test in the file so the items pass the `isVisible` filter. Verify against the live test file before writing.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn test packages/react/src/hooks/useBoardNavigation.test.ts -t "openRuns"`
Expected: the INPUT case FAILS — `openRuns` currently returns `['scan-1','scan-2','scan-3']` (all three stacked). The WORKER case should already pass (regression guard) — confirm it does so it cannot silently break.

- [ ] **Step 3: Apply the selector in `openRuns`**

In `packages/react/src/hooks/useBoardNavigation.ts`, import the helper at the top:

```ts
import { latestScanRuns } from '../latestScanRuns'
```

Replace the `openRuns` derivation (currently lines 130-132):

```ts
  const openRuns: PInstance[] = openItem
    ? pInstances.filter((p) => p.agentId === stripAgent(openItem) && p.key === openItem.key)
    : []
```

with the role-aware version (reuse the existing `roleOf`; the input thread shows only the latest scan, the worker thread keeps every run):

```ts
  // All visible Runs of the OPEN item's instance (same agentId + key), in board/creation order.
  // For an INPUT agent (constant key → every scan collapses into one instance) the open thread
  // renders ONLY the latest scan — older kept-for-children scans host their children in the
  // pipeline tree, not as a repeated scan card here (see latestScanRuns). A WORKER keeps all of
  // its runs (a sender's several drafts). openHead/onStop derive from this — the latest scan is
  // the correct head to represent and to stop.
  const openRuns: PInstance[] = openItem
    ? latestScanRuns(
        pInstances.filter((p) => p.agentId === stripAgent(openItem) && p.key === openItem.key),
        roleOf(stripAgent(openItem)) === 'input'
      )
    : []
```

(`stripAgent(openItem)` is the bare agent id `roleOf` expects — same call already used on the line. Verify `stripAgent` returns the bare id for a `WorkItem` input, matching `roleOf`'s key space; it is already paired this way in the existing filter.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn test packages/react/src/hooks/useBoardNavigation.test.ts -t "openRuns"`
Expected: both PASS (input = latest only; worker = all).

- [ ] **Step 5: Run the full hook suite (no regression)**

Run: `yarn test packages/react/src/hooks/useBoardNavigation.test.ts`
Expected: all PASS (the existing `openAgent`/instance-count/`notesFor` cases still green — `openRuns` is the only changed derivation).

- [ ] **Step 6: Build the react lib + commit**

```bash
yarn workspace @atizar/react build
git add packages/react/src/hooks/useBoardNavigation.ts packages/react/src/hooks/useBoardNavigation.test.ts
git commit -m "fix(react): input thread renders only the latest scan, not the kept-for-children stack"
```

---

### Task 3: Green gate

**Files:** none (verification only).

- [ ] **Step 1: Full green gate from repo root**

Run: `yarn typecheck && yarn test && yarn lint && yarn format:check`
Expected: all PASS. Fix any fallout before proceeding.

- [ ] **Step 2: React lib build (CSS/types — re-run after the gate)**

Run: `yarn workspace @atizar/react build`
Expected: clean build (ESM + `.d.ts` + `react.css`), no type errors on the new export.

- [ ] **Step 3: check-foundation — explicitly NOT required**

State in the commit / PR notes: this change is **client-only presentation** in `@atizar/react` (a pure selector + a read-side wiring). It does not touch actions, providers, `@atizar/core`, the framework/userland boundary, or `PHILOSOPHY.md`/`ARCHITECTURE.md`, and it does NOT modify the server supersede logic. Per the `check-foundation` trigger rule, the skill is **not invoked** for this plan. (It WOULD be required for the deferred re-parent alternative, which edits the server supersede/transition path.)

---

### Task 4: Browser-verify S3 (re-scan with pending drafts → one scan card)

**Files:** none (verification only).

This covers case **S3** from `docs/superpowers/specs/2026-06-17-agent-view-e2e-cases.md` (🎯): "re-START with prior reply drafts still awaiting approval → the input thread shows **only the latest scan's content**, not multiple INBOX SORTED cards." It also confirms **S4** stays intact (the kept child drafts remain reachable).

- [ ] **Step 1: Invoke the `browser-verify` skill**

Follow `browser-verify` for dev-server hygiene (free `:4000`/`:5173`, recover the Playwright-MCP profile lock). Start the stack. Use `DEV_RECORD_REPLAY=1` for a deterministic replay if a cassette exists; use `DEV_RECORD_REPLAY=record` once to capture a scan→draft→re-scan scenario if none does.

- [ ] **Step 2: Drive the S3 flow**

1. Open the sorter (input) agent and run a **first scan** → it dispatches at least one reply draft that reaches **awaiting approval** (leave it unapproved so the scan root is kept-for-children server-side).
2. Re-**START** the sorter (a second scan) while that draft is still awaiting approval.
3. Open the sorter agent's thread.

- [ ] **Step 3: Assert the fix (S3) and that S4 holds**

- **S3:** the sorter thread header shows **one run** and **one** INBOX SORTED card (the latest scan) — NOT "3 runs" / multiple stacked scan cards (the screenshot bug). (Keep dev mode OFF — `localStorage['aiw.dev']` unset — for the consumer-surface assertion.)
- **S4 (regression):** the prior reply draft is still reachable — it appears in the **pipeline tree** / the reply agent's card and can still be approved; the re-scan did NOT orphan it. (The server kept the old scan root; only its DISPLAY in the sorter thread changed.)
- Take a screenshot of the sorter thread (one scan card) for the PR.

- [ ] **Step 4: Final commit (only if verification produced fixes)**

```bash
git add -p
git commit -m "test: verify input thread shows only the latest scan (S3, S4 intact)"
```

---

## Self-Review

- **Spec coverage:** implements `2026-06-17-agent-view-lifecycle-presentation.md` §3 "Input agent — thread shows the LATEST scan only" via the **quick beta path** the spec names ("Quick path for the beta: thread = latest scan"); turns E2E case **S3** green (Task 4) while keeping **S4/S5** green (server supersede logic untouched — the kept-for-children scan still survives, only its sorter-thread display changes).
- **Deeper alternative deferred, not hidden:** the re-parent-children-on-supersede option (edit `pipelineService.ts:295-307`) is documented in the Architecture intro as the cleaner end-state and explicitly deferred (more work + the locked server supersede/transition seam + `check-foundation`).
- **Why "last in `openRuns`" = latest scan:** traced end-to-end — `stateStore.ts:101` orders the snapshot `created_at ASC`; `pipelineService.getBoard` only `.filter()`s (`pipelineService.ts:564`); `boardModel.toPInstances` only `.filter().map()`s — all order-preserving — so the last element of an input instance's runs is the newest scan. A re-sort upstream would be caught by the Task 1 ordering-dependent test + the Task 2 input case. No new field on `WorkItem`/`PInstance` (work-item id is `randomUUID()`, NOT temporally sortable — so creation order is the only valid signal, and it is already present).
- **Worker path proven unchanged:** Task 1 asserts `latestScanRuns(drafts, false) === drafts` (same reference, all ids); Task 2 asserts a worker open item keeps both draft runs. A sender's multiple drafts cannot regress.
- **Boundary (I5):** the helper + wiring are framework-generic in `@atizar/react`; "input vs worker" is the existing `roleOf`/`isInput` flag, never an agent-id literal. The email-inbox `instanceKeyOf` (the constant-key cause) stays in `apps/inbox/server/index.ts`, untouched.
- **No server change / check-foundation:** beta path is client-only presentation; `check-foundation` is correctly skipped (Task 3 Step 3 records the reasoning). The server supersede branch (`pipelineService.ts:295-302`) is left exactly as-is.
- **Type consistency:** `latestScanRuns(runs: PInstance[], isInput: boolean): PInstance[]` (Task 1) is the exact symbol + signature imported and called in Task 2; both use the live `PInstance` shape from `pipelineModel.ts`.
- **Green gate + build:** `yarn typecheck && yarn test && yarn lint && yarn format:check` + `yarn workspace @atizar/react build` (Task 3); browser-verify S3 with S4 cross-check (Task 4).
