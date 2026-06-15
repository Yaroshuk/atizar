# Pipeline Lifecycle Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking. Spec: `docs/superpowers/specs/2026-06-15-pipeline-lifecycle-fixes.md`.

**Goal:** Stop duplicate input-agent scans + worker accumulation, stop the "still typing" display on a
scan that's waiting on the human, format the approval-gate source, and default `maxInstances` to 1.

**Architecture:** Approach B from the spec — every work item becomes `finished` when **its own** run
ends (no parent waits for children; the deferral guard and the auto-finish walk are removed). The
pipeline already shows a parent as "Working" while it has a live descendant, so that UX is unchanged.
A human START of an input singleton is gated on **DB tree-liveness** (any ACTIVE node in that input
agent's tree), not on the worker-pool process count.

**Tech Stack:** TypeScript, Drizzle (Postgres), Hono, Vitest, React, yarn-classic workspace.

**Execution rules (from HANDOFF):** one branch off `master`; TDD per task; run the green gate
(`yarn typecheck && yarn test && yarn lint && yarn format:check` + `yarn workspace @atizar/react build`
for any react change) before "done"; **browser-verify every touched flow** (use the `browser-verify`
skill + `DEV_RECORD_REPLAY=1`); subagents must NOT switch branches (`git show <sha>:path`).

---

## Task 0: Branch + foundation gate (no code yet)

**Files:** none (analysis + branch).

- [ ] **Step 1: Create the work branch**

```bash
git checkout master && git pull --ff-only 2>/dev/null; git checkout -b fix/pipeline-lifecycle
git rev-parse --abbrev-ref HEAD   # expect: fix/pipeline-lifecycle
```

- [ ] **Step 2: Audit every reader of "parent stays running while children live" and `autoFinishParent`**

Run and READ each hit — Task 3 removes the deferral guard + the walk, so anything relying on a parent
being `running` purely because a child is live must be re-checked:

```bash
grep -rn "autoFinishParent\|hasActiveChild\|TERMINAL_STATUSES\|getActiveChildren" packages/server/src
grep -rn "status === 'running'\|=== 'running'\|\.status)" packages/server/src/pipelineService.ts packages/server/src/runObserver.ts
grep -rn "running" packages/react/src/pipelineModel.ts packages/react/src/boardModel.ts
```

Confirm (write findings into the PR description): (a) the pipeline shows "Working" via
`pipelineModel.view()`'s `hasLiveDescendant`, NOT via the parent's own DB status; (b) `getResettable`
keys off `RESETTABLE` statuses (a `finished` parent is resettable — fine); (c) aggregate counts
(`aggregate.ts`) count ACTIVE statuses, not "parent is running".

- [ ] **Step 3: Run `check-foundation` for the state-machine change**

Invoke the `check-foundation` skill against: "remove the finish-deferral guard + auto-finish walk so a
parent finishes on its own run-end; gate input START on DB tree-liveness." Record CLEAR / WARN in the
PR description. If WARN: stop and get developer confirmation before Task 3.

---

## Task 1: Store query — `hasLiveInputScan`

**Files:**
- Modify: `packages/server/src/stateStore.ts` (add method after `getFinishedInputRoots`, ~line 220)
- Test: `packages/server/src/stateStore.test.ts` (or the existing store test file — grep first)

- [ ] **Step 1: Write the failing test**

Add to the store test file (mirror existing store-test setup; if none exists, grep
`makeStateStore` in `*.test.ts` and follow that harness):

```ts
it('hasLiveInputScan: true when a root has an awaiting-approval descendant, false when all settled', async () => {
  const store = makeStateStore(db)
  const root = await store.insertWorkItem({ workflowId: 'wf', agentId: 'wf__sorter', origin: 'human' })
  const child = await store.insertWorkItem({ workflowId: 'wf', agentId: 'wf__reply', origin: 'agent', parentId: root.id })
  // root finished (Approach B: finishes on its own run-end), child still awaiting → scan is LIVE
  await transition(db, root.id, 'start'); await transition(db, root.id, 'finish')
  await transition(db, child.id, 'start'); await transition(db, child.id, 'gate')
  expect(await store.hasLiveInputScan('wf', 'wf__sorter')).toBe(true)
  // child settles → scan no longer live
  await transition(db, child.id, 'reject')
  expect(await store.hasLiveInputScan('wf', 'wf__sorter')).toBe(false)
})
```

- [ ] **Step 2: Run it — expect FAIL** (`hasLiveInputScan is not a function`)

```bash
yarn test --filter @atizar/server -t "hasLiveInputScan"
```

- [ ] **Step 3: Implement the method** (insert after `getFinishedInputRoots`, before `appendAudit`)

```ts
    // True when this input agent (workflow × agentId) has at least one non-'closed' root whose
    // tree still contains an ACTIVE node (the root itself, or any transitive descendant). Under
    // Approach B a root finishes on its own run-end, so a 'finished' root with awaiting-approval
    // children still counts as a LIVE scan — this is the singleton-START gate's source of truth
    // (replaces the worker-pool process count, which is freed the moment the run/​gate suspends).
    async hasLiveInputScan(workflowId: string, agentId: string): Promise<boolean> {
      const rows = await db.select().from(workItems).where(eq(workItems.workflowId, workflowId))
      const childrenOf = new Map<string, WorkItem[]>()
      for (const r of rows) {
        if (!r.parentId) continue
        const arr = childrenOf.get(r.parentId) ?? []
        arr.push(r)
        childrenOf.set(r.parentId, arr)
      }
      const subtreeLive = (id: string, seen = new Set<string>()): boolean => {
        if (seen.has(id)) return false
        seen.add(id)
        for (const kid of childrenOf.get(id) ?? []) {
          if (ACTIVE.includes(kid.status) || subtreeLive(kid.id, seen)) return true
        }
        return false
      }
      return rows.some(
        (r) =>
          r.agentId === agentId &&
          !r.parentId &&
          r.status !== 'closed' &&
          (ACTIVE.includes(r.status) || subtreeLive(r.id))
      )
    },
```

Ensure `ACTIVE` is imported at the top of `stateStore.ts` (it already imports from `./transition.js`
or `./db/schema.js` — grep `ACTIVE` in the file; if absent, add `import { ACTIVE } from './transition.js'`).

- [ ] **Step 4: Run it — expect PASS**

```bash
yarn test --filter @atizar/server -t "hasLiveInputScan"
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/stateStore.ts packages/server/src/stateStore.test.ts
git commit -m "feat(server): hasLiveInputScan — DB tree-liveness for the input-START gate"
```

---

## Task 2: Gate the human START on tree-liveness (Bug 1)

**Files:**
- Modify: `packages/server/src/pipelineService.ts:246-252`
- Test: `packages/server/src/pipelineService.test.ts`

- [ ] **Step 1: Write the failing test** (add to pipelineService.test.ts — mirror its dispatch harness)

```ts
it('rejects a second human START of the input agent while the prior scan is still live', async () => {
  const first = await service.dispatch({ workflowId: 'email-inbox', agentId: 'email-inbox__sorter', origin: 'human', payload: {} })
  expect(first.rejected).toBeUndefined()
  // simulate the scan reaching "root finished, child awaiting approval" (Approach B steady state)
  // (use the test helpers the file already uses to drive a child to awaiting_approval under `first.id`)
  // ... drive a child of first.id to awaiting_approval ...
  const second = await service.dispatch({ workflowId: 'email-inbox', agentId: 'email-inbox__sorter', origin: 'human', payload: {} })
  expect(second.rejected).toBe('already_running')
})
```

> If the existing harness can't easily seed a child, assert the simpler invariant instead: a second
> START while `first` is `running` (no children yet) is rejected — `hasLiveInputScan` returns true for
> an ACTIVE root too. Keep whichever the harness supports; both exercise the gate.

- [ ] **Step 2: Run it — expect FAIL** (second START currently returns an id, not `already_running`)

```bash
yarn test --filter @atizar/server -t "second human START"
```

- [ ] **Step 3: Replace the pool-count gate with the tree-liveness gate**

In `pipelineService.ts`, replace lines 246-252 (the `maxInstances`/`pool.activeCount` block):

```ts
      const runtime = deps.resolveAgent(req.agentId)
      const maxInstances = runtime?.maxInstances ?? 1
      // F6 (revised): a second human START of a SINGLETON input agent is rejected while that agent
      // still has a LIVE scan — keyed off DB tree-liveness, NOT pool.activeCount. The pool frees a
      // slot the moment a run ends or suspends at a gate, so the old count read 0 while a scan was
      // still awaiting the human → duplicate roots leaked. Tree-liveness counts a 'finished' root
      // with awaiting-approval children as live (Approach B). Non-singletons still queue overflow;
      // machine dispatch (origin 'agent') is handled by the chokepoint.
      if (
        req.origin === 'human' &&
        maxInstances === 1 &&
        isInputAgent(req.agentId) &&
        (await store.hasLiveInputScan(req.workflowId, req.agentId))
      ) {
        return { id: '', deduped: false, rejected: 'already_running' }
      }
```

(Note: `isInputAgent` and `store` are already in scope in this closure.)

- [ ] **Step 4: Run it — expect PASS**, plus the full server suite (no regression to supersede/reset)

```bash
yarn test --filter @atizar/server
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/pipelineService.ts packages/server/src/pipelineService.test.ts
git commit -m "fix(server): gate input START on DB tree-liveness, not pool count (Bug 1)"
```

---

## Task 3: Finish a parent on its OWN run-end (Bug 4 root) — FOUNDATION CHANGE

**Files:**
- Modify: `packages/server/src/transition.ts` (remove the deferral guard line 119; remove
  `autoFinishParent` 89-99 and its invocation 131-135; keep `hasActiveChild`/`ACTIVE` exports if still
  used — `hasActiveChild` is used only by the removed code, so remove it too if no other reader)
- Test: `packages/server/src/transition.test.ts`

> **Gate:** Task 0 Step 3 (`check-foundation`) must be CLEAR (or developer-confirmed) before this task.

- [ ] **Step 1: Update the test that asserts the OLD deferral, write the NEW behavior**

Grep the existing assertions first:

```bash
grep -n "active child\|autoFinish\|stays running\|deferred\|parent" packages/server/src/transition.test.ts
```

Replace any "parent stays running while a child is active / child-finish walks the parent to finished"
test with Approach-B behavior:

```ts
it('a parent finishes on its OWN finish edge regardless of live children (Approach B)', async () => {
  const root = await insertItem({ agentId: 'wf__sorter' })
  const child = await insertItem({ agentId: 'wf__reply', parentId: root.id })
  await transition(db, root.id, 'start')
  await transition(db, child.id, 'start'); await transition(db, child.id, 'gate') // child awaiting
  await transition(db, root.id, 'finish')
  expect((await getItem(root.id)).status).toBe('finished')   // NOT deferred to 'running'
  expect((await getItem(child.id)).status).toBe('awaiting_approval') // child untouched
})

it('a child reaching terminal does NOT change its parent (no auto-finish walk)', async () => {
  const root = await insertItem({ agentId: 'wf__sorter' })
  const child = await insertItem({ agentId: 'wf__reply', parentId: root.id })
  await transition(db, root.id, 'start') // parent still running (its own run in flight)
  await transition(db, child.id, 'start'); await transition(db, child.id, 'gate')
  await transition(db, child.id, 'reject')
  expect((await getItem(root.id)).status).toBe('running') // parent unaffected by the child
})
```

- [ ] **Step 2: Run it — expect FAIL** (old code defers the parent finish / walks the parent)

```bash
yarn test --filter @atizar/server -t "Approach B"
```

- [ ] **Step 3: Remove the deferral guard and the auto-finish walk**

In `transition.ts`:

(a) Delete the finish-deferral guard (lines 116-119):

```ts
    // (DELETE these lines)
    if (edge === 'finish' && (await hasActiveChild(tx, id))) return
```

(b) Delete the parent-walk after the UPDATE (lines 131-135):

```ts
    // (DELETE these lines)
    if (row.parentId && TERMINAL_STATUSES.includes(spec.to))
      await autoFinishParent(tx, row.parentId)
```

(c) Delete the now-dead helpers `autoFinishParent` (89-99), `hasActiveChild` (77-83), and the
`TERMINAL_STATUSES` const (70) — confirm via grep they have no other readers:

```bash
grep -rn "autoFinishParent\|hasActiveChild\|TERMINAL_STATUSES" packages/server/src
```

(d) Update the `EDGES.finish` comment and the file header to state the new rule: "every item finishes
on its OWN run-end; a parent is shown 'Working' purely by the pipeline's live-descendant derivation, not
by its DB status." Keep `ACTIVE` exported (still used by stateStore + boardModel-side imports). `RESETTABLE`
export stays.

- [ ] **Step 4: Run it — expect PASS**, plus full server suite

```bash
yarn test --filter @atizar/server
```

- [ ] **Step 5: Verify the pipeline still shows a finished parent as "Working" while children live**

Add/confirm a `pipelineModel.test.ts` assertion (the file already tests `buildPipeline`):

```ts
it('a finished parent with an awaiting-approval child still renders as Working (live-descendant)', () => {
  const blocks = buildPipeline([
    pinst({ localId: 'r', agentId: 'sorter', isInput: true, status: 'finished' }),
    pinst({ localId: 'c', agentId: 'reply', parentLocalId: 'r', status: 'awaiting_approval' }),
  ], {})
  expect(blocks[0].parent.status).toBe('running') // view() override via hasLiveDescendant
})
```

```bash
yarn test --filter @atizar/react -t "still renders as Working"
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/transition.ts packages/server/src/transition.test.ts packages/react/src/pipelineModel.test.ts
git commit -m "fix(server): finish a parent on its own run-end; drop the deferral + auto-finish walk (Bug 4 root, Approach B)"
```

---

## Task 4: SourcePanel — format a nested payload object (Bug 5)

**Files:**
- Modify: `packages/react/src/components/SourcePanel/SourcePanel.tsx`
- Test: `packages/react/src/components/SourcePanel/SourcePanel.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react'
import { SourcePanel } from './SourcePanel'

it('flattens a nested payload object into labelled fields (not raw JSON)', () => {
  render(<SourcePanel source={{ email: {
    from: 'A <a@b.c>', subject: 'Hi', snippet: 'hello there',
    date: 'Mon', threadId: 't1', messageId: 'm1',
  } }} />)
  expect(screen.getByText('hello there')).toBeInTheDocument()      // snippet shown
  expect(screen.getByText('Hi')).toBeInTheDocument()               // subject shown
  expect(screen.queryByText(/\{".*"\}/)).not.toBeInTheDocument()   // NO raw JSON blob
  expect(screen.queryByText('m1')).not.toBeInTheDocument()         // id hidden
})
```

- [ ] **Step 2: Run it — expect FAIL** (current code renders the email object as one JSON string)

```bash
yarn test --filter @atizar/react -t "flattens a nested payload"
```

- [ ] **Step 3: Implement one-level flattening + hide ids**

Replace the body of `SourcePanel.tsx` (keep the file header comment):

```tsx
import s from './SourcePanel.module.scss'

// Keys that are plumbing, not human-meaningful — hidden from the panel (applied at every level).
const HIDDEN_KEYS: ReadonlySet<string> = new Set(['origin', 'threadId', 'messageId'])

type SourcePanelProps = {
  source: Record<string, unknown>
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// Flatten ONE level: a nested object (e.g. payload `{ email: {...} }`) contributes its inner
// fields directly, so the panel shows from/subject/snippet — never a raw JSON blob. Deeper
// nesting / arrays fall back to a string. Plumbing ids (HIDDEN_KEYS) are dropped at every level.
const flatten = (source: Record<string, unknown>): [string, string][] => {
  const out: [string, string][] = []
  const push = (k: string, v: unknown) => {
    if (HIDDEN_KEYS.has(k) || v === undefined || v === null || v === '') return
    out.push([k, typeof v === 'string' ? v : JSON.stringify(v)])
  }
  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value)) for (const [k, v] of Object.entries(value)) push(k, v)
    else push(key, value)
  }
  return out
}

export const SourcePanel = ({ source }: SourcePanelProps) => {
  const fields = flatten(source)
  if (fields.length === 0) return null
  return (
    <div className={s.panel}>
      <div className={s.label}>Untrusted external content</div>
      <dl className={s.fields}>
        {fields.map(([key, value]) => (
          <div className={s.field} key={key}>
            <dt className={s.key}>{key}</dt>
            <dd className={s.value}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
```

- [ ] **Step 4: Run it — expect PASS**

```bash
yarn test --filter @atizar/react -t "flattens a nested payload"
```

- [ ] **Step 5: Build the react package (CSS-module + types compile)**

```bash
yarn workspace @atizar/react build
```

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/components/SourcePanel/SourcePanel.tsx packages/react/src/components/SourcePanel/SourcePanel.test.tsx
git commit -m "fix(react): SourcePanel flattens a nested payload object; hide ids (Bug 5)"
```

---

## Task 5: Default `maxInstances` 2 → 1 + explicit reply concurrency

**Files:**
- Modify: `packages/core/src/defineAgent.ts:19`
- Modify: `packages/core/src/defineAgent.test.ts:138-139`
- Modify: `apps/inbox/workflows/email-inbox/descriptor.ts:30-41` (replyAgent)

- [ ] **Step 1: Update the default test to assert 1**

In `defineAgent.test.ts` replace lines 138-139:

```ts
  it('defaults to 1 when omitted', () => {
    expect(defineAgent({ ...base }).maxInstances).toBe(1)
  })
```

- [ ] **Step 2: Run it — expect FAIL** (current default is 2)

```bash
yarn test --filter @atizar/core -t "maxInstances"
```

- [ ] **Step 3: Change the default**

In `defineAgent.ts:19`:

```ts
    maxInstances: z.number().int().positive().default(1),
```

- [ ] **Step 4: Add explicit concurrency to the reply agent** (it fans out one instance per email)

In `descriptor.ts`, inside `replyAgent = defineAgent({ ... })`, add after `renders: {...}` (line 40):

```ts
  maxInstances: 2, // one reply instance per email → allow up to 2 concurrent drafts
```

- [ ] **Step 5: Run the suites — expect PASS** (core default + descriptor test; descriptor.test
asserts sorter===1, still valid)

```bash
yarn test --filter @atizar/core && yarn test --filter @atizar/inbox 2>/dev/null || yarn test
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/defineAgent.ts packages/core/src/defineAgent.test.ts apps/inbox/workflows/email-inbox/descriptor.ts
git commit -m "feat(core): default maxInstances to 1 (concurrency is opt-in); reply opts into 2"
```

---

## Task 6: `definePrompt` escape-hatch comment + CONVENTIONS note

**Files:**
- Modify: `packages/core/src/definePrompt.ts` (comment above `export function definePrompt`)
- Modify: `docs/CONVENTIONS.md` (add a short note in the prompts section)

- [ ] **Step 1: Add the escape-hatch comment** (no test — doc only; insert above line 21)

```ts
// ESCAPE HATCH: definePrompt is sugar, not a cage. It models a 3-hook lifecycle (onInput/onStart/
// onResume), forwards only `executedResult` to onResume (drops the resume tool-call `args`), and
// decodes a single `input` schema. Need more — the resume `args`, multiple handoff shapes, or any
// other branching? Pass a raw `PromptStrategy` object ({ buildFirst, buildResume }) straight into
// the agent's `prompts` — it is accepted everywhere definePrompt's output is (providers.ts:40).
```

- [ ] **Step 2: Add the CONVENTIONS note** (under the prompts/definePrompt convention; if none, add a
short subsection)

```md
- **Prompts: `definePrompt` is the default, a raw `PromptStrategy` is the escape hatch.** Use
  `definePrompt` for the common 3-hook lifecycle (onInput/onStart/onResume). When you need the resume
  tool-call `args`, multiple input shapes, or other branching, pass a raw `PromptStrategy`
  (`{ buildFirst, buildResume }`) directly into the agent's `prompts` — no flexibility is lost.
```

- [ ] **Step 3: Typecheck (doc/comment only — no behavior change)**

```bash
yarn typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/definePrompt.ts docs/CONVENTIONS.md
git commit -m "docs(core): document the raw-PromptStrategy escape hatch for definePrompt"
```

---

## Task 7: Full green gate + browser-verify every flow

**Files:** none (verification).

- [ ] **Step 1: Green gate from repo root**

```bash
yarn typecheck && yarn test && yarn lint && yarn format:check && yarn workspace @atizar/react build
```

Expected: all green (≥530 tests). Fix anything red before proceeding.

- [ ] **Step 2: Browser-verify (invoke the `browser-verify` skill; `DEV_RECORD_REPLAY=1`)**

Run EACH flow and record the result (reserve "verified" for what ran in the browser):

1. **Single scan:** START sorter → it routes, emits summary + handoffs. **Bug 4:** the sorter thread
   shows **no** typing bubble and header is **not** "Working…" right after it finishes its turn; the
   **pipeline** still shows the sorter block "Working" while children await approval.
2. **Singleton (Bug 1):** with a scan live (children awaiting), `POST /api/dispatch` for the sorter →
   **409**; the UI never shows a second sorter instance.
3. **No accumulation:** approve/reject all children → sorter + tree leave the pipeline; type-cards show
   "Done"; re-START → exactly one fresh scan (prior superseded). Repeat ×3 → never >1 live scan, never
   >1 live reader/spam.
4. **Source panel (Bug 5):** open a reply gate → email shows **from / subject / snippet** formatted,
   **no** raw JSON.
5. **Approve with edit:** edit a reply draft → Save draft → the EDITED body lands as the Gmail draft
   (fetch by id), gate `resolved`, one ledger row, item `finished`.
6. **Reject + re-run:** reject → item terminal, zero ledger rows; explicit re-run works.
7. **Cancel mid-run / Reload mid-run / Second-tab coherence:** per the browser-verify checklist.

- [ ] **Step 3: Confirm true replay** (cassette mtimes unchanged) — Bug-1/4 are server-state, but the
flows above run on the recorded cassette:

```bash
ls -la apps/inbox/.cassettes/   # mtimes must be unchanged after the run
```

- [ ] **Step 4: Merge to master + update HANDOFF**

```bash
git checkout master && git merge --no-ff fix/pipeline-lifecycle
git branch -d fix/pipeline-lifecycle
```

Update `HANDOFF.md` "Where we are" + remove these items from NEXT; keep it short.

---

## Self-Review (done while writing)

- **Spec coverage:** Bug 1 → Tasks 1+2; Bug 4 → Task 3 (fixed for free by B) + verified Task 7;
  Bug 5 → Task 4; Change A (default 1) → Task 5; Change B (escape-hatch doc) → Task 6; foundation gate
  → Task 0; acceptance criteria → Task 7. All spec sections mapped.
- **Type/name consistency:** `hasLiveInputScan(workflowId, agentId)` defined in Task 1, called in Task 2.
  `isInputAgent`, `store`, `ACTIVE`, `RESETTABLE` reused as they exist today. `flatten`/`isPlainObject`
  local to SourcePanel.
- **No placeholders:** every code step shows the actual code; the one "find then adapt" (existing
  transition/pipelineService test harness) is bounded by a concrete grep + the exact new assertions.
