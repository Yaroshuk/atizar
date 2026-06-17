# Completion Animation (Pipeline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a pipeline instance goes live→terminal, its node/row does **not** vanish in the same frame. It **lingers** briefly (so the human reads the final state) then **fades** out of the live lists. This is **client-side presentation only** — the DB Run row is untouched, and no other pipeline behavior changes. Implements spec `docs/superpowers/specs/2026-06-17-agent-view-lifecycle-presentation.md` §3 "Completion animation"; acceptance cases **P7** and the **T1–T3 timing** clauses in `docs/superpowers/specs/2026-06-17-agent-view-e2e-cases.md`.

**Architecture:** Today `apps/inbox/client/src/BoardApp/BoardInner.tsx:58` calls `buildPipeline(nav.pInstances, …)` and passes the resulting `PipelineBlock[]` to `<PipelineColumn>` (`packages/react/src/components/PipelineColumn/PipelineColumn.tsx`). `buildPipeline` already drops an instance from `blocks` the render after it goes terminal-and-has-no-live-descendant (the `ACTIVE`/`shown` walk + the planned single-`isLive` migration). So the row currently **disappears in one frame**. The fix is a thin presentation layer **inside `PipelineColumn`**: track the set of leaf row `localId`s that were rendered last frame but are **absent this frame** (= "leaving"), keep those rows **mounted** with a `leaving` CSS class for a linger window, then drop them. The "which ids are leaving" computation is a **pure, unit-tested helper** (`diffLeaving`); the timeout/CSS fade is a thin hook (`useLingerSet`) whose timing/visual is **browser-verified** (it is not unit-assertable — only the browser shows the fade).

**Tech Stack:** TypeScript, React + Testing Library, Vitest, CSS Modules (`*.module.scss`, `localsConvention: 'camelCaseOnly'`), `--atz-*` design tokens, Vite library build (`@atizar/react`).

This is a **standalone presentation plan**. It does **not** depend on the handoff-trace plan. It **does** depend conceptually on the shared liveness predicate from plan **P0** (`packages/react/src/liveness.ts`, exporting `isLive`): the linger layer must agree with whatever rule decides "live set". Per the task brief, **assume `import { isLive } from '../liveness'` exists** by the time this lands. If P0 has NOT landed yet, the helper still works against the row set `PipelineColumn` is handed (it diffs *rendered* ids, not raw statuses), and the one place that needs `isLive` (deciding whether a still-present row should keep an in-progress fade) falls back to the row's terminal status (`!isStoppable`) — see Task 2, Step 4.

## Global Constraints

> **READ FIRST — two standing rules for whoever implements this (the reason this whole plan set exists). Hold them on EVERY task:**
> 1. **Always think about the framework/app boundary.** Before placing any non-trivial code, ask: generic *mechanism* every workflow needs (→ `@atizar/*`) or *one workflow's policy* (→ `apps/inbox/...`)? A framework symbol carries ZERO workflow knowledge — no `reply/reader/spam/email/ticket` literals. Unsure → default to the app; lift only when a 2nd consumer proves it generic. Don't let the two get confused.
> 2. **Never multiply sources of truth.** One derivation per concept (liveness, status, priority, counts). Reuse the existing predicate/classifier; here, the linger diff reuses the rendered live set — it does NOT re-derive liveness.

- **Presentation only — no foundation surface touched (I5 / framework).** The change lives entirely in `@atizar/react` (`PipelineColumn` + a new pure helper + a hook + CSS). It adds **zero** workflow knowledge (no `email/reply/sorter/destination` literals) — it diffs opaque `localId` strings. The DB Run row, the board transport, `buildPipeline`'s output contract, and `pipelineModel.ts` are **unchanged**. **`check-foundation` is NOT required** (no actions, providers, `@atizar/core`, or framework/userland boundary change).
- **TDD:** no production code without a failing test first. Watch each test fail, then pass. The pure `diffLeaving` helper is unit-tested with REAL test code. The **animation timing + visual fade is browser-only-verifiable** (a `useEffect` + `setTimeout` + a CSS transition is invisible to jsdom + typecheck) → it gets an explicit `browser-verify` task (Task 5), NOT a brittle fake-timer DOM assertion.
- **Single source of liveness (P0):** consume `isLive` from `packages/react/src/liveness.ts` rather than re-deriving an `ACTIVE`-style set inside the linger layer. Do not introduce a fourth liveness copy.
- **CSS-Module `camelCaseOnly` gotcha:** the convention camelizes BOTH `-` AND `_` (`.row-leaving` → `rowLeaving`, `s-running` → `sRunning`). A new class is read in TS by its camelCase key (`s.leaving`). The convention MUST already match in BOTH compilers — `apps/inbox/vite.config.ts:11` (dev) AND `packages/react/vite.config.ts:13` (lib build) — both are `'camelCaseOnly'` today; do not change them, just rely on the camelCase key. A mismatch renders the fade unstyled and **only the browser catches it**.
- **Linger duration is a token, not a magic number:** add a `--atz-*` custom property (e.g. `--atz-linger-ms` for JS + `--atz-linger` duration for the CSS transition) so the operator/themer can retune it; read the JS side via a module constant kept in sync (jsdom cannot read computed CSS custom props reliably) — see Task 3.
- **Green gate before "done":** `yarn typecheck && yarn test && yarn lint && yarn format:check` from repo root, plus `yarn workspace @atizar/react build` (this plan changes `@atizar/react` CSS + source).
- **Tests run from repo root** (`yarn test`).

---

### Task 1: Pure helper — `diffLeaving` (which row ids are leaving this render)

**Files:**
- Create: `packages/react/src/pipelineLinger.ts`
- Create (test): `packages/react/src/pipelineLinger.test.ts`
- Modify: `packages/react/src/index.ts` (export `diffLeaving`, `type LeavingState` for reuse/testing parity)

**Interfaces:**
- Produces:
  - `type LeavingState = { present: ReadonlySet<string>; leaving: ReadonlySet<string> }`
  - `function diffLeaving(prevPresent: ReadonlySet<string>, prevLeaving: ReadonlySet<string>, currentPresent: ReadonlySet<string>): LeavingState` — pure. Given the ids rendered as **present** last frame, the ids that were already **leaving** last frame, and the ids `buildPipeline` emits **now**, returns the next `{present, leaving}`. Rules: (a) an id in `prevPresent` but NOT in `currentPresent` newly **starts leaving**; (b) an id still leaving stays leaving until the hook's timer drops it (the hook removes ids from `prevLeaving` before calling — so an id that is in `prevLeaving` AND still absent from `currentPresent` stays leaving); (c) an id that **reappears** in `currentPresent` is present again and removed from leaving (a re-run on the same key un-fades cleanly); (d) `present` is exactly `currentPresent`.
- Consumes: nothing (leaf, no React, no DOM). Liveness is NOT consulted here — the helper diffs the *already-decided* rendered-id set; `isLive` decided membership upstream in `buildPipeline`. (This keeps the single-source rule: liveness lives in `liveness.ts`, the diff is pure set algebra.)

- [ ] **Step 1: Write the failing test (REAL assertions)**

Create `packages/react/src/pipelineLinger.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { diffLeaving } from './pipelineLinger.js'

const S = (...ids: string[]) => new Set(ids)
const arr = (s: ReadonlySet<string>) => [...s].sort()

describe('diffLeaving', () => {
  it('first render: everything present, nothing leaving', () => {
    const r = diffLeaving(S(), S(), S('a', 'b'))
    expect(arr(r.present)).toEqual(['a', 'b'])
    expect(arr(r.leaving)).toEqual([])
  })

  it('an id that drops out of current starts leaving (still tracked)', () => {
    const r = diffLeaving(S('a', 'b'), S(), S('a'))
    expect(arr(r.present)).toEqual(['a'])
    expect(arr(r.leaving)).toEqual(['b'])
  })

  it('an already-leaving id that is still absent stays leaving', () => {
    const r = diffLeaving(S('a'), S('b'), S('a'))
    expect(arr(r.leaving)).toEqual(['b'])
  })

  it('the hook having cleared a timed-out id (not in prevLeaving) drops it', () => {
    // hook removed 'b' from prevLeaving before calling → it must NOT come back
    const r = diffLeaving(S('a'), S(), S('a'))
    expect(arr(r.leaving)).toEqual([])
    expect(arr(r.present)).toEqual(['a'])
  })

  it('a reappearing id is present again and removed from leaving (re-run un-fades)', () => {
    const r = diffLeaving(S('a'), S('b'), S('a', 'b'))
    expect(arr(r.present)).toEqual(['a', 'b'])
    expect(arr(r.leaving)).toEqual([])
  })

  it('does not mark an id leaving twice / never both present and leaving', () => {
    const r = diffLeaving(S('a', 'b'), S('c'), S('a'))
    // b newly leaves, c still leaving, a stays present — disjoint sets
    expect(arr(r.present)).toEqual(['a'])
    expect(arr(r.leaving)).toEqual(['b', 'c'])
    expect([...r.present].some((x) => r.leaving.has(x))).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test packages/react/src/pipelineLinger.test.ts`
Expected: FAIL — `Cannot find module './pipelineLinger.js'`.

- [ ] **Step 3: Implement `diffLeaving`**

Create `packages/react/src/pipelineLinger.ts`:

```ts
// Pure presentation helper for the pipeline completion animation. Diffs the set of pipeline
// row ids rendered "present" last frame against the set buildPipeline emits this frame, and
// returns which ids are now "leaving" (a row that just dropped out of the live set). The hook
// (useLingerSet) owns the timer that finally removes a leaving id; this function is pure set
// algebra so the "which ids are leaving" decision is unit-testable without React/DOM/timers.
//
// It deliberately does NOT consult liveness — buildPipeline already applied isLive (P0,
// packages/react/src/liveness.ts) to decide membership of `currentPresent`. Here we only diff
// the already-decided rendered-id set, keeping ONE source of liveness.
export type LeavingState = {
  present: ReadonlySet<string>
  leaving: ReadonlySet<string>
}

export function diffLeaving(
  prevPresent: ReadonlySet<string>,
  prevLeaving: ReadonlySet<string>,
  currentPresent: ReadonlySet<string>
): LeavingState {
  const leaving = new Set<string>()
  // (b) ids still leaving from before that have not reappeared stay leaving.
  for (const id of prevLeaving) if (!currentPresent.has(id)) leaving.add(id)
  // (a) ids that were present last frame but are gone now newly start leaving.
  for (const id of prevPresent) if (!currentPresent.has(id)) leaving.add(id)
  // (c)/(d) present is exactly the current set; a reappearing id is present, never leaving.
  return { present: new Set(currentPresent), leaving }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test packages/react/src/pipelineLinger.test.ts`
Expected: PASS (all six cases).

- [ ] **Step 5: Export from the react package**

In `packages/react/src/index.ts`, add alongside the existing `buildPipeline` export:

```ts
export { diffLeaving, type LeavingState } from './pipelineLinger.js'
```

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/pipelineLinger.ts packages/react/src/pipelineLinger.test.ts packages/react/src/index.ts
git commit -m "feat(react): pure diffLeaving helper for pipeline completion linger"
```

---

### Task 2: The `useLingerSet` hook — keep leaving rows mounted for the linger window

**Files:**
- Modify: `packages/react/src/pipelineLinger.ts` (add the hook next to the pure helper — it is the same concern; the pure part stays exported separately for its test)
- Test: covered by the pure `diffLeaving` test (Task 1) + the browser-verify (Task 5). No jsdom timer assertion (see Global Constraints).

**Interfaces:**
- Produces: `function useLingerSet(currentPresent: ReadonlySet<string>, lingerMs: number): { isLeaving: (id: string) => boolean; lingering: ReadonlySet<string> }`. On each render it runs `diffLeaving(prevPresentRef, prevLeavingRef, currentPresent)`, stores the result in refs, and schedules a `setTimeout(lingerMs)` per newly-leaving id that, on fire, removes that id from the leaving set and forces a re-render (so the row finally unmounts). Returns `isLeaving(id)` (true while an id is in the leaving set → caller adds the `s.leaving` class) and `lingering` (the leaving set → caller still renders those rows).
- Consumes: `diffLeaving` (Task 1); React `useRef`/`useState`/`useEffect`. `isLive` from `../liveness` (P0) is **not** needed by the hook itself — membership was decided upstream. (The fallback note below covers the pre-P0 window.)

- [ ] **Step 1: Implement the hook**

Append to `packages/react/src/pipelineLinger.ts`:

```ts
import { useEffect, useRef, useState } from 'react'

// React hook that keeps a row mounted for `lingerMs` after it drops out of the live set, so the
// pipeline can fade it instead of yanking it. Pure decision delegated to diffLeaving; this owns
// only the timers + the re-render that finally unmounts a row. Presentation only — nothing here
// touches state, the DB, or the board transport.
export function useLingerSet(
  currentPresent: ReadonlySet<string>,
  lingerMs: number
): { isLeaving: (id: string) => boolean; lingering: ReadonlySet<string> } {
  const presentRef = useRef<ReadonlySet<string>>(new Set())
  const leavingRef = useRef<ReadonlySet<string>>(new Set())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const [, force] = useState(0)
  const rerender = () => force((n) => n + 1)

  const next = diffLeaving(presentRef.current, leavingRef.current, currentPresent)

  // Schedule a removal timer for any id that is newly leaving (no timer yet).
  for (const id of next.leaving) {
    if (timers.current.has(id)) continue
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id)
        // Drop this id from the tracked leaving set, then re-render to unmount the row.
        leavingRef.current = new Set([...leavingRef.current].filter((x) => x !== id))
        rerender()
      }, lingerMs)
    )
  }
  // If an id reappeared (present again), cancel its pending removal timer.
  for (const [id, t] of timers.current) {
    if (currentPresent.has(id)) {
      clearTimeout(t)
      timers.current.delete(id)
    }
  }

  presentRef.current = next.present
  leavingRef.current = next.leaving

  useEffect(() => {
    const ts = timers.current
    return () => {
      for (const t of ts.values()) clearTimeout(t)
      ts.clear()
    }
  }, [])

  return { isLeaving: (id) => leavingRef.current.has(id), lingering: leavingRef.current }
}
```

- [ ] **Step 2: Typecheck the hook in isolation**

Run: `yarn typecheck`
Expected: PASS. Fix any React import / `ReadonlySet` variance issues before proceeding. (No new unit test — the timer behavior is browser-verified in Task 5; the pure decision is already covered by Task 1.)

- [ ] **Step 3: Lint + format**

Run: `yarn lint && yarn format:check`
Expected: GREEN (fix or justify with a scoped disable + comment per the project lint rule).

- [ ] **Step 4: (P0 fallback note — do NOT add code unless P0 is missing)**

If `packages/react/src/liveness.ts` / `isLive` has NOT landed when you implement this, nothing in `pipelineLinger.ts` needs it — the hook diffs rendered ids only. The single place liveness matters is `buildPipeline` (P0's job) deciding which rows are in `currentPresent`. Leave a one-line comment in `pipelineLinger.ts` pointing at `liveness.ts` as the upstream source (already in the header comment from Task 1, Step 3). No change here.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/pipelineLinger.ts
git commit -m "feat(react): useLingerSet hook keeps leaving pipeline rows mounted for the linger window"
```

---

### Task 3: Linger duration token + fade-out CSS class

**Files:**
- Modify: `packages/react/src/tokens.css` (add `--atz-linger` duration token, near the other `--atz-*` motion/radius tokens)
- Modify: `packages/react/src/components/PipelineColumn/PipelineColumn.module.scss` (add `.leaving` fade class; reference the token)
- Modify: `packages/react/src/pipelineLinger.ts` (export the JS-side `LINGER_MS` constant kept in sync with the CSS token)

**Interfaces:**
- Produces: a CSS custom property `--atz-linger: 600ms` (duration the fade transition runs); a CSS-Module class `.leaving` (camelCase key `s.leaving`) that fades opacity to 0 + collapses interactivity over `var(--atz-linger)`; a TS constant `export const LINGER_MS = 600` (the JS timer length — must be ≥ the CSS duration so the row stays mounted through the whole fade).
- Consumes: nothing new. Caller (Task 4) passes `LINGER_MS` to `useLingerSet` and adds `s.leaving` to leaving rows.

- [ ] **Step 1: Add the token**

In `packages/react/src/tokens.css`, in the `:root` block, add near the radius/shadow tokens:

```css
  /* completion-animation linger: how long a finished pipeline row fades before it unmounts */
  --atz-linger: 600ms;
```

- [ ] **Step 2: Add the `LINGER_MS` constant (kept in sync with the token)**

In `packages/react/src/pipelineLinger.ts`, add at the top (after the header comment):

```ts
// Linger window for the pipeline completion fade. Kept in sync with the CSS token --atz-linger
// (tokens.css): the JS timer must be ≥ the CSS transition so the row stays mounted for the whole
// fade. (jsdom can't reliably read a computed custom property, so the JS side is a constant, not
// a getComputedStyle read — a single source documented here, asserted by browser-verify.)
export const LINGER_MS = 600
```

- [ ] **Step 3: Add the `.leaving` fade class**

In `packages/react/src/components/PipelineColumn/PipelineColumn.module.scss`, add (note: the camelize gotcha means `.leaving` is read in TS as `s.leaving`; `pointer-events:none` so a fading, soon-gone row is not clickable):

```scss
// Completion animation: a row that just went terminal lingers mounted with this class, fading
// out over --atz-linger before useLingerSet unmounts it. Presentation only — the row's data
// (and its DB Run) is untouched; it is simply no longer in the live set. Applied to the leaf
// row elements (.pl-single / .pl-inst / .mini) as a co-class.
.leaving {
  animation: pl-fade-out var(--atz-linger) ease forwards;
  pointer-events: none;
}

@keyframes pl-fade-out {
  0% {
    opacity: 1;
  }
  60% {
    opacity: 1;
  } // hold briefly so the human reads the final state…
  100% {
    opacity: 0; // …then fade.
  }
}
```

(Using a keyframe rather than a `transition` gives the explicit linger-then-fade shape the spec asks for — "lingers briefly then fades" — in one declarative class.)

- [ ] **Step 4: Build the react lib to confirm the CSS compiles + the token ships**

Run: `yarn workspace @atizar/react build`
Expected: build clean; `react.css` carries `--atz-linger` and `.leaving`/`pl-fade-out` (the lib build compiles the module + tokens — `localsConvention: 'camelCaseOnly'` per `packages/react/vite.config.ts:13`).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/tokens.css packages/react/src/components/PipelineColumn/PipelineColumn.module.scss packages/react/src/pipelineLinger.ts
git commit -m "feat(react): --atz-linger token + .leaving fade-out class for the pipeline"
```

---

### Task 4: Wire the linger into `PipelineColumn` (keep leaving rows mounted + faded)

**Files:**
- Modify: `packages/react/src/components/PipelineColumn/PipelineColumn.tsx`
- Test: `packages/react/src/components/PipelineColumn/PipelineColumn.linger.test.tsx` (new) — asserts a row that drops out of `blocks` is STILL rendered (with the `leaving` class) on the next render, without fake timers (presence-on-drop is the unit-checkable half; the *eventual unmount* + the visual fade is Task 5 browser-verify).

**Interfaces:**
- Consumes: `useLingerSet`, `LINGER_MS` (Tasks 2–3); the existing `blocks: PipelineBlock[]` prop (unchanged); `s.leaving` (Task 3). Optionally `isLive` from `../liveness` is NOT consumed here — membership is in `blocks`.
- Produces: the same DOM as today, except every **leaf row** that is in the linger set is (a) still rendered even though it is absent from `blocks`, and (b) carries the `s.leaving` co-class. The set of leaf-row ids is derived from `blocks` (the `localId` of every parent `mini`, every `pl-single` head, and every `pl-inst` head) PLUS the lingering ids whose last-known row must be redrawn.

**Design note (kept honest):** `buildPipeline` removes a finished instance from `blocks` entirely, so the *row data* for a leaving id is gone the frame it leaves. Two viable approaches:
- **(A) Snapshot rows.** `PipelineColumn` keeps a `Map<localId, RenderedRow>` of the last-seen flat leaf rows; when an id is leaving, redraw it from the snapshot with the `leaving` class. Simple, but duplicates the block→row flattening.
- **(B) Linger at the block level upstream.** Have `BoardInner` retain leaving blocks. Rejected: it leaks presentation timing into app glue and the block tree (parent/child) is awkward to half-retain.

**Chosen: (A)**, but minimal — snapshot only the **flat leaf rows** (parent `mini`, `pl-single`, `pl-inst`), which is what the human watches recede; a leaving *parent block* that still has live children never leaves (it stays via `hasLiveDescendant` in `buildPipeline`), so we only ever linger true leaf terminals. This keeps the change inside `PipelineColumn` and avoids touching `buildPipeline`/`BoardInner`.

- [ ] **Step 1: Write the failing render test**

Create `packages/react/src/components/PipelineColumn/PipelineColumn.linger.test.tsx`. Base the block fixtures on the shapes in `pipelineModel.ts` (`PipelineBlock`/`AgentGroup`/`PInstance`). Render with two distinct `blocks` props across a rerender; assert the dropped row is STILL in the DOM after the second render (mounted, lingering) — do NOT advance timers (the unmount is browser-verified):

```tsx
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { PipelineColumn } from './PipelineColumn'
import type { PipelineBlock, PInstance } from '../../pipelineModel'

const inst = (over: Partial<PInstance>): PInstance => ({
  localId: 'x', runtimeKey: 'rk', agentId: 'wf__reply', key: 'k', name: 'Reply',
  iconName: 'mail', label: 'Ann', status: 'running', outcome: 'pending', isInput: false,
  ...over,
})

const block = (parent: PInstance): PipelineBlock => ({ parent, groups: [] })

describe('PipelineColumn completion linger', () => {
  it('keeps a row mounted (lingering) the render after it drops out of blocks', () => {
    const a = inst({ localId: 'a', key: 'a', label: 'Ann' })
    const b = inst({ localId: 'b', key: 'b', label: 'Bob' })
    const { rerender, queryByText } = render(
      <PipelineColumn blocks={[block(a), block(b)]} onOpen={() => {}} />
    )
    expect(queryByText(/Ann/)).toBeTruthy()
    expect(queryByText(/Bob/)).toBeTruthy()

    // Bob's instance finished → buildPipeline drops it; the row must NOT vanish immediately.
    rerender(<PipelineColumn blocks={[block(a)]} onOpen={() => {}} />)
    expect(queryByText(/Ann/)).toBeTruthy()
    expect(queryByText(/Bob/)).toBeTruthy() // still mounted, lingering (will fade then unmount)
  })
})
```

(Adjust the `PInstance` fixture fields / `outcome` value to the real types — read `pipelineModel.ts` `PInstance` + `status.ts` for the exact `Status`/`Outcome` literals. Use `@testing-library/jest-dom` matchers only if the suite already wires them; otherwise plain `toBeTruthy()` as above.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test packages/react/src/components/PipelineColumn/PipelineColumn.linger.test.tsx`
Expected: FAIL — after the rerender, `Bob` is gone (today's behavior: a dropped block disappears in one frame).

- [ ] **Step 3: Flatten blocks to leaf rows + maintain a snapshot**

In `PipelineColumn.tsx`, before the JSX:
- Build the current flat leaf-row list from `blocks`: for each block, the parent (`mini`, `localId = block.parent.localId`), then each group's `pl-single` head or each `pl-inst` head. Each entry: `{ localId, kind: 'mini' | 'single' | 'inst', … the props the row needs to render }`.
- Keep a `useRef<Map<string, LeafRow>>` snapshot; on each render, upsert every current leaf row into it.
- `const present = new Set(currentLeafRows.map((r) => r.localId))`.
- `const { isLeaving, lingering } = useLingerSet(present, LINGER_MS)`.
- The **render list** = current leaf rows ∪ (lingering ids resolved from the snapshot, in their last-seen group/position). For the minimal version, render lingering leaf rows by re-emitting them from the snapshot wherever their parent block still renders; a lingering row whose parent block is also gone is appended under a retained-parent placeholder OR (simplest, acceptable) re-rendered flat at the position it last held. Keep parent/child structure for *present* rows exactly as today.

(Pragmatic scoping: because a parent with a live child never leaves, the common leaving case is a **child `pl-inst` / `pl-single`** under a still-present parent, or a **lone leaf** block. Handle those two; a simultaneously-leaving parent+child collapses to the parent block lingering as one unit — acceptable for the beta.)

- [ ] **Step 4: Add the `leaving` class to lingering rows**

Where each leaf row's `className` is composed (`mini …`, `pl-single …`, `pl-inst …`), append `${isLeaving(localId) ? ' ' + s.leaving : ''}`. (The tint/`has-stop` strings stay; `s.leaving` is the scoped module class.) A lingering row keeps its last-seen tint so the human reads the final state during the fade.

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn test packages/react/src/components/PipelineColumn/PipelineColumn.linger.test.tsx`
Expected: PASS — `Bob` stays mounted after the rerender.

- [ ] **Step 6: Run the full PipelineColumn + pipeline suite (no regression)**

Run: `yarn test packages/react/src/components/PipelineColumn packages/react/src/pipelineModel.test.ts packages/react/src/pipelineLinger.test.ts`
Expected: all PASS. The existing `P1/P2/P3/P6/P8` pipeline behaviors are unchanged (present rows render identically).

- [ ] **Step 7: Build + commit**

```bash
yarn workspace @atizar/react build
git add packages/react/src/components/PipelineColumn/
git commit -m "feat(react): pipeline rows linger + fade on live->terminal (P7)"
```

---

### Task 5: Green gate + browser-verify the animation (P7, T1–T3 timing)

**Files:** none (verification only).

- [ ] **Step 1: Full green gate from repo root**

Run: `yarn typecheck && yarn test && yarn lint && yarn format:check`
Expected: all PASS. Then `yarn workspace @atizar/react build` — clean. Fix any fallout before proceeding.

- [ ] **Step 2: Browser-verify the fade (the animation is browser-only-verifiable)**

Invoke the **`browser-verify`** skill (handles dev-server hygiene, port `:4000`/`:5173`, and Playwright-MCP recovery). The linger timer + CSS fade are invisible to jsdom + typecheck — the browser is the only place they show. Steps:
- Start `yarn dev` (use `DEV_RECORD_REPLAY=1` for a deterministic run if a cassette exists, else `=record` once).
- Drive a flow where a worker instance goes live→terminal: a sorter scan that dispatches a reply, approve the reply so the reply instance reaches `done` (case **T1**); separately Stop a running instance (case **T2** `stopped`) and Reject a draft (case **T3** `rejected`).
- **Assert P7:** when the instance settles, its pipeline row is **still present** for the linger window (~`--atz-linger`, 600ms) — take a snapshot/screenshot during the fade showing the row still visible with reduced opacity — then **gone** on a later snapshot. It must NOT vanish in the same frame as the status flip.
- **Assert T1–T3 timing/color:** `done`/`stopped`/`rejected` rows all linger-then-recede the same way (neutral, no special-casing in this layer). (The neutral *color* itself is a separate plan — here only confirm the linger applies uniformly and does not crash on any terminal outcome.)
- **Regression:** a parent with a still-live child does NOT fade (it stays via `hasLiveDescendant`); a re-run on the same key un-fades cleanly (no ghost row). Confirm no `Agent <localId> not found` storm or reconnect loop in the console (orthogonal, but watch for it per the SSE gotcha).

- [ ] **Step 3: Final commit (if verification produced fixes)**

```bash
git add -p
git commit -m "test: browser-verify pipeline completion animation (P7, T1-T3 timing)"
```

---

## Self-Review

- **Spec coverage:** the only pipeline change in the lifecycle spec (§3 "Completion animation") — a live→terminal row lingers then fades, client-side, DB untouched (Tasks 1–4); acceptance **P7** (node present for the linger window, then gone) is the browser-verify assertion (Task 5); **T1–T3 timing** (done/stopped/rejected all linger uniformly) is verified in the same task. The status-only pipeline node (no prose) is respected — `s.leaving` adds no text, only a fade.
- **Boundary (I5):** entirely in `@atizar/react`; diffs opaque `localId` strings; zero workflow literals; no `@atizar/core`/provider/action touch → `check-foundation` correctly skipped (presentation only), per the task brief.
- **Single source of liveness (P0):** the linger layer never re-derives liveness — `buildPipeline` (which uses `isLive` from `liveness.ts` after P0) decides `blocks`/`present`; `diffLeaving` is pure set algebra over the already-decided rendered ids. The header comment + Task 2 Step 4 document the `liveness.ts` dependency and the pre-P0 fallback (none needed in this file).
- **What is unit-tested vs browser-only:** the pure "which ids are leaving" decision is REAL unit code (`diffLeaving`, six cases, Task 1) and the *presence-on-drop* half is a render test (Task 4) — both deterministic, no fake timers. The **timing + visual fade** (timeout length, opacity transition) is explicitly called out as **browser-only-verifiable** and given a dedicated `browser-verify` task (Task 5); no brittle jsdom timer assertion is attempted.
- **CSS gotchas honored:** `--atz-linger` token added to `tokens.css` (duration is a token, not a magic number); `.leaving` read in TS as the camelCase key `s.leaving`; `localsConvention: 'camelCaseOnly'` already matches in BOTH `apps/inbox/vite.config.ts:11` and `packages/react/vite.config.ts:13` (unchanged, relied upon); `JS LINGER_MS` is a documented in-sync constant (jsdom can't read computed custom props).
- **Scoping honesty:** Task 4's snapshot approach (A) is chosen over upstream block-lingering (B) to keep the change inside `PipelineColumn`; the pragmatic limit (a simultaneously-leaving parent+child collapses to one lingering unit) is stated, not hidden — acceptable because a parent with a live child never leaves, so the leaf-child case dominates.
- **Type consistency:** `diffLeaving`/`LeavingState` (Task 1) are the exact symbols the hook consumes (Task 2); `LINGER_MS` (Task 3) is the exact constant `PipelineColumn` passes to `useLingerSet` (Task 4); `s.leaving` (Task 3) is the exact class composed in Task 4.
- **Green gate:** `yarn typecheck && yarn test && yarn lint && yarn format:check` + `yarn workspace @atizar/react build` at Task 5; `check-foundation` deliberately NOT run (presentation-only).
