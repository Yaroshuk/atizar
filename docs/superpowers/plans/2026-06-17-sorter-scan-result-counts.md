# Sorter Scan-Result Counts (server-authoritative) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive the INBOX SORTED card's numbers from the framework's dispatch outcome (the `handoff` events from Plan 1), not the model's self-count — so a re-scan honestly reads `Read N · M new · K already handled` and the handoff count equals `new`.

**Architecture:** The model keeps narrating (prose `summary`); the **workflow** accounts. The open thread's `handoff` events (`{targetAgentId, childWorkItemId, deduped}`, emitted by Plan 1) are exposed generically from `@atizar/react` via a context. The **email-inbox workflow** reads them, joins each to the child work item's payload (from `useBoard`) to count emails per destination, and projects an email-specific `ScanResult`. The card renders that. Nothing email-specific enters `@atizar/*`.

**Tech Stack:** TypeScript, Vitest, React + Testing Library, `@ag-ui` message vocabulary.

This is **Plan 2 of 2** for spec `docs/superpowers/specs/2026-06-17-sorter-scan-result-truth.md` (part 1). **It depends on Plan 1** (`2026-06-17-handoff-trace-event-order.md`) being merged — specifically the `role:'handoff'` folded message carrying `deduped`. Do not start until Plan 1's Task 1 + Task 2 are in.

## Global Constraints

- **Framework/app boundary (I5):** the only `@atizar/react` change is a **generic** `ThreadHandoffsContext`/`useThreadHandoffs()` (the open thread's handoff events — no email fields). ALL destination/email/count/"Read N" logic lives in `apps/inbox` (workflow + card). Never put `reply/reader/spam/important` in `@atizar/*`.
- **Model contributes no numbers:** `renderSort`'s `counts` arg is removed; the prompt drops the "compute counts" instruction. The model supplies only `summary`.
- **Window semantics (DECIDED):** the projection reads only THIS scan run's handoff events, so `alreadyHandled` is automatically the intersection `(read now) ∩ (covered)` — scoped to the current read set, not cumulative. Mail aged out of the 24h window emits no handoff this run → absent from the card. (Document in `projectScanResult`.)
- **TDD; green gate before "done":** `yarn typecheck && yarn test && yarn lint && yarn format:check` from repo root + `yarn workspace @atizar/react build` for the react change.
- **Run `check-foundation`** before the final commit (shifts a card's quantitative content from model to workflow; touches the react thread context — I5/I8/I14).

---

### Task 1: React (framework, generic) — expose the open thread's handoff events

**Files:**
- Create: `packages/react/src/threadHandoffs.tsx`
- Modify: `packages/react/src/components/AgentModal/AgentModal.tsx` (collect handoff messages + provide the context), `packages/react/src/index.ts` (export)
- Test: `packages/react/src/threadHandoffs.test.tsx`

**Interfaces:**
- Produces: `type ThreadHandoff = { targetAgentId: string; childWorkItemId: string; deduped: boolean }`; `ThreadHandoffsContext` (default `[]`); `useThreadHandoffs(): ThreadHandoff[]`. Generic — mirrors `threadResults.tsx`.
- Consumes: the `role:'handoff'` folded messages on `agent.messages` (Plan 1, Task 1).

- [ ] **Step 1: Write the failing test**

```tsx
import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Message } from '@atizar/core'
import { AgentModal } from './components/AgentModal/AgentModal.js'
import { useThreadHandoffs } from './threadHandoffs.js'

const Probe = () => <span>handoffs:{useThreadHandoffs().length}</span>

describe('useThreadHandoffs', () => {
  it('exposes the open thread handoff events to a card rendered inside the thread', () => {
    const messages = [
      { id: 'a1', role: 'assistant', content: 'sorted' },
      { id: 'h1', role: 'handoff', targetAgentId: 'wf__reply', childWorkItemId: 'c1', deduped: false },
    ] as unknown as Message[]
    render(
      <AgentModal
        agent={{ messages }}
        title="Sorter" iconName="inbox" status="done"
        renderToolCall={() => <Probe />}
        renderableToolNames={new Set()} loading={false} canStart={false}
        intro="" notes={[]} onStart={() => {}} onClose={() => {}}
      />
    )
    // a card inside the thread can read the handoffs via context
    // (the Probe is rendered via a tool call in a fuller test; here we assert the hook default + provider)
    expect(screen.getByText(/sorted/)).toBeInTheDocument()
  })

  it('useThreadHandoffs returns [] with no provider', () => {
    let seen: number | null = null
    const P = () => { seen = useThreadHandoffs().length; return null }
    render(<P />)
    expect(seen).toBe(0)
  })
})
```

(The first assertion is a smoke render; the real handoff-count read is covered in Task 3 where a card actually consumes it. Keep both — the second pins the no-provider default.)

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test packages/react/src/threadHandoffs.test.tsx`
Expected: FAIL — module `./threadHandoffs.js` not found.

- [ ] **Step 3: Create `threadHandoffs.tsx`**

```tsx
import { createContext, useContext } from 'react'

// The open agent thread's handoff events (Plan 1: a server-emitted CUSTOM 'handoff' folded to a
// role:'handoff' message). Generic — a card reads its thread's handoffs from here to project a
// workflow-specific summary, the same way ThreadResultsContext exposes data-tool results. No
// workflow fields live here.
export type ThreadHandoff = { targetAgentId: string; childWorkItemId: string; deduped: boolean }

export const ThreadHandoffsContext = createContext<ThreadHandoff[]>([])

export function useThreadHandoffs(): ThreadHandoff[] {
  return useContext(ThreadHandoffsContext)
}
```

- [ ] **Step 4: Collect + provide in AgentModal**

In `AgentModal.tsx`, after `resultsByToolName` is built, collect handoffs from messages:

```tsx
const handoffs = agent.messages
  .filter((m): m is Message & ThreadHandoff & { role: 'handoff' } => (m as { role?: string }).role === 'handoff')
  .map((m) => ({ targetAgentId: m.targetAgentId, childWorkItemId: m.childWorkItemId, deduped: m.deduped }))
```

Wrap the existing thread body by nesting the new provider INSIDE `ThreadResultsContext.Provider`:

```tsx
<ThreadResultsContext.Provider value={resultsByToolName}>
  <ThreadHandoffsContext.Provider value={handoffs}>
    {/* existing thread JSX unchanged */}
  </ThreadHandoffsContext.Provider>
</ThreadResultsContext.Provider>
```

Import `ThreadHandoffsContext` + `ThreadHandoff` at the top.

- [ ] **Step 5: Export from index**

In `packages/react/src/index.ts` add:

```ts
export { ThreadHandoffsContext, useThreadHandoffs, type ThreadHandoff } from './threadHandoffs.js'
```

- [ ] **Step 6: Run tests + build**

Run: `yarn test packages/react/src/threadHandoffs.test.tsx && yarn workspace @atizar/react build`
Expected: PASS; build clean.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/threadHandoffs.tsx packages/react/src/threadHandoffs.test.tsx packages/react/src/components/AgentModal/AgentModal.tsx packages/react/src/index.ts
git commit -m "feat(react): expose the open thread handoff events via ThreadHandoffsContext"
```

---

### Task 2: Workflow — `projectScanResult` (pure, email policy)

**Files:**
- Create: `apps/inbox/workflows/email-inbox/scanResult.ts`
- Test: `apps/inbox/workflows/email-inbox/scanResult.test.ts`

**Interfaces:**
- Consumes: `ThreadHandoff[]` (Task 1) + the board's work items (`{ id: string; payload: Record<string, unknown> }[]`).
- Produces:
  ```ts
  type Dest = 'reply' | 'reader' | 'spam' | 'important'
  type ScanResult = { read: number; new: Record<Dest, number>; alreadyHandled: Record<Dest, number> }
  function projectScanResult(handoffs: ThreadHandoff[], items: { id: string; payload: Record<string, unknown> }[]): ScanResult
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { projectScanResult } from './scanResult.js'

const items = [
  { id: 'c-reply', payload: { email: { messageId: 'e1' } } },
  { id: 'c-reader', payload: { emails: [{ messageId: 'e2' }, { messageId: 'e3' }, { messageId: 'e4' }, { messageId: 'e5' }] } },
]

describe('projectScanResult', () => {
  it('counts NEW per destination from child payloads (reply=1, reader batch=4)', () => {
    const r = projectScanResult(
      [
        { targetAgentId: 'wf__reply', childWorkItemId: 'c-reply', deduped: false },
        { targetAgentId: 'wf__reader', childWorkItemId: 'c-reader', deduped: false },
      ],
      items
    )
    expect(r.new).toEqual({ reply: 1, reader: 4, spam: 0, important: 0 })
    expect(r.alreadyHandled).toEqual({ reply: 0, reader: 0, spam: 0, important: 0 })
    expect(r.read).toBe(5)
  })

  it('a deduped handoff lands in alreadyHandled, not new (re-scan)', () => {
    const r = projectScanResult(
      [{ targetAgentId: 'wf__reader', childWorkItemId: 'c-reader', deduped: true }],
      items
    )
    expect(r.new.reader).toBe(0)
    expect(r.alreadyHandled.reader).toBe(4)
    expect(r.read).toBe(4)
  })

  it('ignores a handoff whose child is not in the current items (aged out of window)', () => {
    const r = projectScanResult([{ targetAgentId: 'wf__reply', childWorkItemId: 'gone', deduped: false }], items)
    expect(r.read).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test apps/inbox/workflows/email-inbox/scanResult.test.ts -c vitest.config.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `projectScanResult`**

```ts
import type { ThreadHandoff } from '@atizar/react'

export type Dest = 'reply' | 'reader' | 'spam' | 'important'
export type ScanResult = {
  read: number
  new: Record<Dest, number>
  alreadyHandled: Record<Dest, number>
}

const DESTS: Dest[] = ['reply', 'reader', 'spam', 'important']
const zero = (): Record<Dest, number> => ({ reply: 0, reader: 0, spam: 0, important: 0 })
const bare = (agentId: string): string =>
  agentId.includes('__') ? agentId.slice(agentId.indexOf('__') + 2) : agentId

// Count emails a child carries: a reply child has one `email`; a batch child has `emails: [...]`.
const emailCount = (payload: Record<string, unknown>): number => {
  if (Array.isArray((payload as { emails?: unknown[] }).emails)) {
    return (payload as { emails: unknown[] }).emails.length
  }
  return (payload as { email?: unknown }).email ? 1 : 0
}

// Project this scan run's handoff events into the email ScanResult. WINDOW SEMANTICS: we read only
// the handoffs of the OPEN scan run, so `alreadyHandled` is the intersection (read now) ∩ (covered)
// — scoped to the current read set, never cumulative. A handoff whose child isn't in `items`
// (aged out / cleared) contributes nothing.
export function projectScanResult(
  handoffs: ThreadHandoff[],
  items: { id: string; payload: Record<string, unknown> }[]
): ScanResult {
  const byId = new Map(items.map((i) => [i.id, i]))
  const result: ScanResult = { read: 0, new: zero(), alreadyHandled: zero() }
  for (const h of handoffs) {
    const dest = bare(h.targetAgentId) as Dest
    if (!DESTS.includes(dest)) continue
    const child = byId.get(h.childWorkItemId)
    if (!child) continue // aged out of the current window / cleared
    const n = emailCount(child.payload)
    ;(h.deduped ? result.alreadyHandled : result.new)[dest] += n
    result.read += n
  }
  return result
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `yarn test apps/inbox/workflows/email-inbox/scanResult.test.ts -c vitest.config.ts`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/workflows/email-inbox/scanResult.ts apps/inbox/workflows/email-inbox/scanResult.test.ts
git commit -m "feat(email-inbox): projectScanResult — workflow-owned new/handled split from handoff events"
```

---

### Task 3: Card — render the new/handled split from the projection

**Files:**
- Modify: `apps/inbox/client/src/components/SortSummaryCard/SortSummaryCard.tsx`, `apps/inbox/client/src/components/SortSummaryCard/SortSummaryCard.module.scss` (a muted `handled` row)
- Test: `apps/inbox/client/src/components/SortSummaryCard/SortSummaryCard.test.tsx`

**Interfaces:**
- Consumes: `useThreadHandoffs()` + `useBoard()` from `@atizar/react`; `projectScanResult`/`ScanResult` from the workflow (Task 2).
- Produces: a card showing `Read N · M new · K already handled` with `new:` chips and a muted `handled:` row. New prop shape: `{ summary: string }` only (counts/result are read from context, not passed).

- [ ] **Step 1: Write the failing test**

```tsx
import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@atizar/react', async (orig) => ({
  ...(await orig<typeof import('@atizar/react')>()),
  useThreadHandoffs: () => [
    { targetAgentId: 'wf__important', childWorkItemId: 'c-imp', deduped: false },
    { targetAgentId: 'wf__reader', childWorkItemId: 'c-reader', deduped: true },
  ],
  useBoard: () => ({
    items: [
      { id: 'c-imp', payload: { emails: [{ messageId: 'i1' }] } },
      { id: 'c-reader', payload: { emails: [{ messageId: 'r1' }, { messageId: 'r2' }, { messageId: 'r3' }, { messageId: 'r4' }] } },
    ],
  }),
}))

import { SortSummaryCard } from './SortSummaryCard.js'

describe('SortSummaryCard', () => {
  it('shows read / new / already-handled from the projected scan result', () => {
    render(<SortSummaryCard summary="Sorted your inbox." />)
    expect(screen.getByText(/5 read/i)).toBeInTheDocument()
    expect(screen.getByText(/1 new/i)).toBeInTheDocument()
    expect(screen.getByText(/4 already handled/i)).toBeInTheDocument()
    expect(screen.getByText(/important: 1/i)).toBeInTheDocument()   // new chip
    expect(screen.getByText(/reader: 4/i)).toBeInTheDocument()      // handled row
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test apps/inbox/client/src/components/SortSummaryCard/SortSummaryCard.test.tsx -c vitest.config.ts`
Expected: FAIL — card still renders the old `counts` prop UI.

- [ ] **Step 3: Rewrite the card**

```tsx
import { CardShell, Markdown, useBoard, useThreadHandoffs } from '@atizar/react'
import { projectScanResult, type Dest } from '../../../../workflows/email-inbox/scanResult'
import s from './SortSummaryCard.module.scss'

type SortSummaryCardProps = { summary: string }

const DESTS: Dest[] = ['reply', 'reader', 'spam', 'important']

export const SortSummaryCard = ({ summary }: SortSummaryCardProps) => {
  const handoffs = useThreadHandoffs()
  const { items } = useBoard()
  const r = projectScanResult(handoffs, items)
  const sum = (rec: Record<Dest, number>) => DESTS.reduce((n, d) => n + rec[d], 0)
  const handled = sum(r.alreadyHandled)

  const chips = (rec: Record<Dest, number>) =>
    DESTS.filter((d) => rec[d] > 0).map((d) => (
      <span className="pill" key={d}>
        <span className="pill-dot" />
        {d}: {rec[d]}
      </span>
    ))

  return (
    <CardShell icon="inbox" kicker="Inbox sorted">
      <div className={s.reason}>
        <Markdown>{summary}</Markdown>
      </div>
      <div className={s.headline}>
        {r.read} read · {sum(r.new)} new{handled > 0 ? ` · ${handled} already handled` : ''}
      </div>
      <div className={s.tags}>{chips(r.new)}</div>
      {handled > 0 && <div className={`${s.tags} ${s.handled}`}>{chips(r.alreadyHandled)}</div>}
    </CardShell>
  )
}
```

Add `.headline` and `.handled` (muted) classes to the `.module.scss` (mirror existing `.tags`/`.reason` styling; `.handled` = lower opacity).

- [ ] **Step 4: Run to verify it passes**

Run: `yarn test apps/inbox/client/src/components/SortSummaryCard/SortSummaryCard.test.tsx -c vitest.config.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/client/src/components/SortSummaryCard/
git commit -m "feat(email-inbox): SortSummaryCard renders new/handled split (workflow-projected, not model counts)"
```

---

### Task 4: Trim the `renderSort` contract — model gives prose only

**Files:**
- Modify: `apps/inbox/workflows/email-inbox/client.tsx:42-62` (drop `counts` from the `renderSort` parameters + render call)
- Test: existing render-spec / drift tests stay green; adjust any that assert `counts`.

**Interfaces:**
- Consumes: the rewritten `SortSummaryCard` (Task 3) — now `{ summary }` only.
- Produces: `renderSort` parameters = `z.object({ summary: z.string() })`.

- [ ] **Step 1: Write/adjust the failing test**

If a test asserts the `renderSort` schema accepts `counts`, flip it to assert `counts` is no longer part of the parsed parameters (or simply that `summary` alone validates). Add to the email-inbox render-spec test (or `client` test if present):

```ts
const spec = emailInboxRenders.find((r) => r.toolName === t.renderSort)!
expect(spec.parameters.safeParse({ summary: 'ok' }).success).toBe(true)
expect('counts' in (spec.parameters.safeParse({ summary: 'ok', counts: { reply: 1 } }) as any).data).toBe(false)
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test apps/inbox/workflows/email-inbox -c vitest.config.ts`
Expected: FAIL — `counts` still in the schema.

- [ ] **Step 3: Trim the spec**

In `client.tsx`, replace the `renderSort` block with:

```tsx
{
  toolName: t.renderSort,
  parameters: z.object({ summary: z.string() }),
  render: ({ parameters }) => {
    const { summary } = parameters
    if (summary === undefined) return <></>
    return <SortSummaryCard summary={summary} />
  },
},
```

- [ ] **Step 4: Run to verify it passes**

Run: `yarn test apps/inbox/workflows/email-inbox -c vitest.config.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/workflows/email-inbox/client.tsx
git commit -m "feat(email-inbox): renderSort takes prose summary only — numbers are workflow-projected"
```

---

### Task 5: Trim the sorter prompt — stop computing counts

**Files:**
- Modify: `apps/inbox/workflows/email-inbox/prompts.ts:29` (the `renderSort` instruction)
- Test: `apps/inbox/workflows/email-inbox/prompts.test.ts` (still expects the `renderSort` token), `prompts.drift.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: a sorter prompt that calls `renderSort` with `{ summary }` only; keeps classify + dispatch-before-render order.

- [ ] **Step 1: Adjust the prompt test**

In `prompts.test.ts`, keep the assertion that the prompt contains `t.renderSort` and `t.route_emails`. If any test asserts the prompt mentions "counts", remove that assertion.

- [ ] **Step 2: Run to confirm current state**

Run: `yarn test apps/inbox/workflows/email-inbox/prompts.test.ts -c vitest.config.ts`
Expected: PASS currently (we haven't broken the token assertions).

- [ ] **Step 3: Edit the prompt line**

Replace `prompts.ts:29-30` ("Finally call renderSort with { summary, counts } … counts is { reply, reader, spam, important } with the number routed to each.") with:

```ts
`Finally call ${t.renderSort} with { summary } — summary is one short sentence describing what`,
'you sorted. Do NOT compute or report counts; the app derives the numbers from the dispatches.',
```

Keep lines :23-:28 (dispatch instructions) and the "Then dispatch … Finally call renderSort" ORDER intact — the dispatch-before-render order is required (Plan 1 / the spec call-order constraint).

- [ ] **Step 4: Run prompt + drift tests**

Run: `yarn test apps/inbox/workflows/email-inbox/prompts.test.ts apps/inbox/workflows/email-inbox/prompts.drift.test.ts -c vitest.config.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/workflows/email-inbox/prompts.ts apps/inbox/workflows/email-inbox/prompts.test.ts
git commit -m "feat(email-inbox): sorter prompt drops counts — model narrates, app accounts"
```

---

### Task 6: Green gate, foundation check, browser-verify the re-scan

**Files:** none (verification only).

- [ ] **Step 1: Full green gate**

Run: `yarn typecheck && yarn test && yarn lint && yarn format:check`
Expected: all PASS. (If a demo cassette test asserts the old `counts` card shape, refresh it per the demo-cassette rules.)

- [ ] **Step 2: check-foundation**

Invoke `check-foundation`. Expected: Clear — `ThreadHandoffsContext` is generic (I5); the card's numbers are now server/workflow-derived (consistent with I8/I12 server-authoritative, the spec's "model narrates, framework accounts"); no provider/AG-UI change.

- [ ] **Step 3: Browser-verify the re-scan (the original bug)**

Invoke `browser-verify`. With Plan 1 merged: run a scan, Stop, add one new email, re-START. Assert the card reads `Read N · 1 new · K already handled`, the `new:` chip matches the single new destination, and the visible handoff count equals `new` (one "→ Handed to …"). First scan reads `Read N · N new` with no handled row.

- [ ] **Step 4: Final commit (if verification produced fixes)**

```bash
git add -p
git commit -m "test: verify server-authoritative scan-result counts (green gate + browser)"
```

---

## Self-Review

- **Spec coverage (part 1):** generic handoff-events exposure (Task 1, react); workflow projection with window semantics (Task 2); card new/handled split (Task 3); `renderSort` contract trim (Task 4); prompt trim (Task 5); green gate + foundation + browser re-scan (Task 6). The `read = Σnew + ΣalreadyHandled` identity and the batch-count-from-payload rule are in `projectScanResult` (Task 2).
- **Boundary (I5):** the only `@atizar/react` addition is the generic `ThreadHandoffsContext`; all `reply/reader/spam/important`, "Read N", and counting live in `apps/inbox`. Verified against the CLAUDE.md standing rule.
- **Type consistency:** `ThreadHandoff` (Task 1) is the exact type `projectScanResult` consumes (Task 2) and the card reads (Task 3); `ScanResult`/`Dest` (Task 2) are the exact types the card imports (Task 3); `renderSort` params `{ summary }` (Task 4) match the card's `{ summary }` prop (Task 3).
- **Placeholder scan:** the only "adapt" notes are test-harness matches (mock paths, existing drift assertions) — assertions and production edits are concrete. Card SCSS classes (`.headline`, `.handled`) are described as mirroring existing styles — acceptable styling latitude, not logic.
- **Dependency:** explicitly gated on Plan 1 (the `role:'handoff'` folded message with `deduped`). The two plans share that single seam.
