# WS2 — Render/HITL Registry Scoping Per Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Scope the client render/HITL component resolution by `(workflowId, toolName)` instead of bare `toolName`, so two workflows can register the same tool name with different components and each resolves to the right one.

**Architecture:** Add a `workflowId` field to `RenderSpec`/`HitlSpec` (each spec self-describes its workflow), add pure `byWorkflow`/`renderableNamesFor` lookup helpers in `@atizar/react`, and thread a `workflowId` through `ThreadModal` → `buildRenderToolCall` + the gate-slot HITL resolution. `BoardInner` computes the renderable-tool-name set scoped to the active workflow. The userland aggregator (`apps/inbox/client/src/workflows.ts`) stamps each workflow's `workflowId` onto its specs and dedups WITHIN a workflow only — the package stays workflow-agnostic (still a userland-injected map, just keyed by workflow). This honors I5: `@atizar/react` holds no card/workflow knowledge.

**Tech Stack:** TypeScript, React 18, Vite library build (`@atizar/react`), vitest + @testing-library/react, zod (spec `parameters`), yarn-classic workspace.

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `packages/react/src/renderSpecs.ts` | Modify | Add `workflowId: string` to `RenderSpec` and `HitlSpec`. |
| `packages/react/src/registryScope.ts` | Create | Pure helpers: `byWorkflow(specs, workflowId)` + `renderableNamesFor(config, workflowId)`. |
| `packages/react/src/registryScope.test.ts` | Create (Test) | Unit tests: scoping resolves same tool-name → different component by workflow; renderable-name set is workflow-scoped. |
| `packages/react/src/buildRenderToolCall.tsx` | Modify | (No signature change — it already takes a pre-filtered `RenderSpec[]`; verify the doc comment.) |
| `packages/react/src/buildRenderToolCall.test.tsx` | Create (Test) | Unit test: two workflows, same tool name, different component → each pre-filtered spec list renders its own component. |
| `packages/react/src/components/ThreadModal/ThreadModal.tsx` | Modify | Accept `workflowId` prop; resolve renders + the gate HITL spec scoped to that workflow. |
| `packages/react/src/index.ts` | Modify | Export `byWorkflow` + `renderableNamesFor`. |
| `apps/inbox/client/src/BoardApp/BoardInner.tsx` | Modify | Compute `renderableToolNames` via `renderableNamesFor(config, nav.workflow.id)`; pass `workflowId` to `ThreadModal`; scope the type-view `AgentModal` renderable set too. |
| `apps/inbox/client/src/workflows.ts` | Modify | Stamp `workflowId` onto each workflow's specs; replace global `byName` with a within-workflow dedup. |

> The `AgentModal` itself does **not** change: it receives `renderToolCall` (already workflow-scoped via `ThreadModal`) and `renderableToolNames` (already workflow-scoped via `BoardInner`). No new prop is needed on `AgentModal`.

> **Secondary (optional, skip if it balloons):** a per-workflow typed tool-name `as const` object. Task 7 is OPTIONAL and explicitly fenced — do it only if Tasks 1–6 are green and it stays a few lines.

---

### Task 1: Add `workflowId` to `RenderSpec` / `HitlSpec`

**Files:**
- `packages/react/src/renderSpecs.ts` (modify — `RenderSpec` ~lines 13-18, `HitlSpec` ~lines 24-34)

- [ ] **Step 1: Verify the current branch (do NOT switch).** Run:
  ```
  git rev-parse --abbrev-ref HEAD
  ```
  Expected output: `analysis/workflow-rerun-semantics`. (This plan's tasks all stay on this branch; if a subagent needs history it uses `git show <sha>:path`, never `git checkout`/`git switch`.)

- [ ] **Step 2: Add `workflowId` to `RenderSpec`.** In `packages/react/src/renderSpecs.ts`, change the `RenderSpec` type. Replace:
  ```ts
  export type RenderSpec = {
    toolName: string
    parameters: z.ZodTypeAny
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render: (ctx: { parameters: any }, deliver: DeliverFn) => ReactElement
  }
  ```
  with:
  ```ts
  export type RenderSpec = {
    // Which workflow this spec belongs to. Resolution is scoped by (workflowId, toolName) so
    // two workflows can register the same tool name with different components. The userland
    // aggregator stamps this from each workflow's client module — the package stays
    // workflow-agnostic (no card knowledge), it just keys by workflow.
    workflowId: string
    toolName: string
    parameters: z.ZodTypeAny
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render: (ctx: { parameters: any }, deliver: DeliverFn) => ReactElement
  }
  ```

- [ ] **Step 3: Add `workflowId` to `HitlSpec`.** In the same file, change the `HitlSpec` type. Replace:
  ```ts
  export type HitlSpec = {
    toolName: string
    parameters: z.ZodTypeAny
  ```
  with:
  ```ts
  export type HitlSpec = {
    // See RenderSpec.workflowId — HITL resolution is scoped by (workflowId, toolName) too.
    workflowId: string
    toolName: string
    parameters: z.ZodTypeAny
  ```

- [ ] **Step 4: Run typecheck to confirm the controlled breakage.** From repo root:
  ```
  yarn typecheck
  ```
  Expected: FAIL — TS errors in `apps/inbox/workflows/lead-inbox/client.tsx`, `github-triage/client.tsx`, `email-inbox/client.tsx` (the spec object literals now miss the required `workflowId`), `apps/inbox/client/src/workflows.ts`, and `packages/react/src/lookups.test.ts` style call sites if any spread specs. This is the expected TDD red — the next tasks fill it in. (If `yarn typecheck` is green, the field was already optional somewhere — re-check Step 2/3.)

- [ ] **Step 5: Commit the type change.** From repo root:
  ```
  git add packages/react/src/renderSpecs.ts
  git commit -m "feat(react): add workflowId to RenderSpec/HitlSpec for scoped resolution

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 2: Pure scoping helpers (`byWorkflow`, `renderableNamesFor`)

**Files:**
- `packages/react/src/registryScope.test.ts` (create)
- `packages/react/src/registryScope.ts` (create)

- [ ] **Step 1: Write the failing test.** Create `packages/react/src/registryScope.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { byWorkflow, renderableNamesFor } from './registryScope'
  import type { RenderSpec, HitlSpec } from './renderSpecs'
  import type { WorkflowsConfig } from './workflowsContext'

  // Minimal RenderSpec stubs — render is irrelevant to the scoping logic, so a no-op.
  const r = (workflowId: string, toolName: string): RenderSpec =>
    ({ workflowId, toolName, parameters: {}, render: () => null }) as unknown as RenderSpec
  const h = (workflowId: string, toolName: string): HitlSpec =>
    ({ workflowId, toolName, parameters: {}, render: () => null }) as unknown as HitlSpec

  describe('byWorkflow', () => {
    it('returns only the specs of the given workflow', () => {
      const specs = [r('wf-a', 'shared'), r('wf-b', 'shared'), r('wf-a', 'onlyA')]
      const a = byWorkflow(specs, 'wf-a')
      expect(a).toHaveLength(2)
      expect(a.map((s) => s.toolName).sort()).toEqual(['onlyA', 'shared'])
      expect(byWorkflow(specs, 'wf-b')).toHaveLength(1)
      expect(byWorkflow(specs, 'wf-b')[0].workflowId).toBe('wf-b')
    })

    it('returns [] for an unknown workflow', () => {
      expect(byWorkflow([r('wf-a', 'x')], 'nope')).toEqual([])
    })
  })

  describe('renderableNamesFor', () => {
    it('unions render + HITL tool names scoped to one workflow', () => {
      const config = {
        renders: [r('wf-a', 'renderLead'), r('wf-b', 'renderLead'), r('wf-a', 'renderSort')],
        hitl: [h('wf-a', 'saveDraft'), h('wf-b', 'applyActions')],
      } as unknown as WorkflowsConfig
      const a = renderableNamesFor(config, 'wf-a')
      expect([...a].sort()).toEqual(['renderLead', 'renderSort', 'saveDraft'])
      const b = renderableNamesFor(config, 'wf-b')
      expect([...b].sort()).toEqual(['applyActions', 'renderLead'])
      // wf-b must NOT see wf-a's saveDraft / renderSort.
      expect(b.has('saveDraft')).toBe(false)
      expect(b.has('renderSort')).toBe(false)
    })
  })
  ```

- [ ] **Step 2: Run the test (expected FAIL).** From repo root:
  ```
  yarn test registryScope
  ```
  Expected: FAIL — `Cannot find module './registryScope'` (the file doesn't exist yet).

- [ ] **Step 3: Implement the helpers.** Create `packages/react/src/registryScope.ts`:
  ```ts
  import type { RenderSpec, HitlSpec } from './renderSpecs'
  import type { WorkflowsConfig } from './workflowsContext'

  // Render/HITL resolution is scoped by (workflowId, toolName), mirroring how the SERVER scopes
  // effects per agent-runtime. The package holds no card knowledge — these are pure filters over
  // the userland-injected, workflow-keyed specs.

  // The specs belonging to one workflow (a render OR hitl list filtered by workflowId).
  export const byWorkflow = <T extends { workflowId: string }>(
    specs: T[],
    workflowId: string
  ): T[] => specs.filter((s) => s.workflowId === workflowId)

  // The tool names that render as generative-UI cards FOR ONE WORKFLOW (render + HITL union).
  // AgentModal hides any tool not in this set (unless dev mode). Scoped so a tool name owned by
  // a different workflow does not leak into this workflow's thread.
  export const renderableNamesFor = (
    config: Pick<WorkflowsConfig, 'renders' | 'hitl'>,
    workflowId: string
  ): ReadonlySet<string> =>
    new Set<string>([
      ...byWorkflow(config.renders, workflowId).map((s) => s.toolName),
      ...byWorkflow(config.hitl, workflowId).map((s) => s.toolName),
    ])
  ```

- [ ] **Step 4: Run the test (expected PASS).** From repo root:
  ```
  yarn test registryScope
  ```
  Expected: PASS — `byWorkflow` (2 tests) + `renderableNamesFor` (1 test) all green.

- [ ] **Step 5: Commit.** From repo root:
  ```
  git add packages/react/src/registryScope.ts packages/react/src/registryScope.test.ts
  git commit -m "feat(react): pure byWorkflow + renderableNamesFor scoping helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 3: `buildRenderToolCall` — verify + test workflow-scoped resolution

> `buildRenderToolCall` already takes a `RenderSpec[]` argument and matches by `toolName`. Once the caller (`ThreadModal`) passes a workflow-scoped list, resolution is correct — no signature change. This task adds the regression test proving two workflows' same-name tools resolve to different components, and tightens the doc comment.

**Files:**
- `packages/react/src/buildRenderToolCall.test.tsx` (create)
- `packages/react/src/buildRenderToolCall.tsx` (modify — comment only, ~lines 4-10)

- [ ] **Step 1: Write the failing test.** Create `packages/react/src/buildRenderToolCall.test.tsx`:
  ```tsx
  import '@testing-library/jest-dom/vitest'
  import { describe, it, expect } from 'vitest'
  import { render, screen } from '@testing-library/react'
  import { z } from 'zod'
  import { buildRenderToolCall } from './buildRenderToolCall'
  import { byWorkflow } from './registryScope'
  import type { RenderSpec, DeliverFn } from './renderSpecs'
  import type { ToolCall } from '@atizar/core'

  const noopDeliver: DeliverFn = () => {}

  // Two workflows register the SAME tool name with DIFFERENT components.
  const specs: RenderSpec[] = [
    {
      workflowId: 'wf-a',
      toolName: 'renderCard',
      parameters: z.object({}),
      render: () => <div>From A</div>,
    },
    {
      workflowId: 'wf-b',
      toolName: 'renderCard',
      parameters: z.object({}),
      render: () => <div>From B</div>,
    },
  ]

  const call = (name: string): ToolCall =>
    ({ id: 'tc1', function: { name, arguments: '{}' } }) as unknown as ToolCall

  describe('buildRenderToolCall workflow scoping', () => {
    it('resolves the same tool name to each workflow component when fed the scoped list', () => {
      const renderA = buildRenderToolCall(byWorkflow(specs, 'wf-a'), noopDeliver)
      const { unmount } = render(<>{renderA({ toolCall: call('renderCard') })}</>)
      expect(screen.getByText('From A')).toBeInTheDocument()
      expect(screen.queryByText('From B')).not.toBeInTheDocument()
      unmount()

      const renderB = buildRenderToolCall(byWorkflow(specs, 'wf-b'), noopDeliver)
      render(<>{renderB({ toolCall: call('renderCard') })}</>)
      expect(screen.getByText('From B')).toBeInTheDocument()
      expect(screen.queryByText('From A')).not.toBeInTheDocument()
    })

    it('returns null for a tool not in the scoped list', () => {
      const renderA = buildRenderToolCall(byWorkflow(specs, 'wf-a'), noopDeliver)
      expect(renderA({ toolCall: call('renderOther') })).toBeNull()
    })
  })
  ```

- [ ] **Step 2: Run the test (expected PASS — it should already pass).** From repo root:
  ```
  yarn test buildRenderToolCall
  ```
  Expected: PASS — both tests green. (`buildRenderToolCall` already matches by `toolName` within whatever list it's given; the scoping is supplied by `byWorkflow`. This test locks that contract so a future regression that re-flattens the registry fails here.)

- [ ] **Step 3: Tighten the doc comment to reflect scoping.** In `packages/react/src/buildRenderToolCall.tsx`, replace the comment block (lines 4-10, ending `…the package holds no userland cards.`):
  ```tsx
  // Local replacement for CopilotKit's useRenderToolCall: given a folded assistant tool call,
  // parse its args and dispatch to the matching pure render spec (the generative-UI card).
  // `deliver` is the handoff seam (POST /api/deliver). A tool with no registered render spec
  // (a data-fetch tool like list_my_tickets) returns null — AgentModal already filters those
  // out by `renderableToolNames` unless dev mode is on. Specs are injected (from the
  // WorkflowsConfig context), not statically imported — the package holds no userland cards.
  ```
  with:
  ```tsx
  // Local replacement for CopilotKit's useRenderToolCall: given a folded assistant tool call,
  // parse its args and dispatch to the matching pure render spec (the generative-UI card).
  // `deliver` is the handoff seam (POST /api/deliver). A tool with no registered render spec
  // (a data-fetch tool like list_my_tickets) returns null — AgentModal already filters those
  // out by `renderableToolNames` unless dev mode is on. Specs are injected (from the
  // WorkflowsConfig context), not statically imported — the package holds no userland cards.
  // The caller passes an ALREADY-WORKFLOW-SCOPED list (via byWorkflow): resolution is by
  // toolName WITHIN one workflow, so two workflows' same-named tools resolve independently.
  ```

- [ ] **Step 4: Run the test again (still PASS).** From repo root:
  ```
  yarn test buildRenderToolCall
  ```
  Expected: PASS — comment-only change, still green.

- [ ] **Step 5: Commit.** From repo root:
  ```
  git add packages/react/src/buildRenderToolCall.tsx packages/react/src/buildRenderToolCall.test.tsx
  git commit -m "test(react): lock workflow-scoped buildRenderToolCall resolution

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 4: `ThreadModal` — accept `workflowId`, resolve renders + HITL scoped

**Files:**
- `packages/react/src/components/ThreadModal/ThreadModal.tsx` (modify — props ~lines 15-29, body ~lines 31-54)

- [ ] **Step 1: Add `workflowId` to `ThreadModalProps`.** In `packages/react/src/components/ThreadModal/ThreadModal.tsx`, in the `ThreadModalProps` type, add the field after `id` (line 16). Replace:
  ```tsx
  export type ThreadModalProps = {
    id: string
    title: string
  ```
  with:
  ```tsx
  export type ThreadModalProps = {
    id: string
    // The workflow this work item belongs to. Render/HITL resolution is scoped to it so two
    // workflows' same-named tools resolve to the right component (see registryScope.byWorkflow).
    workflowId: string
    title: string
  ```

- [ ] **Step 2: Import `byWorkflow` and scope the render specs.** In the same file, add the import after the `useWorkflowsConfig` import (line 6):
  ```tsx
  import { useWorkflowsConfig } from '../../workflowsContext'
  ```
  becomes:
  ```tsx
  import { useWorkflowsConfig } from '../../workflowsContext'
  import { byWorkflow } from '../../registryScope'
  ```
  Then in the component body, scope both lists. Replace:
  ```tsx
  export const ThreadModal = (p: ThreadModalProps) => {
    const { renders, hitl } = useWorkflowsConfig()
    const { messages, status } = useWorkItemThread(p.id)
  ```
  with:
  ```tsx
  export const ThreadModal = (p: ThreadModalProps) => {
    const config = useWorkflowsConfig()
    const renders = byWorkflow(config.renders, p.workflowId)
    const hitl = byWorkflow(config.hitl, p.workflowId)
    const { messages, status } = useWorkItemThread(p.id)
  ```

- [ ] **Step 3: Pin the `renderToolCall` memo to `p.workflowId`.** In the same file, the `useMemo` deps currently are `[renders, deliver, id]`. Because `renders` is now a fresh array per render (from `byWorkflow`), depend on the stable inputs instead. Replace:
  ```tsx
    const { deliver, id } = p
    const renderToolCall = useMemo(
      () =>
        buildRenderToolCall(renders, (origin, dest, payload) => deliver(origin, dest, payload, id)),
      [renders, deliver, id]
    )
  ```
  with:
  ```tsx
    const { deliver, id, workflowId } = p
    const renderToolCall = useMemo(
      () =>
        buildRenderToolCall(byWorkflow(config.renders, workflowId), (origin, dest, payload) =>
          deliver(origin, dest, payload, id)
        ),
      [config.renders, workflowId, deliver, id]
    )
  ```
  > The standalone `const renders = byWorkflow(...)` from Step 2 stays (it is unused after this step — remove it). Replace the line `const renders = byWorkflow(config.renders, p.workflowId)` by deleting it, keeping only `const hitl = byWorkflow(config.hitl, p.workflowId)`. The gate-slot below uses `hitl`; the memo computes its own scoped renders. This avoids an unused-var lint error.

- [ ] **Step 4: Run typecheck for this file's island.** From repo root:
  ```
  yarn typecheck
  ```
  Expected: still FAIL overall (the userland workflow `client.tsx` specs + `BoardInner`/`workflows.ts` are not updated yet), but NO new errors inside `ThreadModal.tsx` itself. Scan the output: there must be no error pointing at `packages/react/src/components/ThreadModal/ThreadModal.tsx`. (Remaining errors live under `apps/inbox/…` — fixed in Tasks 5–6.)

- [ ] **Step 5: Commit.** From repo root:
  ```
  git add packages/react/src/components/ThreadModal/ThreadModal.tsx
  git commit -m "feat(react): scope ThreadModal render/HITL resolution by workflowId

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 5: Export the helpers + wire `BoardInner` (renderable set + workflowId prop)

**Files:**
- `packages/react/src/index.ts` (modify — near line 26-32, the helper exports)
- `apps/inbox/client/src/BoardApp/BoardInner.tsx` (modify — imports ~lines 17-25, renderable set ~lines 49-54, `ThreadModal` ~lines 108-128, type-view `AgentModal` ~lines 131-146)

- [ ] **Step 1: Export the scoping helpers from the package.** In `packages/react/src/index.ts`, after the `buildRenderToolCall` export (line 32), add:
  ```ts
  export { buildRenderToolCall } from './buildRenderToolCall.js'
  ```
  becomes:
  ```ts
  export { buildRenderToolCall } from './buildRenderToolCall.js'
  export { byWorkflow, renderableNamesFor } from './registryScope.js'
  ```

- [ ] **Step 2: Import `renderableNamesFor` in `BoardInner`.** In `apps/inbox/client/src/BoardApp/BoardInner.tsx`, add `renderableNamesFor` to the `@atizar/react` import block (the named import list ending at line 24-25). After `isDevMode,` (line 23) add `renderableNamesFor,`:
  ```tsx
    isDevMode,
    type WorkflowsConfig,
  } from '@atizar/react'
  ```
  becomes:
  ```tsx
    isDevMode,
    renderableNamesFor,
    type WorkflowsConfig,
  } from '@atizar/react'
  ```

- [ ] **Step 3: Scope `renderableToolNames` to the active workflow.** In the same file, replace the flat construction (lines 49-54):
  ```tsx
    // Tool names that render as generative-UI cards. Anything else is plumbing, hidden from
    // the consumer thread unless dev mode is on.
    const renderableToolNames: ReadonlySet<string> = new Set([
      ...config.renders.map((s) => s.toolName),
      ...config.hitl.map((s) => s.toolName),
    ])
  ```
  with:
  ```tsx
    // Tool names that render as generative-UI cards FOR THE ACTIVE WORKFLOW. Anything else is
    // plumbing, hidden from the consumer thread unless dev mode is on. Scoped per workflow so a
    // tool name owned by another workflow does not leak into this thread (registryScope).
    const renderableToolNames: ReadonlySet<string> = renderableNamesFor(config, nav.workflow.id)
  ```

- [ ] **Step 4: Pass `workflowId` to `ThreadModal`.** In the same file, in the `<ThreadModal …>` JSX, add the prop. Replace:
  ```tsx
            <ThreadModal
              key={nav.openItem.id}
              id={nav.openItem.id}
              title={nav.nameOf(nav.stripAgent(nav.openItem))}
  ```
  with:
  ```tsx
            <ThreadModal
              key={nav.openItem.id}
              id={nav.openItem.id}
              workflowId={nav.openItem.workflowId}
              title={nav.nameOf(nav.stripAgent(nav.openItem))}
  ```
  > `nav.openItem` is a `WorkItem`, which carries `workflowId` (`serverTypes.ts:19`). Using the item's own `workflowId` is exact even if the item somehow differs from the active workflow.

- [ ] **Step 5: Verify the type-view `AgentModal` is already scoped.** The type-view `AgentModal` (lines 131-146) passes `renderableToolNames={renderableToolNames}` and `renderToolCall={() => null}` — it never resolves a real tool (idle agent, empty messages), so the now-scoped `renderableToolNames` is correct as-is. No JSX change needed here; confirm by reading lines 131-146 (no edit).

- [ ] **Step 6: Run typecheck.** From repo root:
  ```
  yarn typecheck
  ```
  Expected: FAIL still — but now the ONLY remaining errors are in the userland workflow `client.tsx` files and `apps/inbox/client/src/workflows.ts` (the specs missing `workflowId`). No errors in `BoardInner.tsx` or any `packages/react/**` file. (Fixed in Task 6.)

- [ ] **Step 7: Commit.** From repo root:
  ```
  git add packages/react/src/index.ts apps/inbox/client/src/BoardApp/BoardInner.tsx
  git commit -m "feat(react,inbox): export scoping helpers, scope BoardInner renderable set + thread workflowId

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 6: Aggregator — stamp `workflowId`, drop global `byName`, dedup within workflow

> The spec says: "each workflow's `client.ts` (unchanged shape if `workflowId` is injected by the aggregator)." So we do NOT edit the three `client.tsx` files. Instead the aggregator stamps each workflow's `id` onto its specs (the workflow's descriptor `id` is the single source of truth) and dedups WITHIN a workflow only.

**Files:**
- `apps/inbox/client/src/workflows.ts` (modify — lines 1-35, the imports + `byName` + assembly)
- `apps/inbox/client/src/workflows.test.ts` (create — Test)

- [ ] **Step 1: Read the workflow descriptor ids to confirm the constant strings.** From repo root:
  ```
  grep -rn "id: '" apps/inbox/workflows/lead-inbox/descriptor.ts apps/inbox/workflows/github-triage/descriptor.ts apps/inbox/workflows/email-inbox/descriptor.ts | head
  ```
  Expected: the three workflow ids (e.g. `lead-inbox`, `github-triage`, `email-inbox`). Use the EXACT strings the descriptors export — the aggregator must stamp the same id the board uses (`nav.workflow.id` / `WorkItem.workflowId`). Note them for Step 3.

- [ ] **Step 2: Write the failing aggregator test.** Create `apps/inbox/client/src/workflows.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { workflowsConfig } from './workflows'
  import { byWorkflow } from '@atizar/react'

  describe('workflowsConfig render/HITL scoping', () => {
    it('stamps every render spec with a workflowId', () => {
      expect(workflowsConfig.renders.length).toBeGreaterThan(0)
      for (const s of workflowsConfig.renders) {
        expect(typeof s.workflowId).toBe('string')
        expect(s.workflowId.length).toBeGreaterThan(0)
      }
    })

    it('stamps every HITL spec with a workflowId', () => {
      expect(workflowsConfig.hitl.length).toBeGreaterThan(0)
      for (const s of workflowsConfig.hitl) {
        expect(typeof s.workflowId).toBe('string')
        expect(s.workflowId.length).toBeGreaterThan(0)
      }
    })

    it('keeps the reused saveDraft/applyActions HITL tool in EACH workflow that registers it', () => {
      // The reply agent is reused by lead-inbox AND email-inbox. Under the old global byName
      // dedup, only the first workflow's copy survived. Scoped, every registering workflow keeps
      // its own copy — that is the whole point of WS2.
      const leadHitl = byWorkflow(workflowsConfig.hitl, 'lead-inbox')
      const emailHitl = byWorkflow(workflowsConfig.hitl, 'email-inbox')
      expect(leadHitl.some((s) => s.toolName === 'saveDraft')).toBe(true)
      expect(emailHitl.some((s) => s.toolName === 'applyActions')).toBe(true)
    })

    it('dedups WITHIN a workflow (no duplicate toolName for the same workflow)', () => {
      const seen = new Set<string>()
      for (const s of workflowsConfig.renders) {
        const key = `${s.workflowId}:${s.toolName}`
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
    })
  })
  ```

- [ ] **Step 3: Run the test (expected FAIL).** From repo root:
  ```
  yarn test workflows.test
  ```
  Expected: FAIL — the specs currently have no `workflowId` (the `workflowId` assertions fail) and/or a TS/import error. (This is the red.)

- [ ] **Step 4: Rewrite the aggregator with per-workflow stamping + within-workflow dedup.** Replace the entire contents of `apps/inbox/client/src/workflows.ts`:
  ```ts
  import type { WorkflowsConfig, AgentMeta, RenderSpec, HitlSpec } from '@atizar/react'
  import { workflowDescriptors } from '../../workflows'
  import { leadInboxMeta, leadInboxRenders, leadInboxHitl } from '../../workflows/lead-inbox/client'
  import { githubTriageMeta, githubTriageRenders } from '../../workflows/github-triage/client'
  import {
    emailInboxMeta,
    emailInboxRenders,
    emailInboxHitl,
  } from '../../workflows/email-inbox/client'

  // The demo aggregator: merges every workflow client module into one WorkflowsConfig bundle
  // (descriptors + per-agent chrome meta + render/HITL specs) and hands it to <BoardApp config={…} />.
  // This is the userland injection point — the package holds no cards or workflow knowledge.
  //
  // Render/HITL resolution is scoped per workflow (WS2): each workflow's specs are stamped with
  // that workflow's id, so two workflows registering the same tool name with DIFFERENT components
  // both resolve correctly. Dedup is WITHIN a workflow only (a reused agent registers its render
  // once per workflow) — the old global byName drop is gone (it silently lost a second workflow's
  // same-named-but-different component).
  const META: Record<string, AgentMeta> = { ...leadInboxMeta, ...githubTriageMeta, ...emailInboxMeta }

  // Stamp a workflow's specs with its id, then drop duplicate tool names WITHIN that workflow.
  const scope = <T extends { toolName: string; workflowId: string }>(
    workflowId: string,
    specs: Omit<T, 'workflowId'>[]
  ): T[] => {
    const seen = new Set<string>()
    const out: T[] = []
    for (const s of specs) {
      if (seen.has(s.toolName)) continue
      seen.add(s.toolName)
      out.push({ ...s, workflowId } as T)
    }
    return out
  }

  const renderSpecs: RenderSpec[] = [
    ...scope<RenderSpec>('lead-inbox', leadInboxRenders),
    ...scope<RenderSpec>('github-triage', githubTriageRenders),
    ...scope<RenderSpec>('email-inbox', emailInboxRenders),
  ]
  const hitlSpecs: HitlSpec[] = [
    ...scope<HitlSpec>('lead-inbox', leadInboxHitl),
    ...scope<HitlSpec>('email-inbox', emailInboxHitl),
  ]

  export const workflowsConfig: WorkflowsConfig = {
    workflows: workflowDescriptors,
    meta: META,
    renders: renderSpecs,
    hitl: hitlSpecs,
    // Build-time token (deploy sets it to match the server's ATIZAR_AUTH_TOKEN). Unset in
    // dev/demo ⇒ undefined ⇒ no header, which matches the fail-open / demo-disabled server.
    authToken: import.meta.env.VITE_ATIZAR_AUTH_TOKEN as string | undefined,
  }
  ```
  > The workflow `client.tsx` files export `RenderSpec[]`/`HitlSpec[]` whose objects do NOT yet contain `workflowId` (it is now a required field). To keep those modules unchanged, the `scope` helper accepts `Omit<T,'workflowId'>[]` and adds it. The workflow `client.tsx` exports are typed `RenderSpec[]` (which now requires `workflowId`) — see Step 5 to resolve that typing cleanly without editing the client files' shapes.

- [ ] **Step 5: Make the workflow `client.tsx` spec exports tolerate the now-required `workflowId` without editing their shape.** The three `client.tsx` files annotate their arrays as `RenderSpec[]` / `HitlSpec[]`, which now require `workflowId`, so they would still error. The spec mandate is "unchanged shape if `workflowId` is injected by the aggregator" — so loosen the export TYPE annotation to the workflow-agnostic shape (id supplied by the aggregator). Edit each of the three files' export annotations ONLY (not the object literals):

  In `apps/inbox/workflows/lead-inbox/client.tsx`, change the two annotations:
  ```tsx
  export const leadInboxRenders: RenderSpec[] = [
  ```
  →
  ```tsx
  export const leadInboxRenders: Omit<RenderSpec, 'workflowId'>[] = [
  ```
  and
  ```tsx
  export const leadInboxHitl: HitlSpec[] = [
  ```
  →
  ```tsx
  export const leadInboxHitl: Omit<HitlSpec, 'workflowId'>[] = [
  ```

  In `apps/inbox/workflows/github-triage/client.tsx`:
  ```tsx
  export const githubTriageRenders: RenderSpec[] = [
  ```
  →
  ```tsx
  export const githubTriageRenders: Omit<RenderSpec, 'workflowId'>[] = [
  ```

  In `apps/inbox/workflows/email-inbox/client.tsx`:
  ```tsx
  export const emailInboxRenders: RenderSpec[] = [
  ```
  →
  ```tsx
  export const emailInboxRenders: Omit<RenderSpec, 'workflowId'>[] = [
  ```
  and
  ```tsx
  export const emailInboxHitl: HitlSpec[] = [
  ```
  →
  ```tsx
  export const emailInboxHitl: Omit<HitlSpec, 'workflowId'>[] = [
  ```
  > These are pure annotation changes — the render closures and tool names are untouched, matching "unchanged shape, workflowId injected by the aggregator." The `import type { RenderSpec, HitlSpec }` lines stay (now used in the `Omit`).

- [ ] **Step 6: Update the email-inbox comment that referenced the dropped global dedup.** In `apps/inbox/workflows/email-inbox/client.tsx`, the comment above `emailInboxRenders` (lines 35-37) says reuse is "deduped by tool name … the lead-inbox copy would win anyway." That is now false (scoping is per-workflow). Replace:
  ```tsx
  // Only the NEW tools are declared here. renderLead + saveDraft (reused by the reply agent) are
  // already registered by lead-inbox; the client aggregator dedupes by tool name, so re-declaring
  // them is unnecessary (and the lead-inbox copy would win anyway).
  ```
  with:
  ```tsx
  // Only the NEW tools are declared here. renderLead + saveDraft (reused by the reply agent) are
  // already registered by lead-inbox. Resolution is scoped per workflow now (WS2), so email-inbox
  // would need its OWN copy to surface those in its threads; this workflow only renders renderSort
  // + the applyActions HITL, so the reused lead tools are intentionally not re-declared here.
  ```

- [ ] **Step 7: Run the aggregator test (expected PASS).** From repo root:
  ```
  yarn test workflows.test
  ```
  Expected: PASS — all four assertions green (every spec stamped; `saveDraft`/`applyActions` present per workflow; within-workflow dedup holds).

- [ ] **Step 8: Run the full green gate.** From repo root:
  ```
  yarn typecheck && yarn test && yarn lint && yarn format:check
  ```
  Expected: ALL PASS — `yarn typecheck` now clean (no remaining `workflowId` errors); `yarn test` green (450+ tests incl. the three new files); `yarn lint` green; `yarn format:check` green. If `format:check` flags the new/edited files, run `yarn format` then re-stage.

- [ ] **Step 9: Build `@atizar/react` (required for an @atizar/react change).** From repo root:
  ```
  yarn workspace @atizar/react build
  ```
  Expected: PASS — Vite library build emits `packages/react/dist/` (ESM + rolled-up `.d.ts` carrying the new `byWorkflow`/`renderableNamesFor` exports + the `workflowId` field on `RenderSpec`/`HitlSpec`) with no type-rollup errors.

- [ ] **Step 10: Commit.** From repo root:
  ```
  git add apps/inbox/client/src/workflows.ts apps/inbox/client/src/workflows.test.ts apps/inbox/workflows/lead-inbox/client.tsx apps/inbox/workflows/github-triage/client.tsx apps/inbox/workflows/email-inbox/client.tsx
  git commit -m "feat(inbox): scope render/HITL registry per workflow, drop global byName dedup

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 7 (OPTIONAL — secondary, skip if it balloons): per-workflow typed tool-name const

> Spec §2 WS2 "Secondary": a small `as const` object per workflow for typo-safety + autocomplete. ADDITIVE only — it does NOT replace the scoping. Do this ONLY if Tasks 1–6 are green and it stays a handful of lines. If it grows past trivial, STOP and skip — the scoping is the fix.

**Files:**
- `apps/inbox/workflows/lead-inbox/client.tsx` (modify — add a const near the top)

- [ ] **Step 1: Add a tool-name const for lead-inbox.** In `apps/inbox/workflows/lead-inbox/client.tsx`, after the imports (after line 6), add:
  ```tsx
  // Typed tool-name constants for this workflow (typo-safety + autocomplete). Values MUST match
  // the toolName strings the render/HITL specs register below and the prompts' tool names. Additive
  // ergonomics — resolution is scoped by workflow (registryScope), not by this const.
  export const LEAD_INBOX_TOOLS = {
    renderLead: 'renderLead',
    renderVerdict: 'renderVerdict',
    saveDraft: 'saveDraft',
  } as const
  ```

- [ ] **Step 2: Use the const in the spec `toolName` fields.** In the same file, replace the three string literals with the const refs:
  - `toolName: 'renderLead',` → `toolName: LEAD_INBOX_TOOLS.renderLead,`
  - `toolName: 'renderVerdict',` → `toolName: LEAD_INBOX_TOOLS.renderVerdict,`
  - `toolName: 'saveDraft',` → `toolName: LEAD_INBOX_TOOLS.saveDraft,`

- [ ] **Step 3: Run the green gate.** From repo root:
  ```
  yarn typecheck && yarn test && yarn lint && yarn format:check
  ```
  Expected: ALL PASS — the const values are identical strings, so every existing test (incl. Task 6's) stays green.

- [ ] **Step 4: Commit.** From repo root:
  ```
  git add apps/inbox/workflows/lead-inbox/client.tsx
  git commit -m "feat(inbox): typed tool-name const for lead-inbox (ergonomics)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Done when

WS2 acceptance criteria (copied from spec §2 WS2):

- [ ] A synthetic test (two workflows, same tool name, different component) resolves each to the right component (`buildRenderToolCall.test.tsx` Task 3 + `registryScope.test.ts` Task 2 + `workflows.test.ts` Task 6).
- [ ] No console collision (the global `byName` dedup is gone; reused agents keep their own per-workflow copy).
- [ ] Existing cards still render (LeadCard / VerdictCard / ApprovalDialog in lead-inbox; TriageCard / TicketResultCard / ReplyDraftCard in github-triage; SortSummaryCard / EmailBatchCard in email-inbox).
- [ ] Green gate passes from repo root: `yarn typecheck && yarn test && yarn lint && yarn format:check`.
- [ ] `@atizar/react` change → `yarn workspace @atizar/react build` passes (Task 6 Step 9).
- [ ] Browser-verified (see below).

Foundation guard-rail (spec §0, I5): `@atizar/react` holds NO card or workflow knowledge — it only receives a userland-injected, workflow-keyed map and filters it. Confirm no card import or workflow-id literal was added to any `packages/react/**` file:
- [ ] `grep -rn "lead-inbox\|github-triage\|email-inbox\|LeadCard\|VerdictCard\|TriageCard\|SortSummaryCard\|EmailBatchCard" packages/react/src/` returns NOTHING (run before finishing).

Branch hygiene (CLAUDE.md): a subagent must NOT switch branches. Confirm `git rev-parse --abbrev-ref HEAD` is still the WS2 working branch before declaring done; read history via `git show <sha>:path` only.

## Browser-verify

This project's HARD rule: drive the REAL app — unit tests are not enough; reload-masking bugs only the browser catches. Use the `browser-verify` skill first (dev-server hygiene, port `:4000`/`:5173`, Playwright-MCP recovery).

- [ ] Start the stack from repo root: `yarn dev` (server :4000 + client :5173). Use `DEV_RECORD_REPLAY=1` if cassettes exist so runs replay instantly.
- [ ] Open `http://localhost:5173`. For EACH of the three workflows (`lead-inbox`, `github-triage`, `email-inbox`):
  - [ ] START the input agent, let the run complete, open the thread, and confirm the generative-UI CARD renders (not a raw tool chip, not a blank panel) — i.e. the scoped `renderableToolNames` still surfaces that workflow's cards.
- [ ] **HITL focus (lead-inbox + email-inbox both reuse the reply path):** drive a run to the approval gate in lead-inbox (`saveDraft` → ApprovalDialog) AND in email-inbox (`applyActions` → EmailBatchCard). Confirm BOTH render their OWN approval card and the Approve/Reject buttons work — this is the exact scenario the old global `byName` dedup masked (same reply agent, two workflows). Verify all user flows incl. HITL approval before claiming done (project rule).
- [ ] Open the browser console: confirm NO "render spec collision" / duplicate-tool warnings and no `Agent … not found` errors beyond the known benign teardown warning.
- [ ] Reload mid-thread (the `?open=` URL re-attach) and confirm the card still resolves after the SSE re-subscribe (reload-masking guard).
