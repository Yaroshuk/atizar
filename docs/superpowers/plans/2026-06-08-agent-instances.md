# Dynamic Agent Instances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a busy agent spawn additional concurrent copies (up to a per-agent cap) for new handed-off items, queue the overflow, and show the live copies in the pipeline as nested instance cards.

**Architecture:** The server is unchanged (one agent per `wf__agent`). The client creates a temporary **proxied agent** per live instance on demand via CopilotKit's `registerProxiedAgent({ agentId, runtimeAgentId })`, runs it immediately, and `unregister`s it when done. A per-agent cap (`maxInstances`, default 2) bounds concurrency; overflow waits in a per-agent queue and auto-starts when a copy finishes. The pipeline is rebuilt from the live instance list as repeated depth-2 `parent → [children container]` blocks.

**Tech Stack:** TypeScript, React, Vite, Vitest, `@copilotkit/react-core/v2` + `@copilotkit/core`, `@platform/core` (zod), yarn-classic workspace.

**Spec:** `docs/superpowers/specs/2026-06-08-agent-instances-design.md`

**Commands (always from repo root):** `yarn test`, `yarn typecheck`, `yarn lint`, `yarn format:check`. Browser E2E per `CLAUDE.md` "Kill stale dev servers" + memory `always-run-browser-e2e`.

---

## File Structure

**Create:**
- `apps/inbox/client/src/statusFrom.ts` — pure status derivation extracted from `useAgentStatus`.
- `apps/inbox/client/src/statusFrom.test.ts`
- `apps/inbox/client/src/aggregate.ts` — pure big-card aggregate over an agent's instances.
- `apps/inbox/client/src/aggregate.test.ts`
- `apps/inbox/client/src/instancesCore.ts` — pure cap/queue routing logic (no CopilotKit).
- `apps/inbox/client/src/instancesCore.test.ts`
- `apps/inbox/client/src/pipelineModel.ts` — pure instance-tree → render-model builder.
- `apps/inbox/client/src/pipelineModel.test.ts`
- `apps/inbox/client/src/useAgentInstances.ts` — React hook: owns live instances, wires `registerProxiedAgent`/`runAgent`/`unregister`, applies `instancesCore`.

**Modify:**
- `packages/core/src/defineAgent.ts` — add `maxInstances`.
- `packages/core/src/defineAgent.test.ts` — cover the default + override.
- `apps/inbox/workflows/github-triage/descriptor.ts` — `maxInstances: 1` on `triageAgent`.
- `apps/inbox/workflows/lead-inbox/descriptor.ts` — `maxInstances: 1` on `qualifierAgent`.
- `apps/inbox/client/src/useAgentStatus.ts` — use `statusFrom`.
- `apps/inbox/client/src/InboxView.tsx` — deliver → spawn, input Start → spawn, big-card aggregate, drop fixed all-mounted-idle.
- `apps/inbox/client/src/components/PipelineColumn.tsx` — render the new model.
- `apps/inbox/client/src/components/AgentCard.tsx` — aggregate status text.
- `apps/inbox/client/src/styles*` (the CSS file the app uses) — instance-card / container / queue styles.
- `CLAUDE.md`, `HANDOFF.md`, `docs/BUILD-LOG.md`.

**Removed responsibility:** `apps/inbox/client/src/pipeline.ts` (`activePipeline`) is superseded by `pipelineModel.ts`. Keep the file only if still imported; otherwise delete it and its test in Task 6.

---

## Task 1: `maxInstances` on the agent passport

**Files:**
- Modify: `packages/core/src/defineAgent.ts`
- Test: `packages/core/src/defineAgent.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/defineAgent.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { defineAgent } from './defineAgent'

const base = {
  id: 'x',
  name: 'X',
  provider: 'mock',
  instructions: '',
  tools: [],
  approvals: [],
  renders: {},
}

describe('maxInstances', () => {
  it('defaults to 2 when omitted', () => {
    expect(defineAgent({ ...base }).maxInstances).toBe(2)
  })
  it('keeps an explicit override', () => {
    expect(defineAgent({ ...base, maxInstances: 1 }).maxInstances).toBe(1)
  })
  it('rejects a non-positive cap', () => {
    expect(() => defineAgent({ ...base, maxInstances: 0 })).toThrow()
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `yarn test packages/core/src/defineAgent.test.ts`
Expected: FAIL — `maxInstances` is `undefined` / property unknown.

- [ ] **Step 3: Implement**

In `packages/core/src/defineAgent.ts`, add the field to the `z.object({...})` (before the `.superRefine`):

```ts
    handoffs: z.array(z.string()).optional(),
    // Max concurrent runtime copies of this agent. A cap of 1 = singleton.
    maxInstances: z.number().int().positive().default(2),
```

(`z.infer` makes `maxInstances` a required `number` on `AgentDefinition` after parse — no other change needed.)

- [ ] **Step 4: Run it, verify it passes**

Run: `yarn test packages/core/src/defineAgent.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
yarn typecheck
git add packages/core/src/defineAgent.ts packages/core/src/defineAgent.test.ts
git commit -m "feat(core): add maxInstances cap to agent passport (default 2)"
```

---

## Task 2: Cap the two input agents to 1

**Files:**
- Modify: `apps/inbox/workflows/github-triage/descriptor.ts:3-13`
- Modify: `apps/inbox/workflows/lead-inbox/descriptor.ts:3-12` (`qualifierAgent` is at lines 14-24)

- [ ] **Step 1: Edit triage**

In `github-triage/descriptor.ts`, add `maxInstances: 1` to `triageAgent` (after `handoffs`):

```ts
export const triageAgent = defineAgent({
  id: 'triage',
  name: 'TRIAGE',
  provider: 'claude-cli',
  instructions:
    'Read the user’s open tickets on the project board and recommend how to route each.',
  tools: ['list_my_tickets', 'get_ticket', 'render_triage'],
  approvals: [],
  renders: { render_triage: 'TriageCard' },
  handoffs: ['feature', 'bugfix', 'reply-draft'],
  maxInstances: 1,
})
```

- [ ] **Step 2: Edit qualifier**

In `lead-inbox/descriptor.ts`, add `maxInstances: 1` to `qualifierAgent` (after `handoffs: ['reply']`):

```ts
export const qualifierAgent = defineAgent({
  id: 'qualifier',
  name: 'LEAD QUALIFIER',
  provider: 'claude-cli',
  instructions:
    'Read the latest email in the inbox and qualify the lead: category, priority, and a one-line reason.',
  tools: ['renderVerdict'],
  approvals: [],
  renders: { renderVerdict: 'VerdictCard' },
  handoffs: ['reply'],
  maxInstances: 1,
})
```

- [ ] **Step 3: Typecheck + commit**

```bash
yarn typecheck
git add apps/inbox/workflows/github-triage/descriptor.ts apps/inbox/workflows/lead-inbox/descriptor.ts
git commit -m "feat(inbox): cap input agents (triage, qualifier) to a single instance"
```

---

## Task 3: Extract pure `statusFrom` and reuse it

The manager (Task 7) needs to derive status for an imperatively-created agent, which is not a hook. Extract the pure logic from `useAgentStatus` so both reuse it.

**Files:**
- Create: `apps/inbox/client/src/statusFrom.ts`
- Create: `apps/inbox/client/src/statusFrom.test.ts`
- Modify: `apps/inbox/client/src/useAgentStatus.ts`

- [ ] **Step 1: Write the failing test**

`apps/inbox/client/src/statusFrom.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { statusFrom } from './statusFrom'
import type { Message } from '@platform/core'

const approvalMsg: Message = {
  id: '1',
  role: 'assistant',
  content: '',
  toolCalls: [{ id: 't1', type: 'function', function: { name: 'saveDraft', arguments: '{}' } }],
} as Message

describe('statusFrom', () => {
  it('returns the lifecycle when no approval pending', () => {
    expect(statusFrom('running', [], ['saveDraft'])).toBe('running')
    expect(statusFrom('done', [], ['saveDraft'])).toBe('done')
  })
  it('returns awaiting_approval when an approval tool call is pending', () => {
    expect(statusFrom('running', [approvalMsg], ['saveDraft'])).toBe('awaiting_approval')
  })
  it('error wins over a pending approval', () => {
    expect(statusFrom('error', [approvalMsg], ['saveDraft'])).toBe('error')
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `yarn test apps/inbox/client/src/statusFrom.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `statusFrom.ts`**

```ts
import { hasPendingApproval, type Message } from '@platform/core'
import type { Status, Lifecycle } from './status'

// Pure status derivation shared by the useAgentStatus hook and the instance manager.
// `awaiting_approval` (from message state) wins over running/done but never over a
// terminal error — mirrors the rule documented in CLAUDE.md / status.ts.
export const statusFrom = (
  lifecycle: Lifecycle,
  messages: Message[],
  approvals: readonly string[]
): Status => {
  if (lifecycle === 'error') return 'error'
  if (hasPendingApproval(messages, approvals)) return 'awaiting_approval'
  return lifecycle
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `yarn test apps/inbox/client/src/statusFrom.test.ts`
Expected: PASS. (If `hasPendingApproval`'s message shape differs, fix the test fixture to match — check `packages/core/src/messages.ts` for the approval-detection shape.)

- [ ] **Step 5: Refactor `useAgentStatus` to use it**

In `apps/inbox/client/src/useAgentStatus.ts`, replace the final three lines of the hook body:

```ts
  if (lifecycle === 'error') return 'error'
  if (hasPendingApproval(messages, approvalNames)) return 'awaiting_approval'
  return lifecycle
```

with:

```ts
  return statusFrom(lifecycle, messages, approvalNames)
```

Add the import and drop the now-unused `hasPendingApproval` import:

```ts
import { statusFrom } from './statusFrom'
import { type Message } from '@platform/core'
```

- [ ] **Step 6: Run the existing hook test + typecheck**

Run: `yarn test apps/inbox/client/src/useAgentStatus.test.ts && yarn typecheck`
Expected: PASS (behavior unchanged).

- [ ] **Step 7: Commit**

```bash
git add apps/inbox/client/src/statusFrom.ts apps/inbox/client/src/statusFrom.test.ts apps/inbox/client/src/useAgentStatus.ts
git commit -m "refactor(inbox): extract pure statusFrom shared by hook + instance manager"
```

---

## Task 4: Pure big-card aggregate

**Files:**
- Create: `apps/inbox/client/src/aggregate.ts`
- Create: `apps/inbox/client/src/aggregate.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/inbox/client/src/aggregate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { aggregateAgent } from './aggregate'
import type { Status } from './status'

describe('aggregateAgent', () => {
  it('is idle with no instances', () => {
    expect(aggregateAgent([])).toEqual({ activeCount: 0, awaitingCount: 0, status: 'idle' })
  })
  it('counts active (running/awaiting/error) and awaiting separately', () => {
    const s: Status[] = ['running', 'awaiting_approval', 'done']
    expect(aggregateAgent(s)).toEqual({ activeCount: 2, awaitingCount: 1, status: 'awaiting_approval' })
  })
  it('priority: awaiting_approval > error > running > done > idle', () => {
    expect(aggregateAgent(['running', 'error']).status).toBe('error')
    expect(aggregateAgent(['error', 'awaiting_approval']).status).toBe('awaiting_approval')
    expect(aggregateAgent(['done']).status).toBe('done')
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `yarn test apps/inbox/client/src/aggregate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `aggregate.ts`**

```ts
import type { Status } from './status'

const ACTIVE: ReadonlySet<Status> = new Set(['running', 'awaiting_approval', 'error'])
// Worst-meaningful-first; the human must not miss an approval.
const PRIORITY: Status[] = ['awaiting_approval', 'error', 'running', 'done', 'idle']

export type AgentAggregate = { activeCount: number; awaitingCount: number; status: Status }

// Reduce an agent's live instance statuses to a single headline for its "type" card.
export const aggregateAgent = (statuses: Status[]): AgentAggregate => {
  const activeCount = statuses.filter((s) => ACTIVE.has(s)).length
  const awaitingCount = statuses.filter((s) => s === 'awaiting_approval').length
  const status = PRIORITY.find((p) => statuses.includes(p)) ?? 'idle'
  return { activeCount, awaitingCount, status }
}

// The headline text for the type card, e.g. "2 active · 1 awaiting approval".
export const aggregateLabel = (a: AgentAggregate): string => {
  if (a.activeCount === 0) return ''
  const head = `${a.activeCount} active`
  return a.awaitingCount > 0 ? `${head} · ${a.awaitingCount} awaiting approval` : head
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `yarn test apps/inbox/client/src/aggregate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/client/src/aggregate.ts apps/inbox/client/src/aggregate.test.ts
git commit -m "feat(inbox): pure aggregateAgent for the type-card headline"
```

---

## Task 5: Pure cap/queue routing core

The decision logic (spawn vs enqueue, what to drain on free) is pure and is the heart of the feature. Keep it free of CopilotKit so it is fully unit-tested.

**Files:**
- Create: `apps/inbox/client/src/instancesCore.ts`
- Create: `apps/inbox/client/src/instancesCore.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/inbox/client/src/instancesCore.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { liveCount, canSpawn } from './instancesCore'
import type { Status } from './status'

const inst = (runtimeKey: string, status: Status) => ({ runtimeKey, status })

describe('instancesCore', () => {
  it('liveCount counts non-done instances of a runtimeKey', () => {
    const all = [inst('a', 'running'), inst('a', 'done'), inst('b', 'running')]
    // done instances are torn down, but guard against a transient done not yet removed:
    expect(liveCount(all, 'a')).toBe(1)
    expect(liveCount(all, 'b')).toBe(1)
  })
  it('canSpawn is true below the cap', () => {
    expect(canSpawn([inst('a', 'running')], 'a', 2)).toBe(true)
  })
  it('canSpawn is false at the cap', () => {
    expect(canSpawn([inst('a', 'running'), inst('a', 'awaiting_approval')], 'a', 2)).toBe(false)
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `yarn test apps/inbox/client/src/instancesCore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `instancesCore.ts`**

```ts
import type { Status } from './status'

// Minimal shape the routing logic needs (the hook's Instance is a superset).
export type Routable = { runtimeKey: string; status: Status }

// Live = occupies a slot. A done instance is being torn down, so it does not count.
export const liveCount = (instances: Routable[], runtimeKey: string): number =>
  instances.filter((i) => i.runtimeKey === runtimeKey && i.status !== 'done').length

// A free slot exists when live copies are below the agent's cap.
export const canSpawn = (instances: Routable[], runtimeKey: string, maxInstances: number): boolean =>
  liveCount(instances, runtimeKey) < maxInstances
```

- [ ] **Step 4: Run it, verify it passes**

Run: `yarn test apps/inbox/client/src/instancesCore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/client/src/instancesCore.ts apps/inbox/client/src/instancesCore.test.ts
git commit -m "feat(inbox): pure cap/queue routing core (liveCount, canSpawn)"
```

---

## Task 6: Pure pipeline instance-tree builder

Replaces `activePipeline`. Turns the live instance list into the repeated depth-2 block model the renderer consumes.

**Files:**
- Create: `apps/inbox/client/src/pipelineModel.ts`
- Create: `apps/inbox/client/src/pipelineModel.test.ts`
- Delete (end of task, if unused): `apps/inbox/client/src/pipeline.ts`, `apps/inbox/client/src/pipeline.test.ts`

- [ ] **Step 1: Define types + write the failing test**

`apps/inbox/client/src/pipelineModel.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildPipeline, type PInstance } from './pipelineModel'

const i = (over: Partial<PInstance>): PInstance => ({
  localId: 'x', runtimeKey: 'wf__a', agentId: 'a', name: 'A',
  iconName: 'inbox', label: '', status: 'running', parentLocalId: undefined, isInput: false,
  ...over,
})

describe('buildPipeline', () => {
  it('keeps a done input agent as a lone header', () => {
    const blocks = buildPipeline([i({ localId: 'in', agentId: 'triage', isInput: true, status: 'done', label: '' })], {})
    expect(blocks).toHaveLength(1)
    expect(blocks[0].parent.localId).toBe('in')
    expect(blocks[0].groups).toEqual([])
  })

  it('one child instance renders as a single-instance group', () => {
    const blocks = buildPipeline([
      i({ localId: 'in', agentId: 'triage', isInput: true, status: 'done' }),
      i({ localId: 'c1', agentId: 'feature', name: 'FEATURE', parentLocalId: 'in', label: '#150 CSV', status: 'running' }),
    ], {})
    expect(blocks[0].groups).toHaveLength(1)
    expect(blocks[0].groups[0].instances.map((x) => x.localId)).toEqual(['c1'])
  })

  it('two instances of the same agent group together under that agent', () => {
    const blocks = buildPipeline([
      i({ localId: 'in', agentId: 'triage', isInput: true, status: 'done' }),
      i({ localId: 'r1', runtimeKey: 'wf__reply', agentId: 'reply', name: 'REPLY', parentLocalId: 'in', label: '#142', status: 'awaiting_approval' }),
      i({ localId: 'r2', runtimeKey: 'wf__reply', agentId: 'reply', name: 'REPLY', parentLocalId: 'in', label: '#143', status: 'running' }),
    ], {})
    const g = blocks[0].groups.find((x) => x.agentId === 'reply')!
    expect(g.instances).toHaveLength(2)
  })

  it('attaches the queued count to its agent group', () => {
    const blocks = buildPipeline([
      i({ localId: 'in', agentId: 'triage', isInput: true, status: 'done' }),
      i({ localId: 'r1', runtimeKey: 'wf__reply', agentId: 'reply', parentLocalId: 'in', status: 'running' }),
    ], { reply: 2 })
    const g = blocks[0].groups.find((x) => x.agentId === 'reply')!
    expect(g.queued).toBe(2)
  })

  it('drops a done worker with no active child', () => {
    const blocks = buildPipeline([
      i({ localId: 'in', agentId: 'triage', isInput: true, status: 'done' }),
      i({ localId: 'c1', agentId: 'feature', parentLocalId: 'in', status: 'done' }),
    ], {})
    expect(blocks[0].groups).toEqual([])
  })

  it('repeats a parent as its own block (depth-2) when an instance dispatches a child', () => {
    const blocks = buildPipeline([
      i({ localId: 'in', agentId: 'triage', isInput: true, status: 'done' }),
      i({ localId: 'r1', runtimeKey: 'wf__reply', agentId: 'reply', parentLocalId: 'in', status: 'done' }),
      i({ localId: 'b1', agentId: 'bugfix', parentLocalId: 'r1', status: 'running' }),
    ], {})
    // r1 is done but kept (ancestor of active b1) and appears as a parent block.
    const parentIds = blocks.map((bl) => bl.parent.localId)
    expect(parentIds).toContain('r1')
    const r1Block = blocks.find((bl) => bl.parent.localId === 'r1')!
    expect(r1Block.groups[0].instances[0].localId).toBe('b1')
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `yarn test apps/inbox/client/src/pipelineModel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pipelineModel.ts`**

```ts
import type { Status } from './status'
import type { IconName } from './components/Icon'

export type PInstance = {
  localId: string
  runtimeKey: string
  agentId: string
  name: string
  iconName: IconName
  label: string
  status: Status
  parentLocalId?: string
  isInput: boolean
}

export type AgentGroup = {
  agentId: string
  name: string
  iconName: IconName
  instances: PInstance[] // ≥1, all the same agentId, all shown
  queued: number
}

export type PipelineBlock = {
  parent: PInstance // the header instance
  groups: AgentGroup[] // children grouped by agentId; [] => lone header
}

const ACTIVE: ReadonlySet<Status> = new Set(['running', 'awaiting_approval', 'error'])

// Build the repeated depth-2 block model from the live instances of one workflow.
// queued: agentId -> count of items waiting for a free slot.
export function buildPipeline(
  instances: PInstance[],
  queued: Record<string, number>
): PipelineBlock[] {
  const byId = new Map(instances.map((x) => [x.localId, x]))
  const childrenOf = new Map<string, PInstance[]>()
  for (const x of instances) {
    if (!x.parentLocalId) continue
    const arr = childrenOf.get(x.parentLocalId) ?? []
    arr.push(x)
    childrenOf.set(x.parentLocalId, arr)
  }

  // shown = input agents ∪ active instances ∪ ancestors of shown (fixpoint).
  const shown = new Set<string>()
  for (const x of instances) if (x.isInput || ACTIVE.has(x.status)) shown.add(x.localId)
  let changed = true
  while (changed) {
    changed = false
    for (const x of instances) {
      if (shown.has(x.localId) || !x.parentLocalId) continue
      if (shown.has(x.parentLocalId)) {
        shown.add(x.localId)
        changed = true
      }
    }
  }
  // Also promote ancestors of shown actives (a kept parent of a shown child).
  changed = true
  while (changed) {
    changed = false
    for (const x of instances) {
      if (!shown.has(x.localId)) continue
      if (x.parentLocalId && !shown.has(x.parentLocalId)) {
        shown.add(x.parentLocalId)
        changed = true
      }
    }
  }

  // A kept-but-not-active instance displays as Working (running).
  const view = (x: PInstance): PInstance =>
    ACTIVE.has(x.status) ? x : { ...x, status: 'running' as Status }

  // A block is emitted for every shown instance that is either an input root or has
  // ≥1 shown child. Order: roots first, then by parent-before-child (BFS).
  const isShownChild = (x: PInstance) => shown.has(x.localId)
  const roots = instances.filter((x) => shown.has(x.localId) && (x.isInput || !x.parentLocalId))

  const blocks: PipelineBlock[] = []
  const emitted = new Set<string>()
  const queue = [...roots]
  while (queue.length) {
    const parent = queue.shift()!
    if (emitted.has(parent.localId)) continue
    emitted.add(parent.localId)

    const kids = (childrenOf.get(parent.localId) ?? []).filter(isShownChild)
    // group children by agentId, preserving first-seen order
    const order: string[] = []
    const groups = new Map<string, AgentGroup>()
    for (const k of kids) {
      if (!groups.has(k.agentId)) {
        order.push(k.agentId)
        groups.set(k.agentId, {
          agentId: k.agentId,
          name: k.name,
          iconName: k.iconName,
          instances: [],
          queued: queued[k.agentId] ?? 0,
        })
      }
      groups.get(k.agentId)!.instances.push(view(k))
      // a child that is itself a parent of shown instances gets its own block later
      if ((childrenOf.get(k.localId) ?? []).some(isShownChild)) queue.push(k)
    }
    blocks.push({ parent: view(parent), groups: order.map((id) => groups.get(id)!) })
  }
  return blocks
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `yarn test apps/inbox/client/src/pipelineModel.test.ts`
Expected: PASS. If a case fails, fix the builder (not the test) until green.

- [ ] **Step 5: Remove the superseded module (after Task 9 rewires PipelineColumn)**

> Do NOT delete yet — `PipelineColumn.tsx` still imports `activePipeline`. Deletion happens in Task 9 once the new render is in. Leave a note here; come back.

- [ ] **Step 6: Typecheck + commit**

```bash
yarn typecheck
git add apps/inbox/client/src/pipelineModel.ts apps/inbox/client/src/pipelineModel.test.ts
git commit -m "feat(inbox): pure pipeline instance-tree builder (repeated depth-2 blocks)"
```

---

## Task 7: `useAgentInstances` — wire proxied agents, cap + queue

This is the integration core. It is React + CopilotKit bound, so it is verified in the browser (Task 12), not by a unit test. Keep ALL decision logic delegated to `instancesCore`.

**Files:**
- Create: `apps/inbox/client/src/useAgentInstances.ts`

**Runtime unknowns to probe in the browser (note in commit if behavior differs):**
- `registerProxiedAgent` requires `runtimeAgentId` to be a server-registered agent id — confirm `getAgent(runtimeKey)` resolves after the runtime `/info` discovery (it should: the server registers every `wf__agent`).
- The proxy's `agent.subscribe(...)` emits the same lifecycle events as a hook-mounted agent.
- `unregister()` after `onRunFinalized` does not throw / double-free.

- [ ] **Step 1: Implement the hook**

```ts
import { useCallback, useRef, useState } from 'react'
import { useCopilotKit } from '@copilotkit/react-core/v2'
import { encodeHandoff, type Message } from '@platform/core'
import type { Status } from './status'
import { statusFrom } from './statusFrom'
import { canSpawn, type Routable } from './instancesCore'
import type { PInstance } from './pipelineModel'

export type SpawnArgs = {
  runtimeKey: string // instanceId(wf, agent) — the server agent id
  agentId: string
  workflowId: string
  name: string
  iconName: PInstance['iconName']
  label: string
  approvals: readonly string[]
  maxInstances: number
  parentLocalId?: string
  isInput?: boolean
  // seed: handoff payload (workers) or null (an input agent reads the inbox itself)
  payload: unknown | null
}

type Live = PInstance & { unregister: () => void; subId?: { unsubscribe: () => void } }
type Pending = { args: SpawnArgs }

let seq = 0
const nextLocalId = (runtimeKey: string) => `${runtimeKey}#${++seq}`

export const useAgentInstances = () => {
  const { copilotkit } = useCopilotKit()
  const [instances, setInstances] = useState<Live[]>([])
  const [queued, setQueued] = useState<Record<string, Pending[]>>({})

  // Mirror current state for the stable callbacks.
  const instRef = useRef(instances)
  instRef.current = instances
  const queueRef = useRef(queued)
  queueRef.current = queued

  const update = useCallback((localId: string, patch: Partial<Live>) => {
    setInstances((prev) => prev.map((x) => (x.localId === localId ? { ...x, ...patch } : x)))
  }, [])

  const remove = useCallback((localId: string) => {
    setInstances((prev) => prev.filter((x) => x.localId !== localId))
  }, [])

  // Forward-declared so onFinalized can call drain.
  const startRef = useRef<(args: SpawnArgs) => void>(() => {})

  const onFinalized = useCallback(
    (localId: string, runtimeKey: string) => {
      const self = instRef.current.find((x) => x.localId === localId)
      if (!self) return
      const hasLiveChild = instRef.current.some(
        (x) => x.parentLocalId === localId && x.status !== 'done'
      )
      // Input agents and parents-with-live-children stay; others tear down.
      if (!self.isInput && !hasLiveChild) {
        self.subId?.unsubscribe()
        self.unregister()
        remove(localId)
      }
      // Drain one queued item for this runtimeKey, if any.
      const q = queueRef.current[runtimeKey] ?? []
      if (q.length) {
        const [next, ...rest] = q
        setQueued((prev) => ({ ...prev, [runtimeKey]: rest }))
        startRef.current(next.args)
      }
    },
    [remove]
  )

  const start = useCallback(
    (args: SpawnArgs) => {
      const localId = nextLocalId(args.runtimeKey)
      const { agent, unregister } = copilotkit.registerProxiedAgent({
        agentId: localId,
        runtimeAgentId: args.runtimeKey,
      })
      if (args.payload !== null) {
        agent.messages.splice(0, agent.messages.length, encodeHandoff(args.payload) as Message)
      }
      const live: Live = {
        localId,
        runtimeKey: args.runtimeKey,
        agentId: args.agentId,
        name: args.name,
        iconName: args.iconName,
        label: args.label,
        status: 'running',
        parentLocalId: args.parentLocalId,
        isInput: !!args.isInput,
        unregister,
      }
      let lifecycle: 'running' | 'done' | 'error' = 'running'
      const recompute = () =>
        update(localId, { status: statusFrom(lifecycle, agent.messages as Message[], args.approvals) })
      const subId = agent.subscribe({
        onRunStartedEvent: () => {
          lifecycle = 'running'
          recompute()
        },
        onRunFailed: () => {
          lifecycle = 'error'
          recompute()
        },
        onMessagesChanged: () => recompute(),
        onRunFinalized: () => {
          lifecycle = 'done'
          recompute()
          onFinalized(localId, args.runtimeKey)
        },
      })
      live.subId = subId
      setInstances((prev) => [...prev, live])
      void copilotkit.runAgent({ agent })
    },
    [copilotkit, update, onFinalized]
  )
  startRef.current = start

  // Public: spawn or enqueue based on the cap.
  const spawn = useCallback(
    (args: SpawnArgs) => {
      const routables: Routable[] = instRef.current.map((x) => ({
        runtimeKey: x.runtimeKey,
        status: x.status,
      }))
      if (canSpawn(routables, args.runtimeKey, args.maxInstances)) start(args)
      else
        setQueued((prev) => ({
          ...prev,
          [args.runtimeKey]: [...(prev[args.runtimeKey] ?? []), { args }],
        }))
    },
    [start]
  )

  // queued counts keyed by AGENT id (for the pipeline group), for the active workflow.
  const queuedByAgent = useCallback(
    (workflowId: string): Record<string, number> => {
      const out: Record<string, number> = {}
      for (const [, items] of Object.entries(queueRef.current)) {
        for (const p of items) {
          if (p.args.workflowId === workflowId)
            out[p.args.agentId] = (out[p.args.agentId] ?? 0) + 1
        }
      }
      return out
    },
    []
  )

  return { instances, spawn, queuedByAgent }
}
```

- [ ] **Step 2: Typecheck**

Run: `yarn typecheck`
Expected: PASS. (If `copilotkit.registerProxiedAgent` / `runAgent` types differ, adjust to the real `@copilotkit/core` signatures read in `node_modules/@copilotkit/core/dist/index.d.mts:176-193,320-447`.)

- [ ] **Step 3: Commit**

```bash
git add apps/inbox/client/src/useAgentInstances.ts
git commit -m "feat(inbox): useAgentInstances — proxied-agent spawn with cap + queue"
```

---

## Task 8: Rewire `InboxView` — deliver → spawn, Start → spawn, aggregate

**Files:**
- Modify: `apps/inbox/client/src/InboxView.tsx`

This replaces the fixed `allRuntimes`/`handles` model. The big-card grid keeps rendering one card per agent DEFINITION (no live instance needed); the pipeline + cards read from `useAgentInstances`.

- [ ] **Step 1: Replace instance plumbing**

In `InboxView.tsx`:
- Remove the `AgentRuntime` mount loop (`allRuntimes`, the `{allRuntimes.map(...)}` JSX) and the `handles`/`onAgentChange`/`handlesRef` state.
- Add `const { instances, spawn, queuedByAgent } = useAgentInstances()`.
- Build a quick lookup of agent definitions by id for the active workflow.

- [ ] **Step 2: deliver → spawn**

Replace the body of the existing `deliver` callback (`InboxView.tsx:52-89`) so that, after `resolveDelivery` succeeds, it derives the label + parent and calls `spawn`:

```ts
const deliver = useCallback(
  (origin: string, dest: Destination, payload: unknown) => {
    const r = resolveDelivery(workflows, origin, dest, payload)
    if (!r.ok) {
      // eslint-disable-next-line no-console
      console.warn('delivery rejected:', r.error)
      return
    }
    const targetWf = workflows.find((w) => instanceId(w.id, w.entryAgentId) === r.instanceId)
      ?? workflows.find((w) => w.agents.some((a) => instanceId(w.id, a.agent.id) === r.instanceId))!
    const agentId = r.instanceId.split('__').slice(1).join('__')
    const def = targetWf.agents.find((a) => a.agent.id === agentId)!.agent
    const m = META[agentId]
    const p = payload as { number?: number; title?: string; subject?: string; from?: string }
    const label =
      typeof p.number === 'number'
        ? `#${p.number}${p.title ? ` · ${p.title}` : ''}`
        : (p.from ?? p.subject ?? 'item')
    // Parent = the live instance of the source agent (cap-1 dispatchers ⇒ unique).
    const sourceAgentId = sourceAgentOf(origin, dest)
    const parent = instances.find(
      (x) => x.workflowId === origin && x.agentId === sourceAgentId
    )
    spawn({
      runtimeKey: r.instanceId,
      agentId,
      workflowId: targetWf.id,
      name: def.name,
      iconName: m.iconName,
      label,
      approvals: def.approvals,
      maxInstances: def.maxInstances,
      parentLocalId: parent?.localId,
      payload,
    })
    if (r.targetWorkflow && r.targetWorkflow !== activeRef.current) {
      setUnread((u) => ({ ...u, [r.targetWorkflow!]: (u[r.targetWorkflow!] ?? 0) + 1 }))
    }
  },
  [instances, spawn]
)
```

> Note: `useAgentInstances` does not give `instances` to the stable closure via ref; `deliver` lists `instances` in deps, which is fine — `useWorkflowRenders` re-registers on `deliver` change. If that proves too churny in the browser, mirror `instances` in a ref inside the hook and expose a `findParent(workflowId, agentId)` helper; swap it in.

- [ ] **Step 3: Input "Start" → spawn**

The big-card grid still maps over `workflow.agents`. For an `input` agent's `onStart`, spawn an input instance:

```ts
const startInput = (agentDef: AgentDefinition) => {
  spawn({
    runtimeKey: iid(agentDef.id),
    agentId: agentDef.id,
    workflowId: workflow.id,
    name: agentDef.name,
    iconName: META[agentDef.id].iconName,
    label: '',
    approvals: agentDef.approvals,
    maxInstances: agentDef.maxInstances,
    isInput: true,
    payload: null,
  })
}
```

Wire `onStart={() => startInput(agent)}` on the input card and in the modal.

- [ ] **Step 4: Big-card aggregate status**

For each agent card, aggregate its instances:

```ts
const statusesOf = (agentId: string): Status[] =>
  instances.filter((x) => x.workflowId === workflow.id && x.agentId === agentId).map((x) => x.status)
const aggOf = (agentId: string) => aggregateAgent(statusesOf(agentId))
```

Pass `aggOf(agent.id)` into `AgentCard` (see Task 10 for the prop).

- [ ] **Step 5: Build pipeline PInstance[] + render**

```ts
const pInstances: PInstance[] = instances
  .filter((x) => x.workflowId === workflow.id)
  .map((x) => ({
    localId: x.localId, runtimeKey: x.runtimeKey, agentId: x.agentId,
    name: x.name, iconName: x.iconName, label: x.label, status: x.status,
    parentLocalId: x.parentLocalId, isInput: x.isInput,
  }))
const blocks = buildPipeline(pInstances, queuedByAgent(workflow.id))
```

Pass `blocks` to `PipelineColumn` (Task 9). Modal "open" now keys off a `localId` rather than an agent instance id; open the agent object via `copilotkit.getAgent(localId)` if the modal needs the live agent. (If the modal currently takes the agent object from `handles`, fetch it from `instances` by `localId`.)

- [ ] **Step 6: Typecheck + browser smoke**

Run: `yarn typecheck`
Then full browser bring-up (see Task 12 preamble). Confirm the app loads with no console errors and the grid shows the type cards.

- [ ] **Step 7: Commit**

```bash
git add apps/inbox/client/src/InboxView.tsx
git commit -m "feat(inbox): route deliver/Start through useAgentInstances; aggregate type cards"
```

---

## Task 9: New `PipelineColumn` render + styles

**Files:**
- Modify: `apps/inbox/client/src/components/PipelineColumn.tsx`
- Modify: the app CSS file (find it: `grep -rl "pipeline-col\|agent-grid" apps/inbox/client/src --include=*.css`)
- Delete: `apps/inbox/client/src/pipeline.ts`, `apps/inbox/client/src/pipeline.test.ts`

- [ ] **Step 1: Rewrite `PipelineColumn.tsx` to consume `PipelineBlock[]`**

Props change from `nodes: PipelineNode[]` to `blocks: PipelineBlock[]` + `onOpen: (localId: string) => void`. Render, per block: parent header → arrow → container; inside, per group, single card if `instances.length === 1 && queued === 0`, else agent mini-header + nested instances with L-connectors + (if `queued > 0`) a `queued: N` line. Use the status→tint/word maps already in the file.

```tsx
import { Fragment } from 'react'
import type { PipelineBlock } from '../pipelineModel'
import type { Status } from '../status'
import { Icon } from './Icon'

const TINT: Record<Status, string> = {
  idle: '', running: 'run', done: 'run', awaiting_approval: 'await', error: 'err',
}
const WORD: Record<Status, string> = {
  idle: '', running: 'Working', done: 'Done', awaiting_approval: 'Approve', error: 'Error',
}

type Props = { blocks: PipelineBlock[]; onOpen: (localId: string) => void }

export const PipelineColumn = ({ blocks, onOpen }: Props) => (
  <div className='pipeline-col'>
    <div className='comp-head'>
      <span className='ch-label'><Icon name='pipeline' size={14} /> Pipeline</span>
    </div>
    <div className='pipeline-body'>
      {blocks.length === 0 ? (
        <p className='pipe-empty'>No agent is running yet. Launched agents appear here.</p>
      ) : (
        blocks.map((block) => (
          <div className='pl-block' key={block.parent.localId}>
            <div className={`mini ${TINT[block.parent.status]}`} onClick={() => onOpen(block.parent.localId)}>
              <div className='m-icon'><Icon name={block.parent.iconName} size={15} /></div>
              <div className='m-text'>
                <span className='m-name'>{block.parent.name}{block.parent.label ? ` · ${block.parent.label}` : ''}</span>
              </div>
              <span className='m-state'><span className={`dot ${block.parent.status}`} />{WORD[block.parent.status]}</span>
            </div>

            {block.groups.length > 0 && (
              <>
                <div className='pl-arrow' />
                <div className='pl-cont'>
                  {block.groups.map((g) => {
                    const nested = g.instances.length >= 2 || g.queued > 0
                    if (!nested) {
                      const inst = g.instances[0]
                      return (
                        <div key={g.agentId} className={`pl-single ${TINT[inst.status]}`} onClick={() => onOpen(inst.localId)}>
                          <div className='m-icon'><Icon name={g.iconName} size={15} /></div>
                          <div className='m-text'><span className='m-name'>{g.name}{inst.label ? ` · ${inst.label}` : ''}</span></div>
                          <span className='m-state'><span className={`dot ${inst.status}`} />{WORD[inst.status]}</span>
                        </div>
                      )
                    }
                    return (
                      <div key={g.agentId} className='pl-group'>
                        <div className='pl-ahead'>
                          <div className='m-icon'><Icon name={g.iconName} size={14} /></div>
                          <span className='pl-aname'>{g.name}</span>
                          <span className='pl-acount'>{g.instances.length} active</span>
                        </div>
                        <div className='pl-kids'>
                          {g.instances.map((inst) => (
                            <div key={inst.localId} className='pl-kid'>
                              <span className='pl-hstub' />
                              <div className={`pl-inst ${TINT[inst.status]}`} onClick={() => onOpen(inst.localId)}>
                                <span className='pl-iname'>{inst.label || inst.name}</span>
                                <span className='m-state'><span className={`dot ${inst.status}`} />{WORD[inst.status]}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                        {g.queued > 0 && <p className='pl-queued'>queued: {g.queued}</p>}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        ))
      )}
    </div>
  </div>
)
```

- [ ] **Step 2: Add CSS** (port from the validated mockup `.superpowers/brainstorm/24715-1780922637/content/pipeline-v3.html`)

Append to the app CSS file the rules for: `.pl-block`, `.pl-arrow` (+ `:after` arrowhead), `.pl-cont` (bordered container), `.pl-single`, `.pl-group`, `.pl-ahead`, `.pl-aname`, `.pl-acount`, `.pl-kids`, `.pl-kid` (+ `:before`/`:after` vertical line), `.pl-hstub` (horizontal L stub), `.pl-inst`, `.pl-iname`, `.pl-queued`. **Truncation:** `.pl-iname{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }` and give the row `display:flex; min-width:0` with `.m-state{ flex:0 0 auto }` so the status pill never gets pushed out. Reuse existing `--tint` color tokens (`run`/`await`/`err`).

- [ ] **Step 3: Update the `PipelineColumn` call site in `InboxView.tsx`**

Replace `<PipelineColumn nodes={pipelineNodes} onOpen={...} />` with `<PipelineColumn blocks={blocks} onOpen={(localId) => setOpenId(localId)} />`. Remove `pipelineNodes` and the `PipelineNode` import.

- [ ] **Step 4: Delete the superseded module**

```bash
git rm apps/inbox/client/src/pipeline.ts apps/inbox/client/src/pipeline.test.ts
```

- [ ] **Step 5: Typecheck + browser-verify the layout**

Run: `yarn typecheck`. Then browser: route 2 tickets to reply → confirm REPLY shows a header + two nested L-connected cards; route a 3rd → `queued: 1`; a single-instance worker (feature) shows as one card with no header. Long title truncates; status pill stays put.

- [ ] **Step 6: Commit**

```bash
git add -A apps/inbox/client/src
git commit -m "feat(inbox): pipeline renders instance blocks (nested copies, queue line)"
```

---

## Task 10: `AgentCard` aggregate text

**Files:**
- Modify: `apps/inbox/client/src/components/AgentCard.tsx`

- [ ] **Step 1: Add the aggregate prop**

Add to `AgentCardProps`:

```ts
  // Headline for the type card, e.g. "2 active · 1 awaiting approval" ('' = none live).
  aggregateLabel: string
```

- [ ] **Step 2: Show it**

In `renderFoot`, when there are live instances (`aggregateLabel !== ''`), show the aggregate instead of "Running… tap to view":

```tsx
  const renderFoot = () => {
    if (aggregateLabel) {
      return (
        <span className='run-foot'>
          <Icon name='sparkle' size={15} />
          {aggregateLabel} · tap to view
        </span>
      )
    }
    if (!canStart) return <span className='foot-hint'>Runs from a handoff</span>
    return (
      <div className='card-foot'>
        <button className='btn btn-primary' onClick={start}>START</button>
      </div>
    )
  }
```

Pass the status pill from the aggregate too (the card already takes `status`; feed it `aggOf(agent.id).status`).

- [ ] **Step 3: Wire from `InboxView`**

On each `<AgentCard>`: `status={aggOf(agent.id).status}` and `aggregateLabel={aggregateLabel(aggOf(agent.id))}` (import `aggregateLabel` from `./aggregate`).

- [ ] **Step 4: Typecheck + browser**

Run: `yarn typecheck`. Browser: with 2 reply copies (one awaiting approval), the REPLY type card reads `2 active · 1 awaiting approval` and the pill shows Approve.

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/client/src/components/AgentCard.tsx apps/inbox/client/src/InboxView.tsx
git commit -m "feat(inbox): type card shows instance aggregate headline + status"
```

---

## Task 11: Docs

**Files:**
- Modify: `CLAUDE.md`, `HANDOFF.md`, `docs/BUILD-LOG.md`

- [ ] **Step 1: CLAUDE.md** — add a "Don't-rediscover" gotcha:
  - Instances are **dynamic, client-side proxies** via `copilotkit.registerProxiedAgent({ agentId: localId, runtimeAgentId: wf__agent })`; the server still registers ONE agent per `wf__agent`. Concurrency is bounded per-agent by `defineAgent.maxInstances` (default 2; `triage`/`qualifier` = 1). Overflow waits in a per-agent queue and auto-starts on a free slot. A `done` instance is `unregister`'d immediately EXCEPT input agents (kept) and parents with a live child (kept, shown Working).
  - Pipeline render rule (cross-link the memory): `parent → bordered container`; 1 instance = card, ≥2 = agent header + L-connected nested cards; depth-2 flattened with the parent repeated.
- [ ] **Step 2: HANDOFF.md** — move "dynamic agent instances" to "Where we are now" (BUILT, browser-verified), summarize.
- [ ] **Step 3: BUILD-LOG.md** — add §9 with the per-feature narrative.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md HANDOFF.md docs/BUILD-LOG.md
git commit -m "docs: dynamic agent instances (maxInstances, proxied agents, pipeline blocks)"
```

---

## Task 12: Full verification (gate before claiming done)

- [ ] **Step 1: Static gates**

```bash
yarn typecheck && yarn lint && yarn test && yarn format:check
```
Expected: all green. (Per `CLAUDE.md`, lint must stay green.)

- [ ] **Step 2: Kill stale dev servers, then fresh boot** (per `CLAUDE.md`)

```bash
pkill -9 -f "apps/inbox/node_modules/.bin/(tsx|vite|concurrently)" || true
lsof -tiTCP:4000,:5173 | xargs kill -9 2>/dev/null || true
yarn dev
```
Confirm the boot log shows `server on http://localhost:4000` from THIS run (no `EADDRINUSE`).

- [ ] **Step 3: Browser E2E** (real github board read-only + real Gmail; drive it yourself per memory `always-run-browser-e2e`):
  1. Start TRIAGE; route ticket #1 → reply-draft: one copy runs.
  2. While #1 runs, route ticket #2 → reply-draft: a SECOND copy runs concurrently (not overwriting #1). REPLY group shows header + 2 nested L-connected cards.
  3. Route ticket #3 → `queued: 1` line appears; no third copy yet.
  4. Let #1 finish/approve → it disappears; #3 auto-starts (queue drained).
  5. A single-instance worker (feature) shows as one card, no header.
  6. Type card headline reads `N active · M awaiting approval`; pill matches.
  7. Input agent (TRIAGE) stays in the pipeline after done.
  8. No tool chip stuck on "Running"; narration is one bubble (regression check).
  9. Long ticket title truncates with ellipsis; status pill stays aligned.

- [ ] **Step 4: Final commit if any doc/polish tweaks**

```bash
git add -A && git commit -m "chore: verification polish for agent instances"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** maxInstances (T1–T2), queue+cap (T5,T7), dynamic proxies/registerProxiedAgent (T7), aggregate card (T4,T10), instance labels (T8 deliver), lifecycle done/input/parent (T7 onFinalized, T6 builder), pipeline layout 1-vs-N + depth-2 (T6,T9), browser E2E (T12). ✅
- **Placeholder scan:** no TBD/TODO; CSS step references the validated mockup file for exact values; every code step has complete code. ✅
- **Type consistency:** `PInstance`/`AgentGroup`/`PipelineBlock` (T6) reused verbatim in T7/T9; `Routable` (T5) is a `PInstance` subset; `SpawnArgs` fields match `deliver`'s spawn call (T8); `aggregateAgent`/`aggregateLabel` (T4) used in T8/T10. ✅
- **Known risk:** T7 is CopilotKit-runtime-bound (proxied-agent behavior); it is verified in the browser (T12), not by a unit test — explicitly flagged with the runtime unknowns to probe.
