# Episode Scoping (keyed-instance current episode) — Spec + Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **HAND-OFF NOTE:** This is a standalone, self-contained doc. It can be implemented by a fresh agent with no prior context. It **supersedes** the special-case plan `2026-06-17-input-thread-latest-scan.md` — see "Relationship to other plans" below. Implement this AFTER the current in-flight work (single-isLive / input-thread / error-acknowledge) lands, then fold the input special-case into the generic mechanism here.

**Goal:** A long-lived **keyed instance** (e.g. reply keyed by sender, an input agent keyed by a constant) shows in its open thread only the runs of its **current live episode**, never its all-time run history. Once an instance went fully terminal and **receded**, those runs do NOT resurrect when a new run later reactivates the same key.

**Architecture (server-authoritative, framework-generic):** introduce **`episodeSeq`** — an integer stamped on each Run at the dispatch chokepoint. At dispatch, the server already knows whether the instance is currently live (it computes covers/live there). Rule: if any existing run of the same `(workflowId, agentId, key)` is server-`isLive`, the new run **inherits** the max `episodeSeq` (it joins the current episode); otherwise (no live sibling — empty or all-terminal/receded) it gets `max + 1` (a fresh episode). The client `openRuns` then filters an instance's runs to `episodeSeq === max`. One source of truth (the server stamp); the client only reads `max`.

**Tech Stack:** TypeScript, Vitest, Postgres (PGlite in tests; skip if unreachable), Drizzle, `@atizar/core` lifecycle, `@atizar/server`, `@atizar/react`.

## Global Constraints

> **READ FIRST — two standing rules for whoever implements this (the reason this whole plan set exists). Hold them on EVERY task:**
> 1. **Always think about the framework/app boundary.** This whole mechanism is **generic** (`@atizar/*`) — it carries ZERO workflow knowledge (no `reply/reader/spam/email/ticket/sender` literals). `episodeSeq` keys on the generic `(workflowId, agentId, key)`; the app supplies `key` via `instanceKeyOf` (untouched). Unsure → default to the app.
> 2. **Never multiply sources of truth.** Episode membership is decided ONCE (the server stamp at dispatch). The client does NOT recompute it — it reads `max(episodeSeq)`. Do not add a second/parallel "which episode" computation.

- **Server-authoritative (I8):** the episode boundary is decided where the server already knows live-vs-receded (the dispatch chokepoint). The client is a pure reader.
- **TDD:** no production code without a failing test first. Watch it fail, then pass.
- **Green gate before "done":** `yarn typecheck && yarn test && yarn lint && yarn format:check` from repo root + `yarn workspace @atizar/react build` for the react change. Server tests use PGlite (skip if unreachable).
- **Run `check-foundation`** before the final commit — it touches the dispatch chokepoint + adds a `work_items` column (server state). It does NOT touch the locked I12 phase/outcome alphabet (`episodeSeq` is a plain integer, not a lifecycle value), so expect a Clear verdict, but run it because the dispatch chokepoint is foundation-adjacent.

---

## Why this exists (the two bugs it unifies)

Both observed bugs are the SAME problem — "a keyed instance shows its all-time run history instead of its current episode":

1. **Input agent stacks scans.** Re-START with prior reply drafts still pending → the sorter (constant key) accumulates scan runs; the open thread renders 3 stacked INBOX-SORTED cards. (Today's `input-thread-latest-scan` plan patches this with an input-only "show last run" heuristic.)
2. **Reply resurrects old drafts.** Reply is keyed by sender. Two drafts done → instance recedes (can't reopen). A new email from the same sender reactivates the instance → the open thread would show the two old `done` drafts + the new run. Old runs you couldn't open a moment ago suddenly reappear.

Episode-scoping fixes both with one generic rule. The "latest scan = last run" heuristic is just the special case where an input agent's episode is a single run.

### The two cases episode-scoping must distinguish (this is the crux)

- **Same episode → KEEP the done run.** Within one continuous live span: a draft finishes (`done`, "draft saved") while a sibling run is still live. The instance never fully receded → both share one `episodeSeq` → both show.
- **Different episode → DON'T resurrect.** The instance went fully terminal and receded, then a new run reactivated the key later → the new run gets a higher `episodeSeq` → the old `done` runs are a prior episode and are hidden.

The distinguishing fact = "was there a moment with no live run for this key between them" — exactly what the dispatch-time `anyLive` check captures.

---

## Relationship to other plans

- **Supersedes `2026-06-17-input-thread-latest-scan.md`.** That plan's `latestScanRuns(runs, isInput)` input-only heuristic becomes redundant. Task 4 here removes it and routes BOTH input and worker `openRuns` through the generic episode filter. If `input-thread-latest-scan` already shipped, Task 4 deletes its helper + wiring; if not, skip it and implement only this.
- **Composes with `single-islive-migration` (P0).** The episode filter is layered on the live-list filtering; it does not replace `isLive`. The server `anyLive` check uses the SERVER classifier `lifecycle().isLive`, not the client predicate.
- **Independent of** color-recolor, completion-animation, resume-three-modes, error-acknowledge.

---

### Task 1: Schema + server — stamp `episodeSeq` at the dispatch chokepoint

**Files:**
- Modify: `packages/server/src/db/schema.ts:54-` (add the column to `workItems`)
- Modify: `packages/server/src/dispatch.ts:55-105` (compute + insert `episodeSeq`)
- Test: `packages/server/src/dispatch.test.ts` (or the file holding chokepoint tests)

**Interfaces:**
- Produces: `work_items.episode_seq` (integer, not null, default 1); every inserted Run carries an `episodeSeq`. `DispatchResult` is unchanged.
- Consumes: `lifecycle` from `@atizar/core` (already imported in `dispatch.ts:3`).

- [ ] **Step 1: Add the column to the schema**

In `packages/server/src/db/schema.ts`, inside `workItems` (after `key`), add:

```ts
  // Episode = a contiguous live span of a keyed instance. Stamped at dispatch: a new run inherits
  // the max episodeSeq of its (workflowId, agentId, key) siblings if any is still live, else max+1
  // (a fresh episode after the instance fully receded). The open thread shows only the latest episode
  // so a reactivated keyed instance does NOT resurrect a prior episode's done runs.
  episodeSeq: integer('episode_seq').notNull().default(1),
```

(`integer` is already imported at `schema.ts:3`.)

- [ ] **Step 2: Write the failing dispatch test**

In `packages/server/src/dispatch.test.ts` add (adapt to the file's existing `dispatch(db, pool, input)` harness + helpers):

```ts
it('stamps episodeSeq: first run = 1, live sibling inherits, fully-receded restart bumps', async () => {
  const base = { workflowId: 'wf', agentId: 'reply', origin: 'agent' as const, key: 'sender@x.com', maxInstances: 2, payload: {} }

  // first run for the key → episode 1
  const a = await dispatch(db, pool, { ...base, source: 'email:1' })
  expect(await episodeOf(db, a.id)).toBe(1)

  // a SECOND run while the first is still live (queued/active) → same episode
  const b = await dispatch(db, pool, { ...base, source: 'email:2' })
  expect(await episodeOf(db, b.id)).toBe(1)

  // drive BOTH to terminal (instance fully receded)
  await settleTerminal(db, a.id) // done
  await settleTerminal(db, b.id) // done

  // a NEW run after full recede → fresh episode 2
  const c = await dispatch(db, pool, { ...base, source: 'email:3' })
  expect(await episodeOf(db, c.id)).toBe(2)
})
```

Add the tiny helpers if absent: `episodeOf(db,id)` selects `episode_seq` for `id`; `settleTerminal(db,id)` sets `phase:'terminal', outcome:'done'` (or use the file's existing settle helper).

- [ ] **Step 3: Run to verify it fails**

Run: `yarn test packages/server/src/dispatch.test.ts -t "stamps episodeSeq"`
Expected: FAIL — `episode_seq` is always the default `1` (no compute logic yet), so the third assertion (`2`) fails.

- [ ] **Step 4: Compute `episodeSeq` before insert**

In `packages/server/src/dispatch.ts`, between the depth cap (step 2, ~line 77) and the insert (step 3, ~line 80), add:

```ts
  // Episode boundary (server-authoritative): inherit the current episode if a sibling of this
  // (workflowId, agentId, key) is still live, else start a fresh episode (max+1). A keyed instance
  // that fully receded and reactivates thus starts a new episode — its prior done runs do not
  // resurrect in the open thread.
  const siblings = await db
    .select({ episodeSeq: workItems.episodeSeq, phase: workItems.phase, outcome: workItems.outcome })
    .from(workItems)
    .where(and(eq(workItems.workflowId, input.workflowId), eq(workItems.agentId, input.agentId), eq(workItems.key, input.key)))
  const maxSeq = siblings.reduce((m, s) => Math.max(m, s.episodeSeq), 0)
  const anyLive = siblings.some((s) => lifecycle(s.phase, s.outcome, false, false).isLive)
  const episodeSeq = siblings.length === 0 || !anyLive ? maxSeq + 1 : maxSeq
```

Add `and` to the `drizzle-orm` import at the top (`import { and, eq } from 'drizzle-orm'`). Then add `episodeSeq,` to the `tx.insert(workItems).values({ … })` object (after `key`).

(NOTE: this runs AFTER the step-1 dedup early-return at `dispatch.ts:66-73` — a deduped dispatch reuses the existing run and never reaches here, so no episode is minted for a covered source. Correct.)

- [ ] **Step 5: Run to verify it passes**

Run: `yarn test packages/server/src/dispatch.test.ts -t "stamps episodeSeq"`
Expected: PASS (1, then 1, then 2).

- [ ] **Step 6: Run the full dispatch + chokepoint suites (no regression)**

Run: `yarn test packages/server/src/dispatch.test.ts packages/server/src/pipelineService.test.ts`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/db/schema.ts packages/server/src/dispatch.ts packages/server/src/dispatch.test.ts
git commit -m "feat(server): stamp episodeSeq on dispatch (keyed-instance episode boundary)"
```

---

### Task 2: Surface `episodeSeq` through the board → WorkItem → PInstance

**Files:**
- Modify: the board read (`packages/server/src/pipelineService.ts` `getBoard` ~:553-571) if it projects explicit columns — ensure `episodeSeq` is shipped.
- Modify: the client `WorkItem` type (find it — `packages/react/src/boardModel.ts` or a shared types module) to include `episodeSeq: number`.
- Modify: `packages/react/src/boardModel.ts` `toPInstances` + the `PInstance` type (`packages/react/src/pipelineModel.ts`) to carry `episodeSeq` onto each instance run.
- Test: `packages/react/src/boardModel.test.ts`

**Interfaces:**
- Consumes: `work_items.episode_seq` (Task 1).
- Produces: `WorkItem.episodeSeq: number` and `PInstance.episodeSeq: number` available client-side.

- [ ] **Step 1: Verify what `getBoard` ships**

Read `getBoard` (`pipelineService.ts` ~:553-571). If it `select`s explicit columns, add `episodeSeq`. If it returns whole rows (`select().from(workItems)`), `episodeSeq` is already included — note that and skip the server edit.

- [ ] **Step 2: Write the failing client test**

In `packages/react/src/boardModel.test.ts` add (adapt to the file's `toPInstances` fixture shape):

```ts
it('carries episodeSeq from the work item onto the PInstance', () => {
  const items = [{ ...baseItem, id: 'r1', agentId: 'wf__reply', key: 's@x', episodeSeq: 2, phase: 'active', outcome: 'running' }]
  const pins = toPInstances(items as any, 'wf', roleOf, icon, nameOf, labelOf)
  expect(pins[0].episodeSeq).toBe(2)
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `yarn test packages/react/src/boardModel.test.ts -t "carries episodeSeq"`
Expected: FAIL — `episodeSeq` is `undefined` on the PInstance.

- [ ] **Step 4: Thread `episodeSeq` through the types + mapping**

Add `episodeSeq: number` to the client `WorkItem` type and to `PInstance` (`pipelineModel.ts`). In `toPInstances` (`boardModel.ts`), copy `w.episodeSeq` onto the produced `PInstance`.

- [ ] **Step 5: Run to verify it passes**

Run: `yarn test packages/react/src/boardModel.test.ts -t "carries episodeSeq"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/pipelineService.ts packages/react/src/boardModel.ts packages/react/src/pipelineModel.ts
git commit -m "feat: surface episodeSeq through board → WorkItem → PInstance"
```

---

### Task 3: Client — `openRuns` shows only the latest episode (generic; remove the input special-case)

**Files:**
- Create: `packages/react/src/currentEpisode.ts` (pure helper) + `packages/react/src/currentEpisode.test.ts`
- Modify: `packages/react/src/hooks/useBoardNavigation.ts` (`openRuns` ~:130-132)
- Modify (if it shipped): delete `latestScanRuns` + its wiring from the `input-thread-latest-scan` work.

**Interfaces:**
- Produces: `currentEpisode(runs: { episodeSeq: number }[]): typeof runs` — returns only the runs whose `episodeSeq === max(episodeSeq)`; `[]` for `[]`. Order-preserving. Pure, generic, no input/worker branch.
- Consumes: `PInstance.episodeSeq` (Task 2).

- [ ] **Step 1: Write the failing helper test**

`packages/react/src/currentEpisode.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { currentEpisode } from './currentEpisode.js'

describe('currentEpisode', () => {
  it('keeps only the highest episodeSeq runs (latest episode)', () => {
    const runs = [{ id: 'a', episodeSeq: 1 }, { id: 'b', episodeSeq: 1 }, { id: 'c', episodeSeq: 2 }]
    expect(currentEpisode(runs).map((r) => r.id)).toEqual(['c'])
  })
  it('keeps ALL runs of the one episode (same-episode done + live both show)', () => {
    const runs = [{ id: 'a', episodeSeq: 3 }, { id: 'b', episodeSeq: 3 }]
    expect(currentEpisode(runs).map((r) => r.id)).toEqual(['a', 'b'])
  })
  it('returns [] for []', () => {
    expect(currentEpisode([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test packages/react/src/currentEpisode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

`packages/react/src/currentEpisode.ts`:

```ts
// The current episode of a keyed instance = its runs with the highest episodeSeq. A keyed instance
// that fully receded and reactivated has a higher episodeSeq on the new run, so a prior episode's
// (done) runs are excluded — they do not resurrect in the open thread. Generic: no workflow / no
// input-vs-worker branch (an input agent's latest scan is simply its current episode).
export function currentEpisode<T extends { episodeSeq: number }>(runs: T[]): T[] {
  if (runs.length === 0) return []
  const max = runs.reduce((m, r) => Math.max(m, r.episodeSeq), 0)
  return runs.filter((r) => r.episodeSeq === max)
}
```

- [ ] **Step 4: Wire into `openRuns`**

In `packages/react/src/hooks/useBoardNavigation.ts`, wrap the `openRuns` derivation (~:130-132) with `currentEpisode(...)`:

```ts
const openRuns: PInstance[] = openItem
  ? currentEpisode(pInstances.filter((p) => p.agentId === stripAgent(openItem) && p.key === openItem.key))
  : []
```

Import `currentEpisode` at the top. This is generic — it replaces any input-only heuristic.

- [ ] **Step 5: Remove the input special-case (if it shipped)**

If `2026-06-17-input-thread-latest-scan.md` already landed: delete `latestScanRuns` (its module + test) and its wiring in `openRuns`; the generic `currentEpisode` now covers the input agent (its latest scan = its current episode). Grep `latestScanRuns` to find all references. If that plan did NOT ship, skip this step.

- [ ] **Step 6: Run the helper + hook + board tests**

Run: `yarn test packages/react/src/currentEpisode.test.ts packages/react/src/boardModel.test.ts packages/react/src/hooks`
Expected: all PASS.

- [ ] **Step 7: Build + commit**

```bash
yarn workspace @atizar/react build
git add packages/react/src/currentEpisode.ts packages/react/src/currentEpisode.test.ts packages/react/src/hooks/useBoardNavigation.ts
git commit -m "feat(react): openRuns shows only the current episode (generic; replaces input latest-scan heuristic)"
```

---

### Task 4: Input agent open-routing — card↔pipeline parity (open the current episode)

**The bug this fixes (found in the browser during dev):** the single-`isLive` migration filtered
`instancesOf` heads to `isLive`. Correct for workers, but it **drops the input agent's done scan** —
so opening the sorter from the **pipeline row** works (the pipeline keeps it via `isLive(self) ||
hasLiveDescendant`) while opening it from the **agent card** routes to an idle type-view
(`openAgent` → `instancesOf('sorter') === 0`). The two open paths DIVERGE for the input agent and you
**cannot open the inbox from its card**. The input agent is the persistent root: its current scan is
the card's content + the re-scan entry point and must be reachable from the card even when the scan
run is terminal. This belongs here because it is the same "open the input's CURRENT EPISODE" seam.

**Fix seam:** do NOT loosen the `instancesOf` `isLive` filter (it correctly keeps the card
aggregate/count live-only, so the input card stays idle/launchable). Instead add a dedicated **input
branch in `openAgent`** that opens the input's current-episode scan directly. `liveOf(agentId)` is the
raw `isVisible` per-agent slice (NOT `isLive`-filtered) — narrow it with `currentEpisode` (Task 3) and
`pickHead` to the latest scan.

**Files:**
- Modify: `packages/react/src/hooks/useBoardNavigation.ts` (`openAgent` at ~:85-93)
- Test: `packages/react/src/hooks/useBoardNavigation.test.ts`
- Browser acceptance (already written, turn GREEN here): `apps/inbox/e2e/input-reopen-from-card.spec.ts`, `apps/inbox/e2e/input-open-parity.spec.ts`

**Interfaces:**
- Consumes: `roleOf` (`roleOf(agentId) === 'input'`), `liveOf` (raw visible slice), `currentEpisode` (Task 3), `pickHead` (existing).
- Produces: `openAgent(inputAgentId)` opens the current-episode scan instance (`setOpenId`) when one exists; type view only when there is NO scan yet. Worker routing (0→type, 1→thread, ≥2→picker) unchanged.

- [ ] **Step 1: Write the failing test**

In `packages/react/src/hooks/useBoardNavigation.test.ts` (ensure the test `cfg` marks the sorter as the `input` role), add:

```ts
it('input agent: a DONE scan is still openable from the card (not the type view)', () => {
  items = [
    {
      id: 'a__sorter#1',
      workflowId: 'a',
      agentId: 'a__sorter',
      key: 'sorter', // input agent's CONSTANT key
      phase: 'done',
      status: 'done',
      outcome: 'done',
      card: { tool: 'renderSort', props: {} }, // has a card → isVisible
      parentId: null,
      payload: {},
      episodeSeq: 1,
    },
  ]
  const { result } = renderHook(() => useBoardNavigation(cfg, 'a'))
  act(() => result.current.openAgent('sorter'))
  expect(result.current.openId).toBe('a__sorter#1') // opens the scan instance…
  expect(result.current.openTypeId).toBeNull() // …NOT the idle type view
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test packages/react/src/hooks/useBoardNavigation.test.ts -t "input agent: a DONE scan"`
Expected: FAIL — `openTypeId === 'sorter'`, `openId === null` (the `isLive` filter dropped the done scan).

- [ ] **Step 3: Add the input branch to `openAgent`**

In `packages/react/src/hooks/useBoardNavigation.ts`, at the top of `openAgent` (after the three `setOpen*(null)` resets), add:

```ts
    // INPUT agent: its current scan is the persistent root + the card's content — reachable from the
    // card even when its run is terminal (parity with the pipeline row, kept via hasLiveDescendant).
    // Open the current-episode scan; type view only when no scan exists.
    if (roleOf(agentId) === 'input') {
      const scans = currentEpisode(liveOf(agentId)) // raw isVisible slice → latest episode's scan
      if (scans.length > 0) {
        setOpenId(pickHead(scans).localId)
        return
      }
      setOpenTypeId(agentId)
      return
    }
```

Leave the existing worker routing (`const insts = instancesOf(agentId)` …) untouched below it.

- [ ] **Step 4: Run to verify it passes**

Run: `yarn test packages/react/src/hooks/useBoardNavigation.test.ts -t "input agent: a DONE scan"`
Expected: PASS.

- [ ] **Step 5: Build + commit**

```bash
yarn workspace @atizar/react build
git add packages/react/src/hooks/useBoardNavigation.ts packages/react/src/hooks/useBoardNavigation.test.ts
git commit -m "fix(react): input agent openable from its card via its current episode (open-path parity)"
```

---

### Task 5: Green gate, foundation check, browser-verify

**Files:** none (verification only).

- [ ] **Step 1: Full green gate**

Run: `yarn typecheck && yarn test && yarn lint && yarn format:check` (+ `yarn workspace @atizar/react build`)
Expected: all PASS. (Fix any drift-guard / cassette fallout per the demo-cassette rules.)

- [ ] **Step 2: check-foundation**

Invoke the `check-foundation` skill. Expected: Clear — `episodeSeq` is a generic server-authoritative integer (I8), no workflow literals (I5), not a lifecycle phase/outcome value (I12 untouched), client is a pure reader (single source).

- [ ] **Step 3: Browser-verify both cases**

Invoke `browser-verify`.
- **Reply resurrection (E2E new case):** reply two drafts for one sender → approve/finish both → close (instance recedes, can't reopen) → re-START + a new email from the SAME sender → open the reply instance: the thread shows ONLY the new run, NOT the two prior done drafts.
- **Same-episode keep (regression):** within one open session, a done draft + a still-live sibling → both show.
- **Input stacking (subsumes input-thread-latest-scan):** re-START the sorter with prior pending drafts → the sorter thread shows ONE (latest) INBOX-SORTED card, and the prior scan's live children still appear in the pipeline tree.

- [ ] **Step 4: Final commit (if verification produced fixes)**

```bash
git add -p
git commit -m "test: verify episode-scoping (reply resurrection, same-episode keep, input stacking)"
```

---

## Self-Review

- **Spec coverage:** `episodeSeq` stamp at dispatch (Task 1), surfaced to the client (Task 2), `openRuns` filtered to the current episode + input special-case removed (Task 3), green/foundation/browser incl. the two distinguishing cases (Task 4).
- **The crux (same-episode vs different-episode):** captured by the dispatch-time `anyLive` check — a sibling still live → inherit (same episode, done sibling shows); none live → `max+1` (new episode, prior done hidden). Covered by Task 1 Step 2 and Task 3 Steps 1/3.
- **Single source:** episode decided once (server stamp); client reads `max` via `currentEpisode`. No second computation. (Verified against the standing rule.)
- **Boundary (I5):** all generic — `episodeSeq` keys on `(workflowId, agentId, key)`; `instanceKeyOf` (the email policy) is untouched in `apps/inbox/server/index.ts`.
- **Supersession:** explicitly removes the `input-thread-latest-scan` heuristic (Task 3 Step 5) so there is ONE mechanism, not two.
- **Type consistency:** `episodeSeq: number` is the same name on the column (`episode_seq`), `WorkItem`, `PInstance`, and the `currentEpisode` constraint; `currentEpisode` is the exact symbol wired in `openRuns`.
