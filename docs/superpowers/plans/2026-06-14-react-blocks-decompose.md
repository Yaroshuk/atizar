# `@atizar/react` Block Decomposition (Plan A: tokens + decomposition) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `@atizar/react` from the `WorkflowBoard` monolith into composable, exported blocks driven by small headless hooks, with a namespaced `--atz-*` token layer — behavior- and DOM-identical, fully testable.

**Architecture:** Extract the ~170 lines of orchestration in `WorkflowBoard.tsx`'s `BoardInner` into three single-purpose hooks (`useWorkflowSelection`, `useBoardNavigation`, `useStopController`) + a pure `lookups()` helper; export every visual block (incl. a new thin `AgentGrid`); delete `WorkflowBoard`; rebuild the board composition as `apps/inbox/client/src/BoardApp.tsx` (the reference example). Add `tokens.css` (`--atz-*`, two tiers) and alias the existing 29 vars to it so `styles.css`'s 301 `var()` uses keep working unchanged.

**Tech Stack:** TypeScript, React 19, Vite, vitest + @testing-library/react (`renderHook`/`render`), CSS custom properties.

**Scope of THIS plan (A):** tokens + JS decomposition. **NOT in A** (deferred to Plan B): moving block CSS into `*.module.scss`, the Vite lib build, `exports → dist`, reversing the no-build-step doc. Blocks keep referencing the existing global class names in `styles.css`; only the CSS *variables* get namespaced here.

**Reference source of truth:** `packages/react/src/WorkflowBoard.tsx` (the current monolith — every hook body and the BoardApp composition below is extracted from it). Read it before each extraction task.

**Run from repo root:** `yarn test`, `yarn typecheck`, `yarn lint`. Vitest single-file: `yarn test <path>` (root config globs `packages/*/src/**`).

---

## File Structure

**Create (package, `packages/react/src/`):**
- `tokens.css` — Tier-1 primitives + Tier-2 semantic `--atz-*` vars (`:root`).
- `lookups.ts` — pure config→helpers factory (`defOf/roleOf/nameOf/metaIcon/stripAgent/labelOf` + `workflow`).
- `lookups.test.ts` — unit tests for `lookups`.
- `hooks/useWorkflowSelection.ts` — active workflow, cross-workflow unread, active counts.
- `hooks/useWorkflowSelection.test.ts`
- `hooks/useBoardNavigation.ts` — open/type/picker nav, `openAgent`, `startInput`, `?open=` URL sync, resolution + `notesFor`.
- `hooks/useBoardNavigation.test.ts`
- `hooks/useStopController.ts` — confirm state, stopping flags, `confirmStop`, request helpers.
- `hooks/useStopController.test.ts`
- `components/AgentGrid.tsx` — the agent-card grid (extracted from `WorkflowBoard.tsx:263-297`).

**Modify (package):**
- `index.ts` — export the 3 hooks, `lookups`, the pure models, and the 6 currently-internal blocks + `AgentGrid`; **remove** the `WorkflowBoard` export.
- `styles.css` — `@import './tokens.css';` at the top; replace the 29 var definitions in `:root` with aliases to `--atz-*`.
- `package.json` — add `"./tokens.css": "./src/tokens.css"` to `exports`.

**Delete (package):**
- `WorkflowBoard.tsx` (+ its test if any).

**Create (demo, `apps/inbox/client/src/`):**
- `BoardApp.tsx` — composes `WorkflowsProvider` + the 3 hooks + blocks (the former `BoardInner` body).

**Modify (demo):**
- `App.tsx` — render `<BoardApp config={workflowsConfig} />` instead of `<WorkflowBoard … />`.

**Docs (this plan, last task):**
- `CLAUDE.md` / `docs/ARCHITECTURE.md` — make the `--atz-*` token claim true (tokens.css now exists). (No-build-step reversal is Plan B.)

---

## Task 1: Namespaced token layer (`tokens.css`)

**Files:**
- Create: `packages/react/src/tokens.css`
- Modify: `packages/react/src/styles.css` (top `@import` + the `:root` block, currently `:root { --bg … --sidebar-w }`)
- Modify: `packages/react/package.json` (`exports`)

CSS is not unit-tested in this repo; verification is "the app renders identically" (browser, Task 9). This task is behavior-neutral by construction: the old var names remain, now aliased to `--atz-*`.

- [ ] **Step 1: Create `tokens.css` with the two tiers**

```css
/* @atizar/react design tokens — the public customization surface.
   Tier 1 = raw scale (components never reference directly).
   Tier 2 = semantic (the only layer components use; references Tier 1).
   Override any --atz-* in your own CSS to re-theme; custom properties cascade. */
:root {
  /* Tier 1 — palette */
  --atz-teal-500: #00aa77;
  --atz-teal-600: #008a61;
  --atz-teal-tint: rgba(0, 170, 119, 0.1);
  --atz-teal-tint-2: rgba(0, 170, 119, 0.06);
  --atz-amber-bg: #fffbe6;
  --atz-amber-border: #f0c000;
  --atz-amber-ink: #8a6d00;
  --atz-grey-50: #f5f5f7;
  --atz-grey-300: #c4c4c8;
  --atz-grey-900: #111111;
  --atz-red-ink: #c0392b;

  /* Tier 1 — radius / shadow / type / size */
  --atz-radius-sm: 8px;
  --atz-radius-md: 12px;
  --atz-radius-lg: 16px;
  --atz-radius-xl: 22px;
  --atz-shadow-card: 0 1px 2px rgba(17, 17, 17, 0.04), 0 6px 16px rgba(17, 17, 17, 0.035);
  --atz-shadow-card-hover: 0 2px 4px rgba(17, 17, 17, 0.05), 0 12px 30px rgba(17, 17, 17, 0.07);
  --atz-shadow-pop: 0 1px 2px rgba(17, 17, 17, 0.05), 0 4px 14px rgba(17, 17, 17, 0.06);
  --atz-shadow-modal: 0 30px 80px rgba(17, 17, 17, 0.28), 0 8px 24px rgba(17, 17, 17, 0.16);
  --atz-font-sans:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, system-ui, sans-serif;
  --atz-size-sidebar: 248px;

  /* Tier 2 — semantic */
  --atz-color-bg: var(--atz-grey-50);
  --atz-color-surface: #ffffff;
  --atz-color-text: var(--atz-grey-900);
  --atz-color-text-muted: #888888;
  --atz-color-text-subtle: #a8a8ac;
  --atz-color-border: #ececec;
  --atz-color-border-strong: #e2e2e4;
  --atz-color-accent: var(--atz-teal-500);
  --atz-color-accent-ink: #0a7;
  --atz-color-accent-deep: var(--atz-teal-600);
  --atz-color-danger: var(--atz-red-ink);

  /* Tier 2 — board statuses (one source for dots + badges) */
  --atz-status-running: var(--atz-color-accent);
  --atz-status-awaiting: var(--atz-amber-border);
  --atz-status-error: var(--atz-color-danger);
  --atz-status-idle: var(--atz-grey-300);
}
```

- [ ] **Step 2: Alias the old var names to `--atz-*` in `styles.css`**

At the very top of `packages/react/src/styles.css` add the import, then replace the existing `:root { … }` block (the 29 old definitions) with aliases so the 301 existing `var(--old)` uses keep resolving:

```css
@import './tokens.css';

:root {
  --bg: var(--atz-color-bg);
  --surface: var(--atz-color-surface);
  --text: var(--atz-color-text);
  --muted: var(--atz-color-text-muted);
  --muted-2: var(--atz-color-text-subtle);
  --border: var(--atz-color-border);
  --border-strong: var(--atz-color-border-strong);
  --teal: var(--atz-color-accent);
  --teal-ink: var(--atz-color-accent-ink);
  --teal-deep: var(--atz-color-accent-deep);
  --teal-tint: var(--atz-teal-tint);
  --teal-tint-2: var(--atz-teal-tint-2);
  --grey-dot: var(--atz-grey-300);
  --amber-bg: var(--atz-amber-bg);
  --amber-border: var(--atz-amber-border);
  --amber-ink: var(--atz-amber-ink);
  --red-ink: var(--atz-red-ink);
  --r-sm: var(--atz-radius-sm);
  --r: var(--atz-radius-md);
  --r-lg: var(--atz-radius-lg);
  --r-xl: var(--atz-radius-xl);
  --shadow-card: var(--atz-shadow-card);
  --shadow-card-hover: var(--atz-shadow-card-hover);
  --shadow-pop: var(--atz-shadow-pop);
  --shadow-modal: var(--atz-shadow-modal);
  --font: var(--atz-font-sans);
  --sidebar-w: var(--atz-size-sidebar);
  --accent: var(--atz-color-accent);
}
```

(If `styles.css` uses any old var not in the original 29 list, alias it too — grep `grep -oh "var(--[a-z0-9-]*" styles.css | sort -u` and ensure every name is defined above.)

- [ ] **Step 3: Export `tokens.css` from the package**

In `packages/react/package.json`, add to `exports`:
```json
    "./tokens.css": "./src/tokens.css"
```

- [ ] **Step 4: Verify nothing broke**

Run: `yarn typecheck` — Expected: PASS (CSS doesn't affect TS).
Run: `grep -c "var(--" packages/react/src/styles.css` — Expected: unchanged count (~301).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/tokens.css packages/react/src/styles.css packages/react/package.json
git commit -m "feat(react): add --atz-* two-tier token layer; alias legacy vars"
```

---

## Task 2: `lookups()` pure helper

**Files:**
- Create: `packages/react/src/lookups.ts`
- Test: `packages/react/src/lookups.test.ts`

Extracts the per-agent lookups from `WorkflowBoard.tsx:76,86-97`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { lookups } from './lookups'
import type { WorkflowsConfig } from './workflowsContext'
import type { WorkItem } from './serverTypes'

const cfg = {
  workflows: [
    {
      id: 'lead-inbox',
      label: 'Lead inbox',
      agents: [
        { agent: { id: 'qualifier', name: 'LEAD QUALIFIER' }, role: 'input' },
        { agent: { id: 'reply', name: 'REPLY AGENT' }, role: 'worker' },
      ],
    },
  ],
  meta: { qualifier: { iconName: 'inbox' }, reply: { iconName: 'reply' } },
  renders: [],
  hitl: [],
} as unknown as WorkflowsConfig

const wi = (over: Partial<WorkItem>): WorkItem =>
  ({ id: 'w1', workflowId: 'lead-inbox', agentId: 'lead-inbox__reply', payload: {}, ...over }) as WorkItem

describe('lookups', () => {
  it('resolves role, name, icon, stripped agent id, and label', () => {
    const lk = lookups(cfg, 'lead-inbox')
    expect(lk.roleOf('qualifier')).toBe('input')
    expect(lk.nameOf('reply')).toBe('REPLY AGENT')
    expect(lk.nameOf('unknown')).toBe('unknown')
    expect(lk.metaIcon('reply')).toBe('reply')
    expect(lk.metaIcon('missing')).toBe('inbox')
    expect(lk.stripAgent(wi({}))).toBe('reply')
  })
  it('labels by issue number, else from/subject', () => {
    const lk = lookups(cfg, 'lead-inbox')
    expect(lk.labelOf(wi({ payload: { number: 5, title: 'Bug' } }))).toBe('#5 · Bug')
    expect(lk.labelOf(wi({ payload: { from: 'a@b.com' } }))).toBe('a@b.com')
    expect(lk.labelOf(wi({ payload: { subject: 'Hi' } }))).toBe('Hi')
  })
})
```

- [ ] **Step 2: Run it — Expected: FAIL (`lookups` not found)**

Run: `yarn test packages/react/src/lookups.test.ts`

- [ ] **Step 3: Implement `lookups.ts`** (extracted verbatim from `WorkflowBoard.tsx:76,87-97`)

```ts
import type { AgentDefinition } from '@atizar/core'
import type { WorkItem } from './serverTypes'
import type { WorkflowsConfig } from './workflowsContext'

// Pure per-agent chrome lookups derived from the workflows config + the active workflow id.
export function lookups(config: WorkflowsConfig, activeWorkflowId: string) {
  const { workflows, meta: META } = config
  const workflow = workflows.find((w) => w.id === activeWorkflowId) ?? workflows[0]

  const defOf = (wfId: string, agentId: string): AgentDefinition | undefined =>
    workflows.find((w) => w.id === wfId)?.agents.find((a) => a.agent.id === agentId)?.agent
  const roleOf = (agentId: string) => workflow.agents.find((a) => a.agent.id === agentId)?.role
  const nameOf = (agentId: string) => defOf(workflow.id, agentId)?.name ?? agentId
  const metaIcon = (agentId: string) => META[agentId]?.iconName ?? 'inbox'
  const stripAgent = (w: WorkItem) => w.agentId.slice(w.workflowId.length + 2)
  const labelOf = (w: WorkItem): string => {
    const p = w.payload as { number?: number; title?: string; subject?: string; from?: string }
    if (typeof p.number === 'number') return `#${p.number}${p.title ? ` · ${p.title}` : ''}`
    return p.from ?? p.subject ?? ''
  }
  return { workflow, defOf, roleOf, nameOf, metaIcon, stripAgent, labelOf }
}
```

- [ ] **Step 4: Run it — Expected: PASS**

Run: `yarn test packages/react/src/lookups.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/lookups.ts packages/react/src/lookups.test.ts
git commit -m "feat(react): extract pure lookups() helper from WorkflowBoard"
```

---

## Task 3: `useWorkflowSelection` hook

**Files:**
- Create: `packages/react/src/hooks/useWorkflowSelection.ts`
- Test: `packages/react/src/hooks/useWorkflowSelection.test.ts`

Extracts `WorkflowBoard.tsx:25-38` (ACTIVE_SERVER + isCrossWorkflowChild), `:55` (activeWorkflowId), `:70` (seenRef), `:110-123` (unread + counts), `:145-154` (switchWorkflow — **minus** the open-state resets, which move to navigation). The demo calls `nav.reset()` alongside `switchWorkflow` (Task 7).

- [ ] **Step 1: Write the failing test** (mock `useBoard`)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const items: any[] = []
vi.mock('./useBoard', () => ({ useBoard: () => ({ items, agentHealth: {} }) }))
import { useWorkflowSelection } from './useWorkflowSelection'

const cfg: any = { workflows: [{ id: 'a' }, { id: 'b' }], meta: {}, renders: [], hitl: [] }

describe('useWorkflowSelection', () => {
  beforeEach(() => {
    items.length = 0
  })
  it('defaults to the first workflow and counts active items', () => {
    items.push({ id: '1', workflowId: 'a', status: 'running' })
    items.push({ id: '2', workflowId: 'b', status: 'finished' })
    const { result } = renderHook(() => useWorkflowSelection(cfg))
    expect(result.current.activeWorkflowId).toBe('a')
    expect(result.current.globalActive).toBe(1)
    expect(result.current.workflowActiveCount).toBe(1)
  })
  it('badges unseen cross-workflow children, clears them on switch', () => {
    items.push({ id: 'p', workflowId: 'a', status: 'finished' })
    items.push({ id: 'c', workflowId: 'b', status: 'running', parentId: 'p' })
    const { result } = renderHook(() => useWorkflowSelection(cfg))
    expect(result.current.unread.b).toBe(1)
    act(() => result.current.switchWorkflow('b'))
    expect(result.current.activeWorkflowId).toBe('b')
    expect(result.current.unread.b ?? 0).toBe(0)
  })
})
```

- [ ] **Step 2: Run it — Expected: FAIL (not found)**

Run: `yarn test packages/react/src/hooks/useWorkflowSelection.test.ts`

- [ ] **Step 3: Implement the hook**

```ts
import { useRef, useState } from 'react'
import { useBoard } from './useBoard'
import type { ServerStatus, WorkItem } from '../serverTypes'
import type { WorkflowsConfig } from '../workflowsContext'

// Server statuses that count as "active" (occupy the operator / a worker slot).
const ACTIVE_SERVER: ReadonlySet<ServerStatus> = new Set([
  'queued',
  'running',
  'awaiting_approval',
  'awaiting_input',
])

// A cross-workflow child = a work item whose parent lives in a DIFFERENT workflow.
const isCrossWorkflowChild = (w: WorkItem, parentOf: (id: string) => WorkItem | undefined) => {
  if (!w.parentId) return false
  const parent = parentOf(w.parentId)
  return parent !== undefined && parent.workflowId !== w.workflowId
}

export function useWorkflowSelection(config: WorkflowsConfig) {
  const board = useBoard()
  const [activeWorkflowId, setActiveWorkflowId] = useState(config.workflows[0].id)
  const seenRef = useRef<Set<string>>(new Set())
  const itemById = (id: string) => board.items.find((w) => w.id === id)

  const unread: Record<string, number> = {}
  for (const w of board.items) {
    if (w.workflowId === activeWorkflowId) continue
    if (isCrossWorkflowChild(w, itemById) && !seenRef.current.has(w.id)) {
      unread[w.workflowId] = (unread[w.workflowId] ?? 0) + 1
    }
  }
  const globalActive = board.items.filter((w) => ACTIVE_SERVER.has(w.status)).length
  const workflowActiveCount = board.items.filter(
    (w) => w.workflowId === activeWorkflowId && ACTIVE_SERVER.has(w.status)
  ).length

  // Switch the active workflow; mark its current cross-workflow children seen (clears its badge).
  // The open-thread reset is the navigation hook's job — the demo calls nav.reset() alongside this.
  const switchWorkflow = (id: string): void => {
    for (const w of board.items) {
      if (w.workflowId === id && isCrossWorkflowChild(w, itemById)) seenRef.current.add(w.id)
    }
    setActiveWorkflowId(id)
  }

  return { activeWorkflowId, switchWorkflow, unread, globalActive, workflowActiveCount }
}
```

- [ ] **Step 4: Run it — Expected: PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/useWorkflowSelection.ts packages/react/src/hooks/useWorkflowSelection.test.ts
git commit -m "feat(react): extract useWorkflowSelection hook"
```

---

## Task 4: `useBoardNavigation` hook

**Files:**
- Create: `packages/react/src/hooks/useBoardNavigation.ts`
- Test: `packages/react/src/hooks/useBoardNavigation.test.ts`

Extracts `WorkflowBoard.tsx:56-61` (open/type/picker state), `:79-84` (URL sync), `:99-103` (pInstances/liveOf), `:125-143` (startInput/openAgent), `:183-214` (notesFor + resolution). Depends on `useBoard`, `useDispatch().start`, `lookups`, and the pure models (`toPInstances`, `instanceId`).

- [ ] **Step 1: Write the failing test** (mock data hooks)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

let items: any[] = []
const start = vi.fn(async () => 'new-id')
vi.mock('./useBoard', () => ({ useBoard: () => ({ items, agentHealth: {} }) }))
vi.mock('./useDispatch', () => ({ useDispatch: () => ({ start }) }))
import { useBoardNavigation } from './useBoardNavigation'

const cfg: any = {
  workflows: [
    { id: 'a', agents: [{ agent: { id: 'reply', name: 'R' }, role: 'worker' }] },
  ],
  meta: { reply: { iconName: 'inbox' } },
  renders: [],
  hitl: [],
}

describe('useBoardNavigation', () => {
  beforeEach(() => {
    items = []
    start.mockClear()
    window.history.replaceState(null, '', '/')
  })
  it('openAgent: 0 live → type view, 1 → its thread, ≥2 → picker', () => {
    const { result, rerender } = renderHook(() => useBoardNavigation(cfg, 'a'))
    act(() => result.current.openAgent('reply'))
    expect(result.current.openTypeId).toBe('reply')

    items = [{ id: 'x', localId: 'a__reply#1', workflowId: 'a', agentId: 'a__reply', status: 'running', payload: {} }]
    rerender()
    act(() => result.current.openAgent('reply'))
    expect(result.current.openId).toBe('a__reply#1')

    items = [
      { id: 'x', localId: 'a__reply#1', workflowId: 'a', agentId: 'a__reply', status: 'running', payload: {} },
      { id: 'y', localId: 'a__reply#2', workflowId: 'a', agentId: 'a__reply', status: 'running', payload: {} },
    ]
    rerender()
    act(() => result.current.openAgent('reply'))
    expect(result.current.openPickerId).toBe('reply')
  })
  it('writes the open id into the ?open= URL', () => {
    items = [{ id: 'x', localId: 'a__reply#1', workflowId: 'a', agentId: 'a__reply', status: 'running', payload: {} }]
    const { result } = renderHook(() => useBoardNavigation(cfg, 'a'))
    act(() => result.current.setOpenId('x'))
    expect(new URLSearchParams(window.location.search).get('open')).toBe('x')
  })
})
```

- [ ] **Step 2: Run it — Expected: FAIL (not found)**

- [ ] **Step 3: Implement the hook** (extracted + adjusted from `WorkflowBoard.tsx`)

```ts
import { useEffect, useState } from 'react'
import { instanceId, type AgentDefinition } from '@atizar/core'
import { useBoard } from './useBoard'
import { useDispatch } from './useDispatch'
import { lookups } from '../lookups'
import { toPInstances } from '../boardModel'
import type { WorkItem } from '../serverTypes'
import type { WorkflowsConfig } from '../workflowsContext'

export type HandoffNote = {
  dir: 'received' | 'sent'
  otherName: string
  label: string
  targetWorkflow?: string
  targetLocalId?: string
}

export function useBoardNavigation(config: WorkflowsConfig, activeWorkflowId: string) {
  const board = useBoard()
  const { start } = useDispatch()
  const { workflow, defOf, roleOf, nameOf, metaIcon, stripAgent, labelOf } = lookups(
    config,
    activeWorkflowId
  )

  const [openId, setOpenId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('open')
  )
  const [openTypeId, setOpenTypeId] = useState<string | null>(null)
  const [openPickerId, setOpenPickerId] = useState<string | null>(null)

  // Persist the open id into the URL so a reload re-attaches (survives the SSE re-subscribe).
  useEffect(() => {
    const url = new URL(window.location.href)
    if (openId) url.searchParams.set('open', openId)
    else url.searchParams.delete('open')
    window.history.replaceState(null, '', url)
  }, [openId])

  const itemById = (id: string): WorkItem | undefined => board.items.find((w) => w.id === id)
  const pInstances = toPInstances(board.items, workflow.id, roleOf, metaIcon, nameOf, labelOf)
  const liveOf = (agentId: string) => pInstances.filter((p) => p.agentId === agentId)
  const canStart = (agentId: string) => roleOf(agentId) === 'input'

  const startInput = (agentDef: AgentDefinition): void => {
    void start(instanceId(workflow.id, agentDef.id)).then((id) => {
      setOpenTypeId(null)
      setOpenId(id)
    })
  }

  const openAgent = (agentId: string): void => {
    const live = liveOf(agentId)
    setOpenTypeId(null)
    setOpenPickerId(null)
    setOpenId(null)
    if (live.length === 0) setOpenTypeId(agentId)
    else if (live.length === 1) setOpenId(live[0].localId)
    else setOpenPickerId(agentId)
  }

  // Reset all open state (the demo calls this when switching workflows).
  const reset = (): void => {
    setOpenId(null)
    setOpenTypeId(null)
    setOpenPickerId(null)
  }

  const notesFor = (id: string): HandoffNote[] => {
    const item = itemById(id)
    if (!item) return []
    const notes: HandoffNote[] = []
    if (item.parentId) {
      const parent = itemById(item.parentId)
      if (parent)
        notes.push({ dir: 'received', otherName: nameOf(stripAgent(parent)), label: labelOf(item) })
    }
    for (const child of board.items.filter((w) => w.parentId === id)) {
      notes.push({
        dir: 'sent',
        otherName: nameOf(stripAgent(child)),
        label: labelOf(child),
        targetWorkflow: child.workflowId !== workflow.id ? child.workflowId : undefined,
        targetLocalId: child.workflowId === workflow.id ? child.id : undefined,
      })
    }
    return notes
  }

  const openItem = openId ? itemById(openId) : undefined
  const openTypeAgent = openTypeId ? defOf(workflow.id, openTypeId) : undefined
  const pickerInstances = openPickerId ? liveOf(openPickerId) : []

  return {
    openId,
    setOpenId,
    openTypeId,
    setOpenTypeId,
    openPickerId,
    setOpenPickerId,
    openItem,
    openTypeAgent,
    pickerInstances,
    pInstances,
    liveOf,
    canStart,
    openAgent,
    startInput,
    reset,
    notesFor,
    // re-exported lookups the demo blocks need
    workflow,
    defOf,
    nameOf,
    metaIcon,
    stripAgent,
    labelOf,
  }
}
```

> Note: `stripAgent` takes a `WorkItem`; `notesFor` calls `nameOf(stripAgent(parent))` — matches the original `WorkflowBoard.tsx:194,199` which inlined `parent.agentId.slice(parent.workflowId.length + 2)`. Verify against source.

- [ ] **Step 4: Run it — Expected: PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/useBoardNavigation.ts packages/react/src/hooks/useBoardNavigation.test.ts
git commit -m "feat(react): extract useBoardNavigation hook"
```

---

## Task 5: `useStopController` hook

**Files:**
- Create: `packages/react/src/hooks/useStopController.ts`
- Test: `packages/react/src/hooks/useStopController.test.ts`

Extracts `WorkflowBoard.tsx:41` (Confirm type), `:62-68` (confirm + stopping state), `:156-181` (confirmStop). Depends on `useDispatch()` (`cancel`/`cancelWorkflow`/`cancelAll`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const cancel = vi.fn(async () => {})
const cancelWorkflow = vi.fn(async () => {})
const cancelAll = vi.fn(async () => {})
vi.mock('./useDispatch', () => ({
  useDispatch: () => ({ cancel, cancelWorkflow, cancelAll }),
}))
import { useStopController } from './useStopController'

describe('useStopController', () => {
  beforeEach(() => {
    cancel.mockClear()
    cancelWorkflow.mockClear()
    cancelAll.mockClear()
  })
  it('requesting a scope sets confirm; confirming an item cancels it', async () => {
    const { result } = renderHook(() => useStopController('wf-a'))
    act(() => result.current.requestStopItem('w1'))
    expect(result.current.confirm).toEqual({ kind: 'item', id: 'w1' })
    await act(async () => {
      await result.current.confirmStop()
    })
    expect(cancel).toHaveBeenCalledWith('w1')
    expect(result.current.confirm).toBeNull()
  })
  it('confirming workflow scope cancels the active workflow', async () => {
    const { result } = renderHook(() => useStopController('wf-a'))
    act(() => result.current.requestStopWorkflow())
    await act(async () => {
      await result.current.confirmStop()
    })
    expect(cancelWorkflow).toHaveBeenCalledWith('wf-a')
  })
})
```

- [ ] **Step 2: Run it — Expected: FAIL (not found)**

- [ ] **Step 3: Implement the hook**

```ts
import { useState } from 'react'
import { useDispatch } from './useDispatch'

type Confirm = { kind: 'item'; id: string } | { kind: 'workflow' } | { kind: 'all' } | null

export function useStopController(activeWorkflowId: string) {
  const { cancel, cancelWorkflow, cancelAll } = useDispatch()
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [stoppingItems, setStoppingItems] = useState<Record<string, boolean>>({})
  const [stoppingWorkflow, setStoppingWorkflow] = useState(false)
  const [stoppingAll, setStoppingAll] = useState(false)

  const requestStopItem = (id: string) => setConfirm({ kind: 'item', id })
  const requestStopWorkflow = () => setConfirm({ kind: 'workflow' })
  const requestStopAll = () => setConfirm({ kind: 'all' })
  const cancelConfirm = () => setConfirm(null)

  const confirmStop = async (): Promise<void> => {
    if (!confirm) return
    if (confirm.kind === 'item') {
      const { id } = confirm
      setStoppingItems((m) => ({ ...m, [id]: true }))
      setConfirm(null)
      await cancel(id)
      setStoppingItems((m) => {
        const rest = { ...m }
        delete rest[id]
        return rest
      })
      return
    }
    if (confirm.kind === 'workflow') {
      setStoppingWorkflow(true)
      await cancelWorkflow(activeWorkflowId)
      setStoppingWorkflow(false)
    } else {
      setStoppingAll(true)
      await cancelAll()
      setStoppingAll(false)
    }
    setConfirm(null)
  }

  return {
    confirm,
    stoppingItems,
    stoppingWorkflow,
    stoppingAll,
    requestStopItem,
    requestStopWorkflow,
    requestStopAll,
    cancelConfirm,
    confirmStop,
  }
}
```

- [ ] **Step 4: Run it — Expected: PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/useStopController.ts packages/react/src/hooks/useStopController.test.ts
git commit -m "feat(react): extract useStopController hook"
```

---

## Task 6: `AgentGrid` block

**Files:**
- Create: `packages/react/src/components/AgentGrid.tsx`
- Test: `packages/react/src/components/AgentGrid.test.tsx`

Extracts the agent-grid JSX from `WorkflowBoard.tsx:242-298` (the `CompHeader` "Your agents" + legend + `.agent-grid` mapping to `AgentCard`, incl. the `singletonBusy` derivation at `:271-278`). It receives plain props; the singleton-busy derivation stays here (pure over the props it's given).

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentGrid } from './AgentGrid'

const agents = [{ id: 'reply', name: 'REPLY AGENT', maxInstances: 2 }] as any
const cfg: any = { meta: { reply: { subtitle: 'sub', iconName: 'inbox' } } }

describe('AgentGrid', () => {
  it('renders one card per agent', () => {
    render(
      <AgentGrid
        agents={agents}
        meta={cfg.meta}
        items={[]}
        activeWorkflowId="a"
        aggOf={() => ({ status: 'idle' }) as any}
        healthOf={() => undefined}
        canStart={() => true}
        onStart={vi.fn()}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByText('REPLY AGENT')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it — Expected: FAIL (not found)**

- [ ] **Step 3: Implement `AgentGrid.tsx`** (move JSX from `WorkflowBoard.tsx:242-298`)

```tsx
import type { AgentDefinition } from '@atizar/core'
import { AgentCard } from './AgentCard'
import { CompHeader } from '../primitives/CompHeader'
import { aggregateLabel } from '../aggregate'
import type { AgentMeta } from '../renderSpecs'
import type { ServerStatus, WorkItem } from '../serverTypes'

const ACTIVE_SERVER: ReadonlySet<ServerStatus> = new Set([
  'queued',
  'running',
  'awaiting_approval',
  'awaiting_input',
])

type Agg = ReturnType<typeof import('../aggregate').aggregateAgent>

export const AgentGrid = ({
  agents,
  meta,
  items,
  activeWorkflowId,
  aggOf,
  healthOf,
  canStart,
  onStart,
  onOpen,
}: {
  agents: AgentDefinition[]
  meta: Record<string, AgentMeta>
  items: WorkItem[]
  activeWorkflowId: string
  aggOf: (agentId: string) => Agg
  healthOf: (agentId: string) => unknown
  canStart: (agentId: string) => boolean
  onStart: (agent: AgentDefinition) => void
  onOpen: (agentId: string) => void
}) => (
  <div className="main">
    <CompHeader
      icon="layers"
      label="Your agents"
      actions={
        <span className="legend">
          <span className="legend-item">
            <span className="dot idle" />
            Idle
          </span>
          <span className="legend-item">
            <span className="dot done" />
            Running / done
          </span>
          <span className="legend-item">
            <span className="dot awaiting_approval" />
            Awaiting approval
          </span>
        </span>
      }
    />
    <div className="main-scroll">
      <div className="agent-grid">
        {agents.map((agent) => {
          const agg = aggOf(agent.id)
          const singletonBusy =
            agent.maxInstances === 1 &&
            items.some(
              (w) =>
                w.workflowId === activeWorkflowId &&
                w.agentId.slice(w.workflowId.length + 2) === agent.id &&
                ACTIVE_SERVER.has(w.status)
            )
          return (
            <AgentCard
              key={agent.id}
              name={agent.name}
              subtitle={meta[agent.id].subtitle}
              iconName={meta[agent.id].iconName}
              status={agg.status}
              aggregateLabel={aggregateLabel(agg)}
              canStart={canStart(agent.id)}
              health={healthOf(agent.id) as never}
              startDisabled={singletonBusy}
              startDisabledReason={singletonBusy ? 'Already running' : undefined}
              onStart={() => onStart(agent)}
              onOpen={() => onOpen(agent.id)}
            />
          )
        })}
      </div>
    </div>
  </div>
)
```

> If `AgentCard`'s `health` prop type rejects `unknown`, type `healthOf`'s return as `AgentCard`'s `health` prop type (import it) rather than `unknown`/`never`. Read `AgentCard.tsx` for the exact type.

- [ ] **Step 4: Run it — Expected: PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/components/AgentGrid.tsx packages/react/src/components/AgentGrid.test.tsx
git commit -m "feat(react): extract AgentGrid block from WorkflowBoard"
```

---

## Task 7: Build the demo composition `BoardApp.tsx`

**Files:**
- Create: `apps/inbox/client/src/BoardApp.tsx`
- Modify: `apps/inbox/client/src/App.tsx`

This is the former `BoardInner` body, now in userland, wired to the new hooks + blocks. It is the reference composition. (Read `WorkflowBoard.tsx:216-395` for the exact JSX of each block's props — reproduce them, sourcing state/handlers from the hooks.)

- [ ] **Step 1: Write `BoardApp.tsx`**

```tsx
import { isDevMode } from '@atizar/react' // if not exported, import devMode flag via the package; see Task 8 note
import {
  WorkflowsProvider,
  AppHeader,
  PipelineColumn,
  AgentGrid,
  ThreadModal,
  AgentModal,
  InstancePickerModal,
  ActivityPanel,
  ConfirmDialog,
  useBoard,
  useHealth,
  useActivity,
  useDispatch,
  useWorkflowSelection,
  useBoardNavigation,
  useStopController,
  buildPipeline,
  queuedByAgent,
  statusesOf,
  aggregateAgent,
  type WorkflowsConfig,
} from '@atizar/react'
import { instanceId } from '@atizar/core'

const Inner = ({ config, demo }: { config: WorkflowsConfig; demo?: boolean }) => {
  const board = useBoard()
  const health = useHealth()
  const { deliver, cancel } = useDispatch()

  const sel = useWorkflowSelection(config)
  const nav = useBoardNavigation(config, sel.activeWorkflowId)
  const stop = useStopController(sel.activeWorkflowId)
  const activityFeedOpen = useActivityToggle() // see Step 1b

  const renderableToolNames = new Set([
    ...config.renders.map((s) => s.toolName),
    ...config.hitl.map((s) => s.toolName),
  ])

  const blocks = buildPipeline(nav.pInstances, queuedByAgent(board.items, nav.workflow.id))
  const aggOf = (agentId: string) =>
    aggregateAgent(statusesOf(board.items, nav.workflow.id, agentId))
  const healthOf = (agentId: string) =>
    health[instanceId(nav.workflow.id, agentId)] ??
    board.agentHealth[instanceId(nav.workflow.id, agentId)]

  const onSelectWorkflow = (id: string) => {
    sel.switchWorkflow(id)
    nav.reset()
  }

  return (
    <div className="app">
      <AppHeader
        workflows={config.workflows}
        activeId={sel.activeWorkflowId}
        unread={sel.unread}
        onSelect={onSelectWorkflow}
        globalActive={sel.globalActive}
        stoppingAll={stop.stoppingAll}
        onStopAll={stop.requestStopAll}
        activityOpen={activityFeedOpen.open}
        onToggleActivity={activityFeedOpen.toggle}
        demo={demo}
      />

      <div className="workspace-body">
        <PipelineColumn
          blocks={blocks}
          onOpen={nav.setOpenId}
          onStopItem={stop.requestStopItem}
          stoppingItems={stop.stoppingItems}
          onStopWorkflow={stop.requestStopWorkflow}
          workflowActiveCount={sel.workflowActiveCount}
          stoppingWorkflow={stop.stoppingWorkflow}
        />

        <AgentGrid
          agents={nav.workflow.agents.map((a) => a.agent)}
          meta={config.meta}
          items={board.items}
          activeWorkflowId={sel.activeWorkflowId}
          aggOf={aggOf}
          healthOf={healthOf}
          canStart={nav.canStart}
          onStart={nav.startInput}
          onOpen={nav.openAgent}
        />

        {nav.openItem && (
          <ThreadModal
            key={nav.openItem.id}
            id={nav.openItem.id}
            title={nav.nameOf(nav.stripAgent(nav.openItem))}
            iconName={nav.metaIcon(nav.stripAgent(nav.openItem))}
            intro={config.meta[nav.stripAgent(nav.openItem)]?.intro ?? ''}
            canStart={nav.canStart(nav.stripAgent(nav.openItem))}
            renderableToolNames={renderableToolNames}
            notes={nav.notesFor(nav.openItem.id)}
            deliver={deliver}
            onStop={(cid) => void cancel(cid)}
            onOpenWorkflow={onSelectWorkflow}
            onOpenInstance={nav.setOpenId}
            onStart={() => {
              const def = nav.defOf(nav.workflow.id, nav.stripAgent(nav.openItem!))
              if (def) nav.startInput(def)
            }}
            onClose={() => nav.setOpenId(null)}
          />
        )}

        {!nav.openItem && nav.openTypeAgent && (
          <AgentModal
            agent={{ messages: [] }}
            title={nav.openTypeAgent.name}
            iconName={config.meta[nav.openTypeAgent.id].iconName}
            status="idle"
            renderToolCall={() => null}
            renderableToolNames={renderableToolNames}
            loading={false}
            canStart={nav.canStart(nav.openTypeAgent.id)}
            intro={config.meta[nav.openTypeAgent.id].intro}
            notes={[]}
            onStart={() => nav.startInput(nav.openTypeAgent!)}
            onClose={() => nav.setOpenTypeId(null)}
          />
        )}

        {nav.openPickerId && nav.pickerInstances.length >= 2 && (
          <InstancePickerModal
            title={nav.pickerInstances[0].name}
            iconName={nav.pickerInstances[0].iconName}
            instances={nav.pickerInstances.map((x) => ({
              localId: x.localId,
              label: x.label,
              name: x.name,
              status: x.status,
            }))}
            onOpenInstance={(localId) => {
              nav.setOpenPickerId(null)
              nav.setOpenId(localId)
            }}
            onClose={() => nav.setOpenPickerId(null)}
          />
        )}
      </div>

      <ActivityPanel
        open={activityFeedOpen.open}
        dev={isDevMode}
        feed={useActivity(activityFeedOpen.open)}
        workflows={config.workflows.map((w) => ({ id: w.id, label: w.label }))}
        onClose={activityFeedOpen.close}
      />

      {stop.confirm && (
        <ConfirmDialog
          title={
            stop.confirm.kind === 'all'
              ? 'Stop all workflows?'
              : stop.confirm.kind === 'workflow'
                ? 'Stop this workflow?'
                : 'Stop this item?'
          }
          message={
            stop.confirm.kind === 'all'
              ? 'This halts every active item across all workflows. In-flight work is cancelled.'
              : stop.confirm.kind === 'workflow'
                ? `This halts every active item in ${nav.workflow.label}. In-flight work is cancelled.`
                : 'This halts this work item. In-flight work is cancelled.'
          }
          confirmLabel={
            stop.confirm.kind === 'all'
              ? 'Stop all'
              : stop.confirm.kind === 'workflow'
                ? 'Stop workflow'
                : 'Stop item'
          }
          onConfirm={() => void stop.confirmStop()}
          onCancel={stop.cancelConfirm}
        />
      )}
    </div>
  )
}

export const BoardApp = ({ config, demo }: { config: WorkflowsConfig; demo?: boolean }) => (
  <WorkflowsProvider config={config}>
    <Inner config={config} demo={demo} />
  </WorkflowsProvider>
)
```

- [ ] **Step 1b: Resolve the two small wiring details flagged above**
  - `useActivity` is called twice in the sketch (once via `activityFeedOpen`, once inline). FIX: keep ONE `const activityOpen = useState(false)` in `Inner` and one `const feed = useActivity(activityOpen)` — replace the `useActivityToggle()` placeholder with a local `useState`. (The sketch used a placeholder to flag it; do NOT ship `useActivityToggle`.) Mirror `WorkflowBoard.tsx:63,72,360-366`.
  - `isDevMode`: if not already exported from `@atizar/react`, add it to `index.ts` in Task 8 (it lives in `devMode.ts`).

- [ ] **Step 2: Point `App.tsx` at `BoardApp`**

In `apps/inbox/client/src/App.tsx`, replace the `WorkflowBoard` import + usage:
```tsx
import { BoardApp } from './BoardApp'
import { workflowsConfig } from './workflows'
export const App = () => <BoardApp config={workflowsConfig} />
```
(Preserve any `demo` prop wiring the old `App.tsx` had — read it first; pass `demo` through if present.)

- [ ] **Step 3: Typecheck**

Run: `yarn typecheck` — Expected: PASS. Fix prop-type mismatches against the real block signatures (read each block in `packages/react/src/components/` if a prop type differs from the sketch).

- [ ] **Step 4: Commit**

```bash
git add apps/inbox/client/src/BoardApp.tsx apps/inbox/client/src/App.tsx
git commit -m "feat(inbox): compose the board from @atizar/react blocks + hooks"
```

---

## Task 8: Export the blocks + hooks; delete `WorkflowBoard`

**Files:**
- Modify: `packages/react/src/index.ts`
- Delete: `packages/react/src/WorkflowBoard.tsx`

- [ ] **Step 1: Update `index.ts` exports**

Remove:
```ts
export { WorkflowBoard } from './WorkflowBoard.js'
```
Add (blocks):
```ts
export { PipelineColumn } from './components/PipelineColumn.js'
export { AgentCard } from './components/AgentCard.js'
export { AgentGrid } from './components/AgentGrid.js'
export { AgentModal, type HandoffNote } from './components/AgentModal.js'
export { ThreadModal } from './components/ThreadModal.js'
export { InstancePickerModal } from './components/InstancePickerModal.js'
export { WorkflowSwitcher } from './components/WorkflowSwitcher.js'
```
Add (hooks + helpers):
```ts
export { useWorkflowSelection } from './hooks/useWorkflowSelection.js'
export { useBoardNavigation } from './hooks/useBoardNavigation.js'
export { useStopController } from './hooks/useStopController.js'
export { lookups } from './lookups.js'
export { buildPipeline } from './pipelineModel.js'
export { toPInstances, queuedByAgent, statusesOf } from './boardModel.js'
export { aggregateAgent, aggregateLabel } from './aggregate.js'
export { isDevMode } from './devMode.js'
```

> `HandoffNote` is exported from both `AgentModal` (existing) and `useBoardNavigation` (new). Pick ONE canonical source — export it from `useBoardNavigation` and have `AgentModal` import the type from there (or keep it in a shared `serverTypes`-adjacent spot). Avoid a duplicate-export TS error.

- [ ] **Step 2: Delete the monolith**

```bash
git rm packages/react/src/WorkflowBoard.tsx
```
Grep for stragglers: `grep -rn "WorkflowBoard" packages apps` — Expected: only the deleted file's history; fix any remaining import (the demo now uses `BoardApp`).

- [ ] **Step 3: Typecheck + full test suite**

Run: `yarn typecheck` — Expected: PASS.
Run: `yarn test` — Expected: PASS (all prior tests + the 5 new ones).
Run: `yarn lint` — Expected: GREEN (fix unused-import warnings from the deletion).

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/index.ts
git commit -m "feat(react): export blocks + hooks; remove WorkflowBoard monolith"
```

---

## Task 9: Docs + browser verification + check-foundation

**Files:**
- Modify: `CLAUDE.md`, `docs/ARCHITECTURE.md` (§5 Packaging line about `--atz-*`)

- [ ] **Step 1: Make the `--atz-*` doc claim true**

In `docs/ARCHITECTURE.md` §5 and `CLAUDE.md` (Stack / packaging notes), the text already says styling is "plain CSS over `--atz-*` design tokens (`tokens.css` + `styles.css`)". That is now TRUE — confirm the wording matches reality (tokens.css exists, `--atz-*` namespaced). Adjust any line that implies the blocks are reachable only via `WorkflowBoard`; note the board is composed in `apps/inbox/client/BoardApp.tsx` from exported blocks + hooks. **Do NOT** change the "no build step" line (that is Plan B).

- [ ] **Step 2: Run `check-foundation`**

Invoke the `check-foundation` skill on this change (touches `@atizar/react` packaging + the framework/userland boundary). Expected verdict: CLEAR (this realizes belief #3 — more composable boundary, cards still userland, core still React-free, no invariant touched). Record the verdict.

- [ ] **Step 3: Browser-verify (invoke `browser-verify` skill)**

Drive the demo end-to-end and confirm DOM/behavior is identical to pre-refactor:
- `yarn dev`; open the board; switch workflows (badge clears); start the lead-inbox input agent; open its thread; see render cards; hit the approval gate, **edit the draft, approve → real Gmail draft**; reject; cancel; **reload the page → thread re-attaches via `?open=`**; Stop item / Stop workflow / Stop all confirm + halt.
- Singleton START disabled while a copy is active.
- Visual parity: colors/spacing unchanged (token aliasing is transparent).

- [ ] **Step 4: Commit docs**

```bash
git add CLAUDE.md docs/ARCHITECTURE.md
git commit -m "docs(react): board composed from exported blocks; --atz-* tokens now real"
```

---

## Self-Review (done while writing)

- **Spec coverage:** Plan A covers spec §1 (hooks — Tasks 3-5 + `lookups` Task 2), §2 (export blocks + AgentGrid — Tasks 6,8), §3-demo (Task 7), §5 tokens (Task 1), and the Phase-1/2 of §Phasing. Spec §4 (styling `.module.scss`) and §6 (Vite lib build) are **Plan B** — explicitly out of scope here (stated in the header). Spec §Risks (provider mounting, hook parity, className) are covered by Task 9 browser-verify + the unit tests.
- **Placeholder scan:** the only deliberate flags are in Task 7 Step 1 (`useActivityToggle` placeholder + `isDevMode` import) — Step 1b resolves both with concrete instructions. No other TBDs.
- **Type consistency:** `lookups` returns the same names used by `useBoardNavigation` and `BoardApp` (`workflow/defOf/roleOf/nameOf/metaIcon/stripAgent/labelOf`); `stripAgent(w: WorkItem)`; `useStopController(activeWorkflowId)` matches its call in `BoardApp`. The `HandoffNote` double-export is flagged in Task 8 Step 1 with the fix.

## Plan B (next plan — written after A lands)

Styling migration to co-located `*.module.scss` (block-by-block; shrink `styles.css` → `base.css`) + the Vite **lib build** (`build.lib` + `vite-plugin-dts` + sass, `exports → dist`, externalize peers) + reversing the "no build step" doc in CLAUDE.md / ARCHITECTURE §8. Definition of done: `vite build` produces a publishable `dist/` (ESM + `.d.ts` + compiled `styles.css`) consumed with zero bundler config.
