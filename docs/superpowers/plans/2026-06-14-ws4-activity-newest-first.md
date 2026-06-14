# Activity Monitor Newest-First (WS4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** In operator ("Activity") mode of the `ActivityPanel`, render events newest-first (newest at the TOP) with auto-follow pinned to the top, while the dev "Trace" grouped view keeps its existing within-group chronological order (#1..#n).

**Architecture:** A pure presentation change confined to `packages/react/src/components/ActivityPanel/ActivityPanel.tsx`. The underlying `useActivity` hook keeps appending events oldest→newest (unchanged); only the operator render reverses the working `list` (a non-destructive copy), and the auto-follow `useEffect` + `onScroll` pin threshold flip from bottom-edge to top-edge. The trace grouping iterates the un-reversed `list` so groups and their `#n` sequence numbers stay chronological.

**Tech Stack:** React 19 + TypeScript, CSS Modules (`localsConvention: 'camelCaseOnly'`), vitest + @testing-library/react (happy-dom env). Package is `@atizar/react` (Vite library-mode build).

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `packages/react/src/components/ActivityPanel/ActivityPanel.tsx` | Modify | Reverse operator-mode feed order (newest at top), build trace groups from the un-reversed list, invert auto-follow scroll target (top) and `onScroll` pin threshold (near top), add a "newest first" cue in operator mode. |
| `packages/react/src/components/ActivityPanel/ActivityPanel.module.scss` | Modify | Add the `.act-feed-cue` style for the one-line "newest first" hint. |
| `packages/react/src/components/ActivityPanel/ActivityPanel.test.tsx` | Create | Render test asserting newest-first order in operator mode and chronological (#1..#n) order preserved in trace mode. |

---

### Task 1: Failing test — operator feed renders newest-first

**Files:**
- `packages/react/src/components/ActivityPanel/ActivityPanel.test.tsx` (new)

Reference facts (from the source you must keep in sync with):
- `ActivityPanel` props: `{ open: boolean; dev: boolean; feed: ActivityFeed; workflows: ReadonlyArray<{ id: string; label: string }>; onClose: () => void }` (`ActivityPanel.tsx:24-30`).
- `ActivityFeed = { events: ActivityEntry[]; connection: 'live' | 'reconnecting' }` (`hooks/useActivity.ts:6-9`).
- `ActivityEntry = { ts: number; workflowId: string; agentId: string; workItemId: string; kind: string; summary: string }` (`serverTypes.ts:55-62`).
- An operator row renders `e.summary` inside `s.actRowSummary` and `agentName(e.agentId)` (the half after `__`) (`ActivityPanel.tsx:73-87`).
- The `Drawer` only renders its body when `open` is true — so the test MUST pass `open={true}`.
- Trace mode requires BOTH `dev={true}` AND the Segmented "Trace" toggle; trace lines render `#1..#n` via `s.traceSeq` and `e.kind` text (`ActivityPanel.tsx:104-114`). The default `mode` is `'activity'`, so a trace-order assertion must switch the mode.

- [ ] **Step 1: Write the failing render test.** Create `packages/react/src/components/ActivityPanel/ActivityPanel.test.tsx` with exactly this content:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { ActivityPanel } from './ActivityPanel'
import type { ActivityEntry } from '../../serverTypes'
import type { ActivityFeed } from '../../hooks/useActivity'

const wf = [{ id: 'a', label: 'Email Inbox' }]

// useActivity appends oldest→newest, so `events[0]` is the OLDEST.
const events: ActivityEntry[] = [
  { ts: 1000, workflowId: 'a', agentId: 'a__sorter', workItemId: 'w1', kind: 'queued', summary: 'oldest event' },
  { ts: 2000, workflowId: 'a', agentId: 'a__sorter', workItemId: 'w1', kind: 'running', summary: 'middle event' },
  { ts: 3000, workflowId: 'a', agentId: 'a__sorter', workItemId: 'w1', kind: 'finished', summary: 'newest event' },
]

const feed = (overrides?: Partial<ActivityFeed>): ActivityFeed => ({
  events,
  connection: 'live',
  ...overrides,
})

describe('ActivityPanel — operator feed order', () => {
  it('renders newest event at the TOP in operator (activity) mode', () => {
    render(
      <ActivityPanel open dev={false} feed={feed()} workflows={wf} onClose={vi.fn()} />
    )
    const rendered = screen.getAllByText(/event$/).map((el) => el.textContent)
    expect(rendered).toEqual(['newest event', 'middle event', 'oldest event'])
  })

  it('keeps trace (dev) groups chronological — #1 is the oldest event', () => {
    render(
      <ActivityPanel open dev feed={feed()} workflows={wf} onClose={vi.fn()} />
    )
    // Switch to the dev Trace view.
    fireEvent.click(screen.getByRole('tab', { name: 'Trace' }))
    // The single group holds all three events; #1 must be the oldest.
    const seqs = screen.getAllByText(/^#\d+$/).map((el) => el.textContent)
    expect(seqs).toEqual(['#1', '#2', '#3'])
    const summaries = screen.getAllByText(/event$/).map((el) => el.textContent)
    expect(summaries).toEqual(['oldest event', 'middle event', 'newest event'])
  })
})
```

- [ ] **Step 2: Run the new test — expect FAIL.** From the repo root:

```bash
yarn test packages/react/src/components/ActivityPanel/ActivityPanel.test.tsx
```

Expected: the first test FAILS — the current code renders `list` oldest→newest, so `getAllByText(/event$/)` returns `['oldest event', 'middle event', 'newest event']`, not `['newest event', 'middle event', 'oldest event']`. (The second test — trace chronological — should already PASS, since trace order isn't changing; that's intentional: it locks the trace order as a regression guard.)

> Note on the Segmented selector: the `Segmented` primitive renders options as `role="tab"` with `aria-label="View"`. If `getByRole('tab', { name: 'Trace' })` does not match at run time, open `packages/react/src/primitives/Segmented/Segmented.tsx` to read the exact role/aria it emits and adjust the query (e.g. `getByText('Trace')` on the toggle) — do NOT change the component to satisfy the test.

---

### Task 2: Reverse the operator feed and flip auto-follow to the top

**Files:**
- `packages/react/src/components/ActivityPanel/ActivityPanel.tsx` (modify: the doc comment ~lines 16-21; the `list` derivation + filters ~lines 130-132; the auto-follow `useEffect` ~lines 134-139; `onScroll` ~lines 141-146; the trace grouping ~lines 148-160; the operator render branch ~lines 226-237)
- `packages/react/src/components/ActivityPanel/ActivityPanel.module.scss` (modify: add `.act-feed-cue`)

Key constraint: the trace grouping at `ActivityPanel.tsx:148-160` iterates `list` to build groups in insertion order, and `TraceGroup` numbers events `#{i+1}` from each group's `events` array. To keep trace chronological, the grouping MUST iterate the chronological (un-reversed) `list`. So we reverse a SEPARATE variable used only by the operator render, leaving `list` chronological for grouping.

- [ ] **Step 1: Update the component doc comment to state newest-first.** In `ActivityPanel.tsx`, replace the block at lines 16-21:

```tsx
// The observability surface. Operator mode = a chronological feed of meaningful
// events (status-colored marker, time, workflow + agent, summary), newest at the
// bottom, auto-following the live SSE. Dev mode (?dev=1) adds a Trace view —
// the same events grouped by work item, dense + monospace, collapsible. Both
// share filters (by workflow; by kind), the empty state, and the live/reconnecting
// chip. Generic over the workflow set so the package owns no vertical labels.
```

with:

```tsx
// The observability surface. Operator mode = a reverse-chronological feed of
// meaningful events (status-colored marker, time, workflow + agent, summary),
// NEWEST at the TOP, auto-following the live SSE by pinning to the top (new
// events push older ones down). Dev mode (?dev=1) adds a Trace view — the same
// events grouped by work item, dense + monospace, collapsible; within a group
// the order stays chronological (#1..#n). Both share filters (by workflow; by
// kind), the empty state, and the live/reconnecting chip. Generic over the
// workflow set so the package owns no vertical labels.
```

- [ ] **Step 2: Derive a reversed operator list, keeping `list` chronological for grouping.** In `ActivityPanel.tsx`, replace lines 130-132:

```tsx
  let list = events
  if (wfFilter !== 'all') list = list.filter((e) => e.workflowId === wfFilter)
  if (kindFilter !== 'all') list = list.filter((e) => e.kind === kindFilter)
```

with:

```tsx
  let list = events
  if (wfFilter !== 'all') list = list.filter((e) => e.workflowId === wfFilter)
  if (kindFilter !== 'all') list = list.filter((e) => e.kind === kindFilter)

  // Operator feed shows NEWEST first; the trace grouping below keeps the
  // chronological `list` so each group's #1..#n stays oldest→newest.
  const operatorList = [...list].reverse()
```

- [ ] **Step 3: Flip auto-follow + the pin threshold to the TOP.** In `ActivityPanel.tsx`, replace the auto-follow effect + `onScroll` at lines 134-146:

```tsx
  // auto-follow the tail while pinned to the bottom
  useEffect(() => {
    if (!open || !following) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [events, open, following, mode, wfFilter, kindFilter])

  // Scrolling up pauses auto-follow so the live tail doesn't yank the operator down.
  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 48)
  }
```

with:

```tsx
  // Newest is at the top, so auto-follow pins to the TOP: new events appear
  // above and the operator stays at the head of the feed.
  useEffect(() => {
    if (!open || !following) return
    const el = scrollRef.current
    if (el) el.scrollTop = 0
  }, [events, open, following, mode, wfFilter, kindFilter])

  // Scrolling DOWN to read history pauses auto-follow so the live tail doesn't
  // yank the operator back to the top.
  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    setFollowing(el.scrollTop < 48)
  }
```

- [ ] **Step 4: Render the reversed list in the operator branch.** In `ActivityPanel.tsx`, the render branch at line 236 currently reads:

```tsx
          list.map((e, i) => <ActivityRow key={i} e={e} wfLabel={labelOf(e.workflowId)} />)
```

Replace it with (keyed by a stable identity so React reuses rows correctly as new events prepend — `key={i}` over a reversed array reassigns every key on each new event):

```tsx
          operatorList.map((e) => (
            <ActivityRow
              key={`${e.workItemId}:${e.ts}:${e.kind}`}
              e={e}
              wfLabel={labelOf(e.workflowId)}
            />
          ))
```

- [ ] **Step 5: Add the "newest first" cue in operator mode.** In `ActivityPanel.tsx`, find the feed container open tag at line 226:

```tsx
      <div className={clsx(s.actFeed, isTrace && s.traceFeed)} ref={scrollRef} onScroll={onScroll}>
```

Immediately AFTER the `<div className={s.actFilters}>…</div>` block (which ends at line 224, just before line 226's feed div) and BEFORE the feed div, insert the cue (shown only in operator mode and only when there are events):

```tsx
      {!isTrace && !empty && <div className={s.actFeedCue}>Newest first</div>}

      <div className={clsx(s.actFeed, isTrace && s.traceFeed)} ref={scrollRef} onScroll={onScroll}>
```

(`empty` is computed at line 162: `const empty = list.length === 0`. It is in scope here.)

- [ ] **Step 6: Add the `.act-feed-cue` style.** In `packages/react/src/components/ActivityPanel/ActivityPanel.module.scss`, insert this block immediately after the `.act-filters { … }` rule (which ends at line 98), before `.act-filter-ico`:

```scss
// "Newest first" hint above the operator feed (operator mode only).
.act-feed-cue {
  flex: 0 0 auto;
  padding: 6px 18px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--muted-2);
  border-bottom: 1px solid var(--border);
}
```

(`--muted-2` and `--border` are the same tokens already used in this file — see `.act-filters` line 97 and `.act-dot-sep` line 212 — so no new token is introduced. `camelCaseOnly` camelizes `.act-feed-cue` → `actFeedCue`, matching the `s.actFeedCue` reference in Step 5.)

- [ ] **Step 7: Run the test — expect PASS.** From the repo root:

```bash
yarn test packages/react/src/components/ActivityPanel/ActivityPanel.test.tsx
```

Expected: both tests PASS. The operator test now reads `['newest event', 'middle event', 'oldest event']`; the trace test still reads `['#1', '#2', '#3']` / `['oldest event', 'middle event', 'newest event']` (grouping iterates the chronological `list`, unchanged).

- [ ] **Step 8: Commit.** From the repo root:

```bash
git add packages/react/src/components/ActivityPanel/ActivityPanel.tsx \
        packages/react/src/components/ActivityPanel/ActivityPanel.module.scss \
        packages/react/src/components/ActivityPanel/ActivityPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(activity): operator feed newest-first with top-pinned auto-follow

Flip the ActivityPanel operator (Activity) feed to render newest events at
the top; auto-follow now pins to the top and scrolling down pauses it. The
dev Trace grouped view keeps its chronological #1..#n order (grouping
iterates the un-reversed list). Adds a "Newest first" cue and a render test.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Green gate — full workspace verification + package build

**Files:** none modified (verification only).

- [ ] **Step 1: Typecheck.** From the repo root:

```bash
yarn typecheck
```

Expected: exits 0 (tsc --build composite project references, no errors). The `key` template literal and `[...list].reverse()` are plainly typed; `operatorList` is `ActivityEntry[]`.

- [ ] **Step 2: Full test suite.** From the repo root:

```bash
yarn test
```

Expected: all tests pass (450+), including the new `ActivityPanel.test.tsx`. No other test references operator-feed ordering, so nothing else should change.

- [ ] **Step 3: Lint.** From the repo root:

```bash
yarn lint
```

Expected: GREEN (0 errors). Watch for an unused-var warning if any prior `list.map` reference was missed — the only operator render now uses `operatorList`; `list` is still used by the trace grouping at lines 148-160, so it stays referenced.

- [ ] **Step 4: Format check.** From the repo root:

```bash
yarn format:check
```

Expected: all matched files use Prettier code style. If it fails, run `yarn format` and re-commit (amend Task 2's commit or add a `style:` follow-up commit).

- [ ] **Step 5: Build `@atizar/react` (required — this WS changes the package).** From the repo root:

```bash
yarn workspace @atizar/react build
```

Expected: Vite library-mode build succeeds — emits `packages/react/dist/index.js`, the rolled-up `.d.ts`, and a compiled `react.css` that now contains the `.act-feed-cue` rule. No build errors. (The monorepo consumes `./src` in dev via the `development` export condition, but npm publication resolves `dist`, so a package CSS/JS change MUST build clean — see CLAUDE.md "Build step" note.)

- [ ] **Step 6: Commit any formatting fixups (only if Step 4 required `yarn format`).** From the repo root:

```bash
git add packages/react/src/components/ActivityPanel/ActivityPanel.tsx \
        packages/react/src/components/ActivityPanel/ActivityPanel.module.scss \
        packages/react/src/components/ActivityPanel/ActivityPanel.test.tsx
git commit -m "$(cat <<'EOF'
style(activity): prettier formatting for newest-first feed

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

(Skip if `yarn format:check` already passed in Step 4. Do NOT commit the `packages/react/dist/` build artifacts — `dist` is the build output, listed in `files` for publish, not source to commit on a feature branch.)

---

## Done when

Acceptance criteria, copied verbatim from spec §2 WS4:

- [ ] Newest event appears at the top and stays in view as events arrive.
- [ ] Scrolling down to read history pauses auto-follow.
- [ ] Green gate: `yarn typecheck` && `yarn test` && `yarn lint` && `yarn format:check`, plus `yarn workspace @atizar/react build` (this WS changes `@atizar/react`).
- [ ] Browser-verified (see below).

Plus the WS4-specific invariant from the decision: the Trace (dev) grouped view keeps within-group chronological order (#1..#n) — only the operator feed order flips. (Asserted by the second test in `ActivityPanel.test.tsx`.)

## Browser-verify

This project's hard rule: drive the real app and confirm in-browser (reload-masking bugs only the browser catches — scroll behavior and live SSE ordering are exactly that class). Invoke the `browser-verify` skill first (it owns dev-server hygiene: freeing `:4000`/`:5173`, the `tsx watch` child, Playwright-MCP profile-lock recovery).

1. Start the stack from the repo root: `yarn dev` (server :4000 + client :5173, `/api` proxied).
2. Open the app, open the **Activity** drawer (operator mode, no `?dev=1`).
3. Trigger a workflow START (e.g. `email-inbox`) so live events stream in. Confirm: the newest event renders at the **TOP**, the "Newest first" cue shows, and as new SSE events arrive they appear at the top and the feed stays pinned to the head (does not jump to the bottom).
4. Scroll DOWN into history; confirm auto-follow PAUSES (the feed does not yank back to the top when a new event arrives). Scroll back up to the top; confirm auto-follow resumes.
5. Append `?dev=1`, reopen the drawer, switch to **Trace**: confirm each work-item group still numbers events `#1..#n` oldest→newest (the operator flip did NOT reverse trace order).
6. Reload the page mid-stream and re-confirm step 3's top-most ordering holds against the primed snapshot (catches a reload-masking ordering bug).
