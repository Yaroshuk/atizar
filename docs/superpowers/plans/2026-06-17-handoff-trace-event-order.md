# Handoff Trace Event + Honest Thread Order — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a dispatch/handoff a first-class, server-emitted trace event positioned by `seq`, so the thread renders one time-ordered stream and the "→ Handed to X" note can never float above the report during streaming.

**Architecture:** A dispatch already happens at a definite point in the parent run's trace. When the RunObserver delivers a child, it appends a generic `handoff` CUSTOM event (`{ targetAgentId, childWorkItemId, deduped, at }`) to the **parent's** trace — the exact seam `settle` uses for the lifecycle note. `foldEventsToMessages` turns it into a synthetic `role:'handoff'` message at its position. `AgentModal` renders the thread from one ordered list via a **pure projection function**, so order is unit-testable (full list + streaming prefix). The board-topology reconstruction + layout-pinned `sent` block are deleted.

**Tech Stack:** TypeScript, Vitest, @ag-ui/client event vocabulary, Postgres (PGlite in tests), React + Testing Library.

This is **Plan 1 of 2** for spec `docs/superpowers/specs/2026-06-17-sorter-scan-result-truth.md`. It implements **part 2** (the generic `handoff` event + ordering). **Plan 2** (the email-workflow `ScanResult` counts that READ these events) depends on this and is written after Plan 1 lands.

## Global Constraints

- **Framework/app boundary (I5):** everything in this plan is **framework-generic** — `@atizar/core`, `@atizar/server`, `@atizar/react`. The `handoff` event payload carries **zero** workflow-specific fields (no `reply/reader/spam/email/sorter`). Label/display-name resolution stays app-side via existing lookups.
- **TDD:** no production code without a failing test first. Watch each test fail, then pass.
- **Green gate before "done":** `yarn typecheck && yarn test && yarn lint && yarn format:check` from repo root, plus `yarn workspace @atizar/react build` for any `@atizar/react` change.
- **Trace stays an explicitly mixed log (I14):** the `handoff` event is a server-authored CUSTOM event, same class as the lifecycle note — NOT a provider/AG-UI contract change.
- **Run `check-foundation`** before the final commit (touches the trace + dispatch-result flow → I8/I14 boundary).
- **Tests run from repo root** (`yarn test`); the server tests use PGlite and skip if unreachable.

---

### Task 1: Core — the `handoffNote` event + fold case

**Files:**
- Create: `packages/core/src/handoffNote.ts`
- Modify: `packages/core/src/fold.ts` (add a CUSTOM `name:'handoff'` branch), `packages/core/src/index.ts` (export the new symbols)
- Test: `packages/core/src/fold.test.ts` (add a case; reuse the existing fold test file)

**Interfaces:**
- Produces: `interface HandoffNoteValue { kind: 'handoff'; targetAgentId: string; childWorkItemId: string; deduped: boolean; at: number }`; `handoffNote(value: HandoffNoteValue): BaseEvent`; and a folded message shape `{ id: string; role: 'handoff'; targetAgentId: string; childWorkItemId: string; deduped: boolean }` (cast `as Message`, mirroring how `lifecycle` casts `role:'system'`).
- Consumes: nothing (leaf).

- [ ] **Step 1: Write the failing fold test**

In `packages/core/src/fold.test.ts` add:

```ts
import { handoffNote } from './handoffNote.js'

it('folds a handoff CUSTOM event into a role:handoff message at its position', () => {
  const events = [
    { type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm1', delta: 'sorting' },
    handoffNote({
      kind: 'handoff',
      targetAgentId: 'wf__reply',
      childWorkItemId: 'child-1',
      deduped: false,
      at: 1,
    }),
  ] as unknown as BaseEvent[]

  const messages = foldEventsToMessages(events) as Array<Record<string, unknown>>

  expect(messages).toHaveLength(2)
  expect(messages[0].role).toBe('assistant') // the text comes first…
  expect(messages[1]).toMatchObject({
    role: 'handoff', // …the handoff lands AFTER it, at its event position
    targetAgentId: 'wf__reply',
    childWorkItemId: 'child-1',
    deduped: false,
  })
})
```

(Match the file's existing import of `EventType`/`BaseEvent`/`foldEventsToMessages` — reuse what's already imported at the top of `fold.test.ts`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test packages/core/src/fold.test.ts -t "folds a handoff"`
Expected: FAIL — `Cannot find module './handoffNote.js'` (file not created yet).

- [ ] **Step 3: Create `handoffNote.ts`**

```ts
import { EventType, type BaseEvent } from '@ag-ui/client'

// A typed server-authored trace note (I14), riding the SAME AG-UI CUSTOM vocabulary as the
// lifecycle note: a CUSTOM event named 'handoff'. The RunObserver appends one to the PARENT's
// trace when it delivers a child for a dispatch tool-call, and fold.ts renders it inline at its
// position. Generic — carries only the target reference + the dedup outcome, no workflow fields.
export interface HandoffNoteValue {
  kind: 'handoff'
  targetAgentId: string // the child's runtime agent id (wf__agent)
  childWorkItemId: string // the delivered child work item (for the "Open X" link)
  deduped: boolean // true ⇒ covered-by-source, no new child created this run
  at: number
}

export function handoffNote(value: HandoffNoteValue): BaseEvent {
  return { type: EventType.CUSTOM, name: 'handoff', value } as unknown as BaseEvent
}
```

- [ ] **Step 4: Add the fold branch**

In `packages/core/src/fold.ts`, import the type at the top alongside the lifecycle import:

```ts
import { type HandoffNoteValue } from './handoffNote.js'
```

Then inside the `case EventType.CUSTOM:` block, after the existing `lifecycle` handling and before `break`, add a second named-event branch (keep the lifecycle branch intact):

```ts
const handoff = event as BaseEvent & { name?: string; value?: HandoffNoteValue }
if (handoff.name === 'handoff' && handoff.value) {
  const v = handoff.value
  const id = `handoff-${v.childWorkItemId}`
  byId.set(id, {
    id,
    role: 'handoff',
    targetAgentId: v.targetAgentId,
    childWorkItemId: v.childWorkItemId,
    deduped: v.deduped,
  } as unknown as Message)
  break
}
```

(The existing branch returns early via `break` when `name !== 'lifecycle'`; restructure so both names are checked — e.g. handle `'lifecycle'` then `'handoff'` then `break`. `byId` preserves insertion order, so the message lands at the event's position.)

- [ ] **Step 5: Export from core**

In `packages/core/src/index.ts` add:

```ts
export { handoffNote, type HandoffNoteValue } from './handoffNote.js'
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `yarn test packages/core/src/fold.test.ts -t "folds a handoff"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/handoffNote.ts packages/core/src/fold.ts packages/core/src/index.ts packages/core/src/fold.test.ts
git commit -m "feat(core): handoff trace note + fold to a role:handoff message"
```

---

### Task 2: Server — RunObserver emits the handoff event on deliver

**Files:**
- Modify: `packages/server/src/runObserver.ts:150-183` (the dispatch-tool branch)
- Test: `packages/server/src/runObserver.dispatch.test.ts`

**Interfaces:**
- Consumes: `handoffNote` from `@atizar/core` (Task 1); `deps.deliver(req)` — already returns the dispatch result. Confirm its declared return includes `{ id: string; deduped: boolean }` (it resolves to `deliverImpl`'s `{ ok: true; id; deduped } | { ok: false; error }`). If the `AgentRuntime.deliver` type is currently `Promise<void>` / loosely typed, widen it to return `Promise<{ id: string; deduped: boolean } | undefined>` so the result is usable here.
- Produces: a CUSTOM `handoff` event appended to the PARENT (`id`) trace at the current `seq`, for every successful delivery (new OR deduped).

- [ ] **Step 1: Write the failing test**

In `packages/server/src/runObserver.dispatch.test.ts`, add a test that drives a run whose provider emits one dispatch tool-call to a valid handoff target, then asserts the parent trace contains a `handoff` CUSTOM event. Follow the file's existing harness for building a runtime with `dispatchToolNames`/`handoffs` and a stub `deliver`. Skeleton:

```ts
it('appends a handoff event to the parent trace when a child is delivered', async () => {
  const delivered: unknown[] = []
  const runtime = makeDispatchRuntime({
    dispatchToolNames: ['route'],
    handoffs: ['wf__reply'],
    deliver: async (req) => {
      delivered.push(req)
      return { id: 'child-1', deduped: false }
    },
  })
  // provider emits: TOOL_CALL_START/ARGS/END for `route` with args {to:'wf__reply', x:1}
  await runObserverFor(runtime, parentId, dispatchProvider('route', { to: 'wf__reply', x: 1 }))

  const trace = await store.getTrace(parentId, 0) // or the file's existing trace-read helper
  const handoff = trace.events.find(
    (e: any) => e.type === 'CUSTOM' && e.name === 'handoff'
  )
  expect(handoff?.value).toMatchObject({
    targetAgentId: 'wf__reply',
    childWorkItemId: 'child-1',
    deduped: false,
  })
})
```

(Adapt `makeDispatchRuntime` / `dispatchProvider` / the trace-read to the helpers already in `runObserver.dispatch.test.ts`. If the file lacks one, add a minimal local helper in the test file only.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test packages/server/src/runObserver.dispatch.test.ts -t "appends a handoff event"`
Expected: FAIL — no CUSTOM `handoff` event in the trace.

- [ ] **Step 3: Emit the event in the deliver branch**

In `packages/server/src/runObserver.ts`, import at the top:

```ts
import { handoffNote } from '@atizar/core'
```

Replace the `deliver(...).catch(...)` call (lines ~160-167) with a capture-and-emit:

```ts
const res = await deps
  .deliver({ origin: wi.workflowId, dest: { kind: 'agent', agentId: to }, payload, parentId: id })
  .catch((e) => {
    console.error('[runObserver] dispatch deliver failed', id, e)
    return undefined
  })
if (res && 'id' in res) {
  const ho = handoffNote({
    kind: 'handoff',
    targetAgentId: to,
    childWorkItemId: res.id,
    deduped: res.deduped,
    at: Date.now(),
  })
  await store.appendTrace(id, seq, ho)
  bus.publish(`workitem:${id}`, { seq, event: ho })
  seq++
}
```

(This mirrors the `dispatch_rejected` warning append right below it — same `appendTrace`/`publish`/`seq++` seam. If `deps.deliver`'s type needs widening per Interfaces, do it in the same commit in the `AgentRuntime` type declaration.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test packages/server/src/runObserver.dispatch.test.ts -t "appends a handoff event"`
Expected: PASS.

- [ ] **Step 5: Run the full runObserver + dispatch suites (no regression)**

Run: `yarn test packages/server/src/runObserver.dispatch.test.ts packages/server/src/runObserver.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/runObserver.ts packages/server/src/runObserver.dispatch.test.ts
git commit -m "feat(server): emit a handoff trace event on the parent run when a child is delivered"
```

---

### Task 3: React — extract a pure thread-projection function (refactor, no behavior change)

**Files:**
- Create: `packages/react/src/buildThreadItems.ts`
- Modify: `packages/react/src/components/AgentModal/AgentModal.tsx` (use the extracted function for the assistant/system message mapping)
- Test: `packages/react/src/buildThreadItems.test.ts`

**Interfaces:**
- Produces: `type ThreadItem = { kind: 'text'; id; text } | { kind: 'toolCall'; id; toolCall: ToolCall } | { kind: 'lifecycle'; id; text } | { kind: 'handoff'; id; targetAgentId; childWorkItemId; deduped }`; `buildThreadItems(messages: Message[], opts: { renderableToolNames: ReadonlySet<string>; devMode: boolean }): ThreadItem[]` — pure, ordered by the input message order.
- Consumes: `pairToolResults` is still used by `AgentModal` for tool results; `buildThreadItems` returns the ordered items, `AgentModal` maps each item to JSX.

- [ ] **Step 1: Write the failing test (order is the assertion)**

```ts
import { describe, expect, it } from 'vitest'
import type { Message } from '@atizar/core'
import { buildThreadItems } from './buildThreadItems.js'

const opts = { renderableToolNames: new Set<string>(), devMode: false }

describe('buildThreadItems', () => {
  it('preserves message order: text then lifecycle', () => {
    const messages = [
      { id: 'a1', role: 'assistant', content: 'sorting' },
      { id: 'sys', role: 'system', content: 'Done' },
    ] as Message[]
    const items = buildThreadItems(messages, opts)
    expect(items.map((i) => i.kind)).toEqual(['text', 'lifecycle'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test packages/react/src/buildThreadItems.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `buildThreadItems` by lifting AgentModal's current mapping**

Move the logic currently in `AgentModal.tsx`'s `const thread = agent.messages.flatMap(...)` into the pure function — same behavior: `role:'system'` → `{kind:'lifecycle'}`; `role:'assistant'` text → `{kind:'text'}`; assistant `toolCalls` (filtered by `renderableToolNames` unless `devMode`) → `{kind:'toolCall'}`. Return the flat ordered array. Do NOT yet handle `role:'handoff'` (Task 4).

- [ ] **Step 4: Use it from AgentModal**

In `AgentModal.tsx`, replace the inline `flatMap` with `const items = buildThreadItems(agent.messages, { renderableToolNames, devMode: isDevMode })` and render `items.map(...)` to the same JSX the inline version produced (text bubble / lifecycle banner / `renderToolCall` for toolCall). Keep `pairToolResults`/`toolMessageByCallId` for passing `toolMessage` into `renderToolCall`.

- [ ] **Step 5: Run the test + existing AgentModal tests**

Run: `yarn test packages/react/src/buildThreadItems.test.ts packages/react/src/components/AgentModal`
Expected: all PASS (refactor preserved behavior).

- [ ] **Step 6: Build the react lib (CSS/types) and commit**

```bash
yarn workspace @atizar/react build
git add packages/react/src/buildThreadItems.ts packages/react/src/buildThreadItems.test.ts packages/react/src/components/AgentModal/AgentModal.tsx
git commit -m "refactor(react): extract pure buildThreadItems thread projection"
```

---

### Task 4: React — render the handoff item inline; cover order + streaming prefix

**Files:**
- Modify: `packages/react/src/buildThreadItems.ts` (handle `role:'handoff'`), `packages/react/src/components/AgentModal/AgentModal.tsx` (render the handoff item; resolve label + open-target)
- Test: `packages/react/src/buildThreadItems.test.ts`, `packages/react/src/components/AgentModal/AgentModal.order.test.tsx` (new)

**Interfaces:**
- Consumes: the `role:'handoff'` folded message from Task 1; `ThreadItem` from Task 3.
- Produces: a `{kind:'handoff'}` ThreadItem only for `deduped === false` (a deduped route handed nothing off new — it is not a timeline note). The visible "→ Handed to <name>" + an "Open" affordance use the app-supplied label resolution already passed to `AgentModal`.

- [ ] **Step 1: Write the failing projection test (full order + prefix)**

```ts
it('places a handoff between text and report, and never above earlier text in a prefix', () => {
  const full = [
    { id: 'a1', role: 'assistant', content: 'sorting' },
    { id: 'handoff-c1', role: 'handoff', targetAgentId: 'wf__reply', childWorkItemId: 'c1', deduped: false },
    { id: 'a2', role: 'assistant', content: 'summary' },
  ] as unknown as Message[]
  expect(buildThreadItems(full, opts).map((i) => i.kind)).toEqual(['text', 'handoff', 'text'])

  // streaming prefix: only the first two have arrived — handoff stays after the text, not floated up
  const prefix = full.slice(0, 2)
  expect(buildThreadItems(prefix, opts).map((i) => i.kind)).toEqual(['text', 'handoff'])
})

it('drops a deduped handoff from the timeline (no visible note)', () => {
  const messages = [
    { id: 'handoff-c2', role: 'handoff', targetAgentId: 'wf__reader', childWorkItemId: 'c2', deduped: true },
  ] as unknown as Message[]
  expect(buildThreadItems(messages, opts)).toHaveLength(0)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test packages/react/src/buildThreadItems.test.ts -t "handoff"`
Expected: FAIL — handoff messages are currently ignored (no branch), so the first test yields `['text','text']`.

- [ ] **Step 3: Handle `role:'handoff'` in `buildThreadItems`**

Add a branch: if `msg.role === 'handoff'` and `!msg.deduped`, push `{ kind: 'handoff', id: msg.id, targetAgentId: msg.targetAgentId, childWorkItemId: msg.childWorkItemId, deduped: msg.deduped }`; if `deduped`, skip. Position is the message's position (the flatMap preserves order).

- [ ] **Step 4: Render the handoff item in AgentModal**

In `AgentModal.tsx`'s item render, add a case for `kind === 'handoff'`: render the existing `s.threadNote s.sent` markup (`→ Handed <strong>{label}</strong> to {name}` + the Open button), but source `name`/`label` from the app-supplied resolver and the open-target from `childWorkItemId`. Add a prop `resolveHandoff?: (h: { targetAgentId: string; childWorkItemId: string }) => { name: string; label: string; onOpen?: () => void }` to `AgentModalProps`; the consumer (`ThreadModal`/board) supplies it using the existing `nameOf`/`labelOf`/open wiring. (Keep `received` notes as today for now — they sit at the top and do not cause the streaming reorder; their timeline-symmetry is Plan 2 / a follow-up.)

- [ ] **Step 5: Write the AgentModal render-order test**

Create `AgentModal.order.test.tsx` asserting that with a handoff message between two assistant messages, the rendered DOM order is text → "Handed" note → text (use `screen` queries + `compareDocumentPosition` or query-all ordering). Base props from `AgentModal.userTurn.test.tsx`; pass a `resolveHandoff` stub returning `{ name: 'Reply agent', label: 'a draft' }`.

- [ ] **Step 6: Run tests to verify pass**

Run: `yarn test packages/react/src/buildThreadItems.test.ts packages/react/src/components/AgentModal`
Expected: all PASS.

- [ ] **Step 7: Build + commit**

```bash
yarn workspace @atizar/react build
git add packages/react/src/buildThreadItems.ts packages/react/src/buildThreadItems.test.ts packages/react/src/components/AgentModal/
git commit -m "feat(react): render handoff inline by seq; cover order + streaming prefix"
```

---

### Task 5: React — delete the board-topology `sent` reconstruction

**Files:**
- Modify: `packages/react/src/hooks/useBoardNavigation.ts` (drop the `sent` derivation in `notesFor`; keep `received`), `packages/react/src/components/AgentModal/AgentModal.tsx` (delete the layout-pinned `sent.map(...)` block; wire `resolveHandoff` instead), `packages/react/src/components/ThreadModal/ThreadModal.tsx` (pass `resolveHandoff`)
- Test: existing `packages/react/src/boardModel.test.ts` / hook tests stay green; the new order tests cover the replacement.

**Interfaces:**
- Consumes: `resolveHandoff` (Task 4) is now the only source of "Handed to X"; `notesFor` returns only `received` notes.
- Produces: no `sent` notes from board topology anywhere.

- [ ] **Step 1: Write/adjust the failing test**

In the hook/board test, assert `notesFor(scanId)` returns only `received`-dir notes (no `sent`):

```ts
expect(notesFor(scanId).every((n) => n.dir === 'received')).toBe(true)
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test packages/react/src/hooks` (or the file holding `notesFor` coverage)
Expected: FAIL — `notesFor` still emits `sent` notes for children.

- [ ] **Step 3: Remove the `sent` derivation**

In `useBoardNavigation.notesFor`, delete the `for (const child of board.items.filter(...))` loop that pushes `dir:'sent'` notes. Keep the `received` push. Remove now-dead `targetWorkflow`/`targetLocalId` plumbing only if unused elsewhere (grep first).

- [ ] **Step 4: Delete the pinned `sent` block in AgentModal + wire resolveHandoff**

Remove the `{sent.map(...)}` JSX (`AgentModal.tsx:231-252`) and the `const sent = notes.filter(...)` line. The handoff is now rendered inline (Task 4). Provide `resolveHandoff` from `ThreadModal` using the board lookups (`nameOf`/`labelOf`, and `childWorkItemId` → open the instance / cross-workflow open via the child's `workflowId` from `board.items`).

- [ ] **Step 5: Run the react suite + build**

Run: `yarn test packages/react && yarn workspace @atizar/react build`
Expected: all PASS; build clean.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/hooks/useBoardNavigation.ts packages/react/src/components/AgentModal/AgentModal.tsx packages/react/src/components/ThreadModal/ThreadModal.tsx
git commit -m "refactor(react): drop board-topology sent notes; handoff is now a trace event"
```

---

### Task 6: Green gate, foundation check, browser-verify

**Files:** none (verification only).

- [ ] **Step 1: Full green gate from repo root**

Run: `yarn typecheck && yarn test && yarn lint && yarn format:check`
Expected: all PASS. Fix any fallout before proceeding.

- [ ] **Step 2: Run check-foundation**

Invoke the `check-foundation` skill against this diff (touches the trace + dispatch-result flow → I8/I14). Expected verdict: Clear — the `handoff` event is a server-authored CUSTOM note of the same class as the lifecycle note (consistent with I14), payload carries no workflow specifics (I5), no provider/AG-UI contract change (I3/I4).

- [ ] **Step 3: Browser-verify the order (manual cross-check)**

Invoke the `browser-verify` skill. Start `yarn dev`, run a sorter scan, and confirm during **Working** the "→ Handed to …" line appears at its dispatch position and never above the INBOX SORTED card; at **Done** the order is reading → text → card → final text → Done → handoff(s). (Use `DEV_RECORD_REPLAY=record` once if a fresh cassette is needed; concurrent-HITL replay caveats do not apply here.)

- [ ] **Step 4: Final commit (if verification produced fixes)**

```bash
git add -p
git commit -m "test: verify handoff trace event order (green gate + browser)"
```

---

## Self-Review

- **Spec coverage (part 2):** generic `handoff` event with `deduped` (Task 1 core + Task 2 server); inline render by `seq` (Task 4); pure projection making order unit-testable incl. streaming prefix (Tasks 3–4, the spec's Testability requirement); delete board-topology reconstruction + layout-pinned blocks (Task 5); foundation + browser cross-check (Task 6). Part 1 (`ScanResult` counts) is explicitly Plan 2 — out of scope here, but the event it consumes (`deduped` on the handoff) is delivered by Task 1/2.
- **Deferred (called out, not hidden):** `received`-note timeline symmetry is kept as-is (top-anchored) — it does not cause the streaming reorder; converting it to a child-side event is Plan 2 / a follow-up.
- **Type consistency:** `handoffNote`/`HandoffNoteValue` (Task 1) are the exact symbols imported in Task 2; `ThreadItem`/`buildThreadItems` (Task 3) are the exact symbols extended in Task 4; `resolveHandoff` (Task 4) is the exact prop wired in Task 5.
- **Placeholder scan:** test skeletons in Tasks 2/4/5 say "adapt to the file's existing helpers" — that is harness-matching, not a logic placeholder; the assertions and production edits are concrete.
