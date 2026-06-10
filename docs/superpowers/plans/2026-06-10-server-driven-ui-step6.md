# Server-Driven UI (Step 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the server the single source of truth for the consumer UI — the React client reads board/thread state over HTTP+SSE and acts via plain HTTP — and delete all `@copilotkit/*` packages and the `<CopilotKit>` tree.

**Architecture:** The step 3–5 spine already exposes every read/act endpoint. Step 6 (a) lifts the pure delivery helpers into `@platform/core` and adds two small server routes (`/api/deliver`, `/api/dispatch`), then (b) rewrites the client from CopilotKit proxied-agents to four data hooks (`useBoard`, `useWorkItemThread`, `useGate`, `useDispatch`) feeding the EXISTING pure models (`pipelineModel`, `aggregate`) and cards (`renderRegistry`). Handoff is a human-gated card-button → `POST /api/deliver` (server resolves the `Destination` + dispatches a child with `parentId`). Approval is gate-driven (`GET .../gate` + `POST /api/gates/:id/resolve`), not a CopilotKit `respond` callback.

**Tech Stack:** TypeScript, React 18, Vite, Hono, `@ag-ui/client` (kept — the event vocabulary), `@platform/core` (`foldEventsToMessages`, `resolveDelivery`), Postgres spine, vitest, Playwright-MCP for browser E2E.

**Spec:** `docs/superpowers/specs/2026-06-10-server-driven-ui-step6-design.md`

**Branch:** continue on `feat/provider-contract-v2` (same-branch strategy, steps 1–6).

---

## File Structure

**Create:**
- `packages/core/src/delivery.ts` — `resolveDelivery` + `deliveryKey` (moved from client, pure).
- `packages/core/src/delivery.test.ts` — moved/copied from `apps/inbox/client/src/deliver.test.ts`.
- `apps/inbox/client/src/hooks/useBoard.ts` — board snapshot + SSE refetch.
- `apps/inbox/client/src/hooks/useWorkItemThread.ts` — trace snapshot + SSE tail → folded messages.
- `apps/inbox/client/src/hooks/useGate.ts` — open-gate fetch + approve/reject POST.
- `apps/inbox/client/src/hooks/useDispatch.ts` — start/deliver/cancel POSTs.
- `apps/inbox/client/src/boardModel.ts` — map server `WorkItem[]` → `PInstance[]` + status reduce + per-agent aggregate/queued. Pure.
- `apps/inbox/client/src/boardModel.test.ts`.
- `apps/inbox/client/src/serverTypes.ts` — client-side TS types for `WorkItem`/`Gate`/server status union (mirror of `db/schema` fields the client consumes; no server import).

**Modify:**
- `packages/core/src/index.ts` — export `./delivery`.
- `apps/inbox/server/pipeline/routes.ts` — rename `/api/dev/runs` → `/api/dispatch`; add `POST /api/deliver`.
- `apps/inbox/server/pipeline/pipelineService.ts` — add a `deliver(...)` façade method (resolve + dispatch).
- `apps/inbox/server/index.ts` — delete the CopilotKit endpoint mount; pass `descriptors` to the pipeline for delivery resolution.
- `apps/inbox/client/src/status.ts` — add the server status union + `mapStatus`.
- `apps/inbox/client/src/renderSpecs.ts` — change `HitlSpec.render` ctx to gate-driven `{form, formRev, status, approve, reject}`.
- `apps/inbox/workflows/lead-inbox/client.tsx` + `apps/inbox/workflows/github-triage/client.tsx` — update the HITL spec render to the new ctx; `deliver`-calling render specs unchanged in shape.
- `apps/inbox/client/src/components/AgentModal.tsx` — `renderToolCall` becomes a locally-built function; add a gate-form slot for `awaiting_approval`.
- `apps/inbox/client/src/InboxView.tsx` — rewrite to drive from `useBoard` (no CopilotKit).
- `apps/inbox/client/src/App.tsx` — drop the `<CopilotKit>` wrapper.
- `apps/inbox/client/src/deliver.ts` — re-export from core (or delete + re-point imports).
- `apps/inbox/package.json` — remove `@copilotkit/react-core`, `@copilotkit/runtime` (FINAL commit).

**Delete:**
- `apps/inbox/client/src/useAgentInstances.ts`, `instancesCore.ts` (+ its test if logic not reused), `statusFrom.ts` (+ `statusFrom.test.ts`), `InstanceTools.tsx`, `useWorkflowRenders.tsx`, `components/LiveInstanceModal.tsx`, `spike/TraceSpike.tsx`.
- `apps/inbox/client/src/renderVerdict.test.tsx` / `renderLead.test.tsx` (rewrite as direct-mount card tests in Task 14).

---

## Phase A — Server: delivery helpers in core + deliver/dispatch routes

### Task 1: Move `resolveDelivery`/`deliveryKey` into `@platform/core`

**Files:**
- Create: `packages/core/src/delivery.ts`
- Create: `packages/core/src/delivery.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test** — copy `apps/inbox/client/src/deliver.test.ts` to `packages/core/src/delivery.test.ts`, re-pointing the import to `./delivery`. (Keep the existing cases: intra-workflow resolves to `instanceId`; cross-workflow validates schema + resolves to the private input agent; unknown workflow/input + schema mismatch → `{ok:false}`; `deliveryKey` thread/number/email/undefined.)

- [ ] **Step 2: Run it to verify it fails** — `yarn test packages/core/src/delivery.test.ts` → FAIL (`Cannot find module './delivery'`).

- [ ] **Step 3: Create `delivery.ts`** — move the body of `apps/inbox/client/src/deliver.ts` verbatim (it already imports only `Destination`, `WorkflowDescriptor`, `instanceId` from core-internal modules):

```ts
import type { Destination } from './defineWorkflow.js'
import type { WorkflowDescriptor } from './defineWorkflow.js'
import { instanceId } from './defineWorkflow.js'

export type DeliveryResult =
  | { ok: true; instanceId: string; targetWorkflow?: string }
  | { ok: false; error: string }

export function resolveDelivery(
  workflows: WorkflowDescriptor[],
  origin: string,
  dest: Destination,
  payload: unknown
): DeliveryResult {
  if (dest.kind === 'agent') {
    return { ok: true, instanceId: instanceId(origin, dest.agentId) }
  }
  const wf = workflows.find((w) => w.id === dest.workflow)
  if (!wf) return { ok: false, error: `unknown workflow "${dest.workflow}"` }
  const input = wf.inputs.find((i) => i.name === dest.input)
  if (!input)
    return { ok: false, error: `workflow "${dest.workflow}" has no input "${dest.input}"` }
  if (!input.schema.safeParse(payload).success) {
    return { ok: false, error: `payload does not match contract "${dest.workflow}.${dest.input}"` }
  }
  return { ok: true, instanceId: instanceId(wf.id, input.agentId), targetWorkflow: wf.id }
}

export function deliveryKey(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const p = payload as Record<string, unknown>
  if (typeof p.threadId === 'string' && p.threadId) return `thread:${p.threadId}`
  if (typeof p.number === 'number') return `number:${p.number}`
  if (typeof p.from === 'string' && typeof p.subject === 'string')
    return `email:${p.from}|${p.subject}`
  return undefined
}
```

- [ ] **Step 4: Export from core** — add to `packages/core/src/index.ts`: `export * from './delivery.js'` (match the existing export style in that file).

- [ ] **Step 5: Run it to verify it passes** — `yarn test packages/core/src/delivery.test.ts` → PASS.

- [ ] **Step 6: Re-point the client `deliver.ts`** — replace its body with a re-export so existing client imports keep working until they're rewritten:

```ts
export { resolveDelivery, deliveryKey, type DeliveryResult } from '@platform/core'
```

Delete `apps/inbox/client/src/deliver.test.ts` (now covered in core).

- [ ] **Step 7: Typecheck + commit** — `yarn typecheck && yarn test packages/core` → green.

```bash
git add packages/core/src/delivery.ts packages/core/src/delivery.test.ts packages/core/src/index.ts apps/inbox/client/src/deliver.ts
git rm apps/inbox/client/src/deliver.test.ts
git commit -m "refactor(core): lift resolveDelivery/deliveryKey into @platform/core (pure, server-reusable)"
```

### Task 2: `PipelineService.deliver` + `/api/deliver` + promote `/api/dispatch`

**Files:**
- Modify: `apps/inbox/server/pipeline/pipelineService.ts`
- Modify: `apps/inbox/server/pipeline/routes.ts`
- Modify: `apps/inbox/server/index.ts`
- Test: `apps/inbox/server/pipeline/deliver.test.ts` (new, real-PG, on `aiworkflow_test`)

- [ ] **Step 1: Add `descriptors` to PipelineService deps** — in `pipelineService.ts` extend `PipelineServiceDeps` with `descriptors: WorkflowDescriptor[]` and add a `deliver` method to the returned façade:

```ts
// in PipelineServiceDeps:
descriptors: import('@platform/core').WorkflowDescriptor[]

// new façade method (uses resolveDelivery + deliveryKey from core):
async deliver(req: {
  origin: string
  dest: import('@platform/core').Destination
  payload: Record<string, unknown>
  parentId: string
}): Promise<{ ok: true; id: string; deduped: boolean } | { ok: false; error: string }> {
  const r = resolveDelivery(deps.descriptors, req.origin, req.dest, req.payload)
  if (!r.ok) return { ok: false, error: r.error }
  const [workflowId] = r.instanceId.split('__')
  const result = await this.dispatch({
    workflowId: workflowId ?? r.instanceId,
    agentId: r.instanceId,
    origin: 'agent',
    payload: req.payload,
    source: deliveryKey(req.payload) ?? null,
    parentId: req.parentId,
  })
  return { ok: true, ...result }
},
```

Add the import at the top: `import { resolveDelivery, deliveryKey } from '@platform/core'`. NOTE: `this.dispatch` inside an object literal — convert the returned object to a `const service = {...}; return service` form if `this` doesn't bind, OR call the local `dispatchChokepoint` directly with the resolved `maxInstances` (preferred — mirror the existing `dispatch` method body to avoid `this`):

```ts
async deliver(req) {
  const r = resolveDelivery(deps.descriptors, req.origin, req.dest, req.payload)
  if (!r.ok) return { ok: false, error: r.error }
  const [workflowId] = r.instanceId.split('__')
  const runtime = deps.resolveAgent(r.instanceId)
  const maxInstances = runtime?.maxInstances ?? 1
  const result = await dispatchChokepoint(db, pool, {
    workflowId: workflowId ?? r.instanceId,
    agentId: r.instanceId,
    origin: 'agent',
    payload: req.payload,
    source: deliveryKey(req.payload) ?? null,
    parentId: req.parentId,
    maxInstances,
  })
  return { ok: true, ...result }
},
```

- [ ] **Step 2: Write the failing integration test** — `apps/inbox/server/pipeline/deliver.test.ts` (follow the existing pipeline test pattern: real PG on `aiworkflow_test`, unique uuids/sources, NO truncate in beforeEach). Assert: an intra-workflow `deliver({origin:'lead-inbox', dest:{kind:'agent',agentId:'reply'}, payload:{threadId:'t-<uuid>',...}, parentId})` inserts a child WorkItem with `parentId` set, `agentId='lead-inbox__reply'`, `source='thread:t-<uuid>'`, `origin='agent'`; a second identical deliver returns `{deduped:true}` and inserts no second row; a bad cross-workflow payload returns `{ok:false}`.

- [ ] **Step 3: Run it to verify it fails** — `yarn workspace inbox test deliver.test.ts` (or root `yarn test apps/inbox/server/pipeline/deliver.test.ts`) → FAIL (`deliver` undefined).

- [ ] **Step 4: Wire `descriptors` at construction** — in `apps/inbox/server/index.ts`, pass `descriptors: workflowServers.map((w) => w.descriptor)` into `makePipelineService({...})`.

- [ ] **Step 5: Run it to verify it passes** — same command → PASS.

- [ ] **Step 6: Add the routes** — in `routes.ts`, rename `/api/dev/runs` to `/api/dispatch` (keep the body) and add:

```ts
// DELIVER — a human-gated handoff from a rendered card. Resolves the Destination
// server-side and dispatches a child work item (parentId = the card's work item).
app.post('/api/deliver', async (c) => {
  const body = await c.req.json<{
    origin: string
    dest: import('@platform/core').Destination
    payload: Record<string, unknown>
    parentId: string
  }>()
  const r = await service.deliver(body)
  return r.ok ? c.json({ id: r.id, deduped: r.deduped }) : c.json({ error: r.error }, 400)
})
```

- [ ] **Step 7: Typecheck + lint + commit**

```bash
git add apps/inbox/server/pipeline/pipelineService.ts apps/inbox/server/pipeline/routes.ts apps/inbox/server/pipeline/deliver.test.ts apps/inbox/server/index.ts
git commit -m "feat(pipeline): POST /api/deliver (server-side handoff) + promote /api/dispatch"
```

### Task 3: Delete the server CopilotKit endpoint

**Files:** Modify `apps/inbox/server/index.ts`

- [ ] **Step 1: Remove the mount** — delete the `import { CopilotRuntime, createCopilotEndpoint, InMemoryAgentRunner } from '@copilotkit/runtime/v2'` line, the `const copilot = createCopilotEndpoint({...})` block, and `app.route('/', copilot)`. Keep `app.route('/', createPipelineRoutes(pipeline))` and `buildAgent`/`buildProvider` (the providers/runtimes are still used by the RunObserver). If `buildAgent` only produced CopilotKit `agents` for the endpoint, drop the now-unused `agents` map; keep `runtimes` (the RunObserver's `resolveAgent` source).

- [ ] **Step 2: Verify server boots** — `DEV_RECORD_REPLAY=1 yarn dev:server` → expect `server on http://localhost:4000`, no `@copilotkit/runtime` import error, no `/api/copilotkit` route. `curl -s localhost:4000/api/board | head` returns JSON. Kill it.

- [ ] **Step 3: Commit**

```bash
git add apps/inbox/server/index.ts
git commit -m "refactor(server): drop CopilotKit endpoint — pipeline routes are the only surface"
```

---

## Phase B — Client data hooks + board model (pure, testable)

### Task 4: `serverTypes.ts` + `status.ts` server mapping

**Files:**
- Create: `apps/inbox/client/src/serverTypes.ts`
- Modify: `apps/inbox/client/src/status.ts`
- Test: `apps/inbox/client/src/status.test.ts` (new)

- [ ] **Step 1: serverTypes** — declare the client-facing shapes (no server import; mirror `db/schema` fields the UI reads):

```ts
export type ServerStatus =
  | 'queued' | 'running' | 'awaiting_approval' | 'awaiting_input'
  | 'result' | 'finished' | 'error' | 'closed'
export type Resolution = 'cancelled' | 'rejected' | null

export type WorkItem = {
  id: string
  workflowId: string
  agentId: string // `wf__agent`
  parentId: string | null
  origin: 'human' | 'agent' | 'inbound'
  source: string | null
  payload: Record<string, unknown>
  status: ServerStatus
  resolution: Resolution
  card: { tool: string; props: Record<string, unknown> } | null
  error: string | null
}

export type Gate = {
  id: string
  workItemId: string
  toolName: string
  form: Record<string, unknown>
  formRev: number
  proposedArtifact: Record<string, unknown>
  status: 'open' | 'resolved'
}

export type Board = { items: WorkItem[]; gates: Gate[]; lastEventId: number }
```

- [ ] **Step 2: Write the failing test** — `status.test.ts`: `mapStatus({status:'queued'})==='running'`; `'running'→'running'`; `'awaiting_approval'→'awaiting_approval'`; `'finished'→'done'`; `'closed'→'done'`; `'result'→'done'`; `'error'→'error'`; `'awaiting_input'→'awaiting_approval'` (treated as a pause needing the human).

- [ ] **Step 3: Run it to verify it fails** — `yarn test apps/inbox/client/src/status.test.ts` → FAIL (`mapStatus` undefined).

- [ ] **Step 4: Implement `mapStatus`** — append to `status.ts`:

```ts
import type { ServerStatus } from './serverTypes'

// The server status union (source of truth) reduced to the display Status.
export const mapStatus = (s: ServerStatus): Status => {
  switch (s) {
    case 'queued':
    case 'running':
      return 'running'
    case 'awaiting_approval':
    case 'awaiting_input':
      return 'awaiting_approval'
    case 'result':
    case 'finished':
    case 'closed':
      return 'done'
    case 'error':
      return 'error'
  }
}
```

- [ ] **Step 5: Run it to verify it passes** — PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/inbox/client/src/serverTypes.ts apps/inbox/client/src/status.ts apps/inbox/client/src/status.test.ts
git commit -m "feat(client): server status union + mapStatus → display Status"
```

### Task 5: `boardModel.ts` — board items → pipeline + aggregate (pure)

**Files:**
- Create: `apps/inbox/client/src/boardModel.ts`
- Test: `apps/inbox/client/src/boardModel.test.ts`

- [ ] **Step 1: Write the failing test** — for a board with a qualifier (input, running) + two reply children (`parentId` = qualifier id, one `awaiting_approval`, one `queued`) in `lead-inbox`, assert:
  - `toPInstances(items, 'lead-inbox', roleOf)` returns instances with `localId=item.id`, `parentLocalId=item.parentId`, `agentId` stripped of `wf__`, `status=mapStatus(...)`, `isInput` from `roleOf`.
  - `queuedByAgent(items, 'lead-inbox')` returns `{ reply: 1 }` (the one queued child; queued items are NOT emitted as instances — they show as the `queued: N` line, matching the old model).
  - `statusesOf(items, 'lead-inbox', 'reply')` returns the display statuses of reply's non-queued items.

- [ ] **Step 2: Run it to verify it fails** — `yarn test apps/inbox/client/src/boardModel.test.ts` → FAIL.

- [ ] **Step 3: Implement `boardModel.ts`**:

```ts
import type { WorkItem } from './serverTypes'
import { mapStatus, type Status } from './status'
import type { PInstance } from './pipelineModel'

const stripWf = (agentId: string, workflowId: string) => agentId.slice(workflowId.length + 2)
const isQueued = (w: WorkItem) => w.status === 'queued'
// An item is shown in the pipeline once it is no longer just queued AND still relevant
// (active, or finished-but-with-a-result-card / awaiting / error). Plain finished leaf
// workers with no card drop out — matches the old "done workers torn down" behavior.
const isVisible = (w: WorkItem) =>
  !isQueued(w) && (w.status !== 'finished' || w.card !== null || w.resolution !== null)

export const toPInstances = (
  items: WorkItem[],
  workflowId: string,
  roleOf: (agentId: string) => 'input' | 'worker' | undefined,
  metaIcon: (agentId: string) => string,
  nameOf: (agentId: string) => string,
  labelOf: (w: WorkItem) => string
): PInstance[] =>
  items
    .filter((w) => w.workflowId === workflowId && isVisible(w))
    .map((w) => {
      const agentId = stripWf(w.agentId, workflowId)
      return {
        localId: w.id,
        runtimeKey: w.agentId,
        agentId,
        name: nameOf(agentId),
        iconName: metaIcon(agentId) as PInstance['iconName'],
        label: labelOf(w),
        status: mapStatus(w.status),
        parentLocalId: w.parentId ?? undefined,
        isInput: roleOf(agentId) === 'input',
      }
    })

export const queuedByAgent = (items: WorkItem[], workflowId: string): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const w of items) {
    if (w.workflowId !== workflowId || !isQueued(w)) continue
    const a = stripWf(w.agentId, workflowId)
    out[a] = (out[a] ?? 0) + 1
  }
  return out
}

export const statusesOf = (items: WorkItem[], workflowId: string, agentId: string): Status[] =>
  items
    .filter((w) => w.workflowId === workflowId && stripWf(w.agentId, workflowId) === agentId && !isQueued(w))
    .map((w) => mapStatus(w.status))
```

- [ ] **Step 4: Run it to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/client/src/boardModel.ts apps/inbox/client/src/boardModel.test.ts
git commit -m "feat(client): boardModel — server WorkItem[] → PInstance tree + queued/aggregate (pure)"
```

### Task 6: `useBoard` hook

**Files:** Create `apps/inbox/client/src/hooks/useBoard.ts`

- [ ] **Step 1: Implement** (no unit test — it's I/O; covered by browser E2E):

```ts
import { useEffect, useRef, useState } from 'react'
import type { Board } from '../serverTypes'

// Board is server-authoritative: fetch the snapshot, then on ANY board SSE message
// refetch the snapshot (coarse model — the SSE is a poke, the snapshot is the truth,
// so duplicate/out-of-order pokes and reconnects are all harmless).
export const useBoard = (): Board => {
  const [board, setBoard] = useState<Board>({ items: [], gates: [], lastEventId: 0 })
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    let cancelled = false
    const refetch = async () => {
      const b = (await (await fetch('/api/board')).json()) as Board
      if (!cancelled) setBoard(b)
    }
    void refetch()
    const es = new EventSource('/api/board/stream')
    esRef.current = es
    es.addEventListener('board', () => void refetch())
    return () => {
      cancelled = true
      es.close()
    }
  }, [])

  return board
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/inbox/client/src/hooks/useBoard.ts
git commit -m "feat(client): useBoard — snapshot + board SSE refetch"
```

### Task 7: `useWorkItemThread` hook

**Files:** Create `apps/inbox/client/src/hooks/useWorkItemThread.ts`

- [ ] **Step 1: Implement** (productize the spike effect):

```ts
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BaseEvent } from '@ag-ui/client'
import { foldEventsToMessages, pairToolResults } from '@platform/core'
import type { ServerStatus } from '../serverTypes'

export const useWorkItemThread = (id: string | null) => {
  const [status, setStatus] = useState<ServerStatus>('running')
  const [bySeq, setBySeq] = useState<Map<number, BaseEvent>>(new Map())
  const esRef = useRef<EventSource | null>(null)

  const setEvent = (seq: number, event: BaseEvent) =>
    setBySeq((prev) => {
      if (prev.has(seq)) return prev
      const next = new Map(prev)
      next.set(seq, event)
      return next
    })

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setBySeq(new Map())
    void (async () => {
      const snap = (await (await fetch(`/api/workitems/${id}/trace?from=0`)).json()) as {
        status: ServerStatus
        nextSeq: number
        events: { seq: number; event: BaseEvent }[]
      }
      if (cancelled) return
      setBySeq(new Map(snap.events.map((e) => [e.seq, e.event])))
      setStatus(snap.status)
      const es = new EventSource(`/api/workitems/${id}/stream?from=${snap.nextSeq}`)
      esRef.current = es
      es.onmessage = (m) => setEvent(Number(m.lastEventId), JSON.parse(m.data) as BaseEvent)
      es.addEventListener('status', (m) => setStatus((m as MessageEvent).data as ServerStatus))
    })()
    return () => {
      cancelled = true
      esRef.current?.close()
    }
  }, [id])

  const events = useMemo(
    () => [...bySeq.entries()].sort((a, b) => a[0] - b[0]).map(([, e]) => e),
    [bySeq]
  )
  const messages = useMemo(() => foldEventsToMessages(events), [events])
  const toolResults = useMemo(() => pairToolResults(messages), [messages])
  return { messages, toolResults, status }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/inbox/client/src/hooks/useWorkItemThread.ts
git commit -m "feat(client): useWorkItemThread — trace snapshot + SSE tail → folded messages"
```

### Task 8: `useGate` + `useDispatch` hooks

**Files:** Create `apps/inbox/client/src/hooks/useGate.ts`, `apps/inbox/client/src/hooks/useDispatch.ts`

- [ ] **Step 1: useGate**:

```ts
import { useCallback, useEffect, useState } from 'react'
import type { Destination } from '@platform/core'
import type { Gate } from '../serverTypes'

// The gate is authoritative (its form + formRev, not the stream args). Fetch it when the
// thread is awaiting approval; approve/reject POST /api/gates/:id/resolve. A 409 (formRev
// moved) refetches the gate so the card re-renders against the current rev.
export const useGate = (workItemId: string | null, awaiting: boolean) => {
  const [gate, setGate] = useState<Gate | null>(null)

  const refetch = useCallback(async () => {
    if (!workItemId) return
    const res = await fetch(`/api/workitems/${workItemId}/gate`)
    setGate(res.ok ? ((await res.json()) as Gate) : null)
  }, [workItemId])

  useEffect(() => {
    if (awaiting) void refetch()
    else setGate(null)
  }, [awaiting, refetch])

  const resolve = useCallback(
    async (decision: 'approved' | 'rejected', form?: Record<string, unknown>, comment?: string) => {
      if (!gate) return
      const res = await fetch(`/api/gates/${gate.id}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, formRev: gate.formRev, form, comment }),
      })
      if (res.status === 409) await refetch() // rev moved — re-render the gate
    },
    [gate, refetch]
  )

  return {
    gate,
    approve: (form: Record<string, unknown>) => resolve('approved', form),
    reject: (comment?: string) => resolve('rejected', undefined, comment),
  }
}
```

- [ ] **Step 2: useDispatch**:

```ts
import { useCallback } from 'react'
import type { Destination } from '@platform/core'

export const useDispatch = () => {
  const start = useCallback(async (agentKey: string): Promise<string> => {
    const res = await fetch('/api/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: agentKey }),
    })
    const { id } = (await res.json()) as { id: string }
    return id
  }, [])

  const deliver = useCallback(
    async (origin: string, dest: Destination, payload: unknown, parentId: string) => {
      await fetch('/api/deliver', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ origin, dest, payload, parentId }),
      })
    },
    []
  )

  const cancel = useCallback(async (id: string) => {
    await fetch(`/api/workitems/${id}/cancel`, { method: 'POST' })
  }, [])

  const cancelWorkflow = useCallback(async (id: string) => {
    await fetch(`/api/workflows/${id}/cancel`, { method: 'POST' })
  }, [])

  return { start, deliver, cancel, cancelWorkflow }
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
git add apps/inbox/client/src/hooks/useGate.ts apps/inbox/client/src/hooks/useDispatch.ts
git commit -m "feat(client): useGate (gate-driven approve/reject) + useDispatch (start/deliver/cancel)"
```

---

## Phase C — Thread + approval rendering (no CopilotKit)

### Task 9: Gate-driven `HitlSpec` contract

**Files:**
- Modify: `apps/inbox/client/src/renderSpecs.ts`
- Modify: `apps/inbox/workflows/lead-inbox/client.tsx`
- Modify: `apps/inbox/workflows/github-triage/client.tsx` (if it has a HITL spec — check; lead-inbox's `saveDraft` is the main one)

- [ ] **Step 1: Change `HitlSpec.render` ctx** in `renderSpecs.ts`:

```ts
// A human-in-the-loop tool. The GATE is authoritative — the card edits the gate's `form`
// and calls approve(editedForm)/reject(comment), which POST /api/gates/:id/resolve.
export type HitlSpec = {
  toolName: string
  parameters: z.ZodTypeAny
  render: (
    ctx: {
      form: Record<string, unknown>
      formRev: number
      status: string
      approve: (form: Record<string, unknown>) => void
      reject: (comment?: string) => void
    },
    registry: Registry
  ) => ReactElement
}
```

- [ ] **Step 2: Update `leadInboxHitl`** in `lead-inbox/client.tsx`:

```ts
export const leadInboxHitl: HitlSpec[] = [
  {
    toolName: 'saveDraft',
    parameters: z.object({ threadId: z.string(), body: z.string() }),
    render: ({ form, approve, reject }, registry) => {
      const Approval = registry['ApprovalDialog']
      const body = typeof form.body === 'string' ? form.body : ''
      const threadId = typeof form.threadId === 'string' ? form.threadId : ''
      return (
        <Approval
          data={{ threadId, body }}
          onApprove={(editedBody?: string) => approve({ ...form, body: editedBody ?? body })}
          onReject={() => reject('no thanks')}
        />
      )
    },
  },
]
```

- [ ] **Step 3: Update `ApprovalDialog`** (`apps/inbox/client/src/components/ApprovalDialog.tsx`) — make the body editable (a `textarea` bound to local state), call `onApprove(editedBody)` and add an `onReject`. (Read the current component; keep its Smedja markup, add the textarea + reject button. The edited body must flow to `onApprove` — this is the load-bearing "edited text lands in Gmail" path.)

- [ ] **Step 4: Typecheck** — `yarn typecheck`. Expect type errors where the old ctx was used; fix them.

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/client/src/renderSpecs.ts apps/inbox/workflows/lead-inbox/client.tsx apps/inbox/client/src/components/ApprovalDialog.tsx
git commit -m "refactor(client): gate-driven HITL — ApprovalDialog edits gate form, approve/reject via HTTP"
```

### Task 10: Local `renderToolCall` + gate slot in `AgentModal`

**Files:** Modify `apps/inbox/client/src/components/AgentModal.tsx`

- [ ] **Step 1: Change `AgentModal` props** — replace the CopilotKit `renderToolCall` prop with the locally-built one, and add a `gateSlot?: ReactNode` rendered below the thread when awaiting approval:

```ts
// renderToolCall is now built by the caller from renderSpecs (no CopilotKit):
renderToolCall: (args: { toolCall: ToolCall; toolMessage?: ToolMessage }) => ReactNode
// gateSlot: the gate-sourced approval card (when status === awaiting_approval).
gateSlot?: ReactNode
```

Render `{gateSlot}` after `{thread}` (and after `{sent}` notes). Keep everything else (the message walk, dev-mode filter, ThreadResultsContext, intro/typing).

- [ ] **Step 2: Build `renderToolCall` in a shared helper** — create `apps/inbox/client/src/buildRenderToolCall.tsx`:

```tsx
import type { ReactNode } from 'react'
import type { ToolCall, ToolMessage } from '@platform/core'
import { renderRegistry } from './renderRegistry'
import { renderSpecs } from './workflows'
import type { DeliverFn } from './renderSpecs'

// Local replacement for CopilotKit's useRenderToolCall: parse the tool-call args and
// dispatch to the matching render spec. `deliver` is the handoff seam (POST /api/deliver).
export const buildRenderToolCall =
  (deliver: DeliverFn) =>
  ({ toolCall }: { toolCall: ToolCall; toolMessage?: ToolMessage }): ReactNode => {
    const spec = renderSpecs.find((s) => s.toolName === toolCall.function?.name)
    if (!spec) return null
    let parameters: unknown = {}
    try {
      parameters = JSON.parse(toolCall.function?.arguments || '{}')
    } catch {
      return null
    }
    return spec.render({ parameters }, deliver, renderRegistry)
  }
```

- [ ] **Step 3: Typecheck** — `yarn typecheck` (AgentModal's other consumers will error until Task 11 rewrites InboxView; that's expected — proceed to Task 11 before re-checking).

- [ ] **Step 4: Commit**

```bash
git add apps/inbox/client/src/components/AgentModal.tsx apps/inbox/client/src/buildRenderToolCall.tsx
git commit -m "refactor(client): AgentModal takes a local renderToolCall + gate slot (CopilotKit removed)"
```

---

## Phase D — InboxView rewrite + App shell

### Task 11: Rewrite `InboxView` on `useBoard`

**Files:** Modify `apps/inbox/client/src/InboxView.tsx` (full rewrite)

- [ ] **Step 1: Rewrite** — drive entirely from `useBoard()` + the pure models. Key structure (no CopilotKit imports):

```tsx
import { useState } from 'react'
import type { AgentDefinition, Destination } from '@platform/core'
import { instanceId } from '@platform/core'
import { useBoard } from './hooks/useBoard'
import { useDispatch } from './hooks/useDispatch'
import { useWorkItemThread } from './hooks/useWorkItemThread'
import { useGate } from './hooks/useGate'
import { buildRenderToolCall } from './buildRenderToolCall'
import { toPInstances, queuedByAgent, statusesOf } from './boardModel'
import { aggregateAgent, aggregateLabel } from './aggregate'
import { buildPipeline } from './pipelineModel'
import { AgentCard } from './components/AgentCard'
import { AgentModal } from './components/AgentModal'
import { InstancePickerModal } from './components/InstancePickerModal'
import { PipelineColumn } from './components/PipelineColumn'
import { WorkflowSwitcher } from './components/WorkflowSwitcher'
import { Icon } from './components/Icon'
import { mapStatus } from './status'
import { workflows, META, renderSpecs, hitlSpecs } from './workflows'

const renderableToolNames = new Set([
  ...renderSpecs.map((s) => s.toolName),
  ...hitlSpecs.map((s) => s.toolName),
])
```

Then in the component:
- `const board = useBoard(); const { start, deliver, cancel } = useDispatch()`.
- `activeWorkflowId` state + `WorkflowSwitcher` (badge: count board items whose `workflowId === w.id && parentId is in another workflow && status active`, since last view — keep a `seenAt` ref per workflow, or simply count active cross-workflow children for the beta).
- `roleOf/metaIcon/nameOf/labelOf` closures from the active `workflow` descriptor + `META`.
- `pInstances = toPInstances(board.items, workflow.id, roleOf, metaIcon, nameOf, labelOf)`.
- `blocks = buildPipeline(pInstances, queuedByAgent(board.items, workflow.id))`.
- `aggOf(agentId) = aggregateAgent(statusesOf(board.items, workflow.id, agentId))`.
- `openId` = an open WorkItem id (was a localId). `openAgent(agentId)`: filter board items of that agent in the workflow that are visible; 0 → type view; 1 → open that item; ≥2 → picker (same logic as before, against board items).
- START: `onStart={() => start(instanceId(workflow.id, agent.id)).then(setOpenId)}`.
- Render the open thread via a child component `<ThreadModal id={openId} .../>` (Task 12) so `useWorkItemThread`/`useGate` hooks live in a component scoped to one id.
- DELETE: all `InstanceTools`, `LiveInstanceModal`, `CopilotChatConfigurationProvider`, `useCopilotKit`, `useRenderToolCall`, `useAgentInstances`, `useWorkflowRenders`, `handoffNotes` client state (notes now derived — Task 13).

- [ ] **Step 2: Typecheck** — fix errors. (The thread modal is Task 12; stub it minimally if needed to compile, then fill in.)

- [ ] **Step 3: Commit**

```bash
git add apps/inbox/client/src/InboxView.tsx
git commit -m "refactor(client): InboxView driven by useBoard + pure models (no CopilotKit)"
```

### Task 12: `ThreadModal` — one open work item

**Files:** Create `apps/inbox/client/src/components/ThreadModal.tsx`

- [ ] **Step 1: Implement** — wraps `AgentModal`, owns the per-id hooks:

```tsx
import { useMemo } from 'react'
import type { Destination } from '@platform/core'
import { useWorkItemThread } from '../hooks/useWorkItemThread'
import { useGate } from '../hooks/useGate'
import { buildRenderToolCall } from '../buildRenderToolCall'
import { renderRegistry } from '../renderRegistry'
import { hitlSpecs } from '../workflows'
import { mapStatus } from '../status'
import { AgentModal, type HandoffNote } from './AgentModal'
import type { IconName } from './Icon'

type Props = {
  id: string
  workflowId: string
  title: string
  iconName: IconName
  intro: string
  canStart: boolean
  renderableToolNames: ReadonlySet<string>
  notes: HandoffNote[]
  deliver: (origin: string, dest: Destination, payload: unknown, parentId: string) => void
  onStart: () => void
  onClose: () => void
  onOpenWorkflow?: (id: string) => void
}

export const ThreadModal = (p: Props) => {
  const { messages, status } = useWorkItemThread(p.id)
  const awaiting = mapStatus(status) === 'awaiting_approval'
  const { gate, approve, reject } = useGate(p.id, awaiting)

  const renderToolCall = useMemo(
    () => buildRenderToolCall((origin, dest, payload) => p.deliver(origin, dest, payload, p.id)),
    [p.id, p.deliver]
  )

  // Gate slot: render the workflow's HITL card from the authoritative gate.
  const gateSlot =
    gate &&
    (() => {
      const spec = hitlSpecs.find((s) => s.toolName === gate.toolName)
      if (!spec) return null
      return spec.render(
        { form: gate.form, formRev: gate.formRev, status, approve, reject },
        renderRegistry
      )
    })()

  return (
    <AgentModal
      agent={{ messages }}
      title={p.title}
      iconName={p.iconName}
      status={mapStatus(status)}
      renderToolCall={renderToolCall}
      renderableToolNames={p.renderableToolNames}
      loading={mapStatus(status) === 'running'}
      canStart={p.canStart}
      intro={p.intro}
      notes={p.notes}
      gateSlot={gateSlot}
      onOpenWorkflow={p.onOpenWorkflow}
      onStart={p.onStart}
      onClose={p.onClose}
    />
  )
}
```

- [ ] **Step 2: Wire into InboxView** — replace the old `openInstance && openAgentObj` block with `{openId && <ThreadModal id={openId} ... />}`. Type view (idle agent, no item) keeps an `AgentModal` with `agent={{messages:[]}}`, `renderToolCall={() => null}`, no gate slot.

- [ ] **Step 3: Typecheck** — `yarn typecheck` → green.

- [ ] **Step 4: Commit**

```bash
git add apps/inbox/client/src/components/ThreadModal.tsx apps/inbox/client/src/InboxView.tsx
git commit -m "feat(client): ThreadModal — per-item thread + gate-driven approval card"
```

### Task 13: Derive handoff notes from board topology

**Files:** Modify `apps/inbox/client/src/InboxView.tsx`

- [ ] **Step 1: Implement** — for the open item `id`, build `notes`:
  - `received`: if the open item has a `parentId`, a `{dir:'received', otherName: <parent agent name>, label: <payload label>}` note.
  - `sent`: for each child of the open item (board items with `parentId === id`), a `{dir:'sent', otherName: <child agent name>, label, targetWorkflow: child.workflowId !== workflow.id ? child.workflowId : undefined, targetLocalId: child.id}` note.
  This replaces the deleted `handoffNotes` client state. Pure derivation from `board.items`.

- [ ] **Step 2: Typecheck + commit**

```bash
git add apps/inbox/client/src/InboxView.tsx
git commit -m "feat(client): derive handoff notes from board parentId topology"
```

### Task 14: `App.tsx` shell + delete CopilotKit client files + rewrite card tests

**Files:**
- Modify: `apps/inbox/client/src/App.tsx`
- Delete: `useAgentInstances.ts`, `instancesCore.ts` (+test), `statusFrom.ts` (+test), `InstanceTools.tsx`, `useWorkflowRenders.tsx`, `components/LiveInstanceModal.tsx`, `spike/TraceSpike.tsx`
- Modify: `main.tsx` (remove `?spike=1` mount of `TraceSpike`)
- Rewrite: `renderVerdict.test.tsx`, `renderLead.test.tsx`

- [ ] **Step 1: App shell** — `App.tsx` becomes:

```tsx
import { InboxView } from './InboxView'

export const App = () => <InboxView />
```

- [ ] **Step 2: Remove the spike mount** in `main.tsx` (the `?spike=1` branch + `TraceSpike` import).

- [ ] **Step 3: Delete the dead files**:

```bash
git rm apps/inbox/client/src/useAgentInstances.ts apps/inbox/client/src/instancesCore.ts apps/inbox/client/src/instancesCore.test.ts apps/inbox/client/src/statusFrom.ts apps/inbox/client/src/statusFrom.test.ts apps/inbox/client/src/InstanceTools.tsx apps/inbox/client/src/useWorkflowRenders.tsx apps/inbox/client/src/components/LiveInstanceModal.tsx apps/inbox/client/src/spike/TraceSpike.tsx
```

(If `aggregate.ts`/`pipelineModel.ts` imported `statusFrom`, re-point them — they should not; verify with `grep -rn statusFrom apps/inbox/client/src`.)

- [ ] **Step 4: Rewrite the two card tests** — mount the card directly (no `<CopilotKit>`), e.g. render `<VerdictCard data={...} onDraftReply={fn} />` and assert the markup + that clicking the button calls `onDraftReply`. Same for `LeadCard`.

- [ ] **Step 5: Typecheck + test + lint** — `yarn typecheck && yarn test && yarn lint` → all green. Fix any dangling imports.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(client): App shell + delete CopilotKit proxied-agent layer + spike page"
```

---

## Phase E — Browser E2E (the memory rule: EVERY flow) + drop deps

### Task 15: Browser E2E on the new path

**Pre-flight (CLAUDE.md gotchas):** kill stale stacks + free ports + clean Playwright lock:
```bash
pkill -9 -f "AiWorkflow/node_modules/.bin/(tsx|vite|concurrently)"; lsof -tiTCP:4000,:5173,:5174 | xargs kill -9 2>/dev/null
pkill -9 -f "ms-playwright-mcp/mcp-chrome" 2>/dev/null; rm -f ~/Library/Caches/ms-playwright-mcp/mcp-chrome-*/Singleton* 2>/dev/null
yarn workspace inbox db:reset   # clean DB so the startup sweep doesn't re-spawn stale queued rows
```
Start ONE stack: `DEV_RECORD_REPLAY=1 yarn dev` (use recorded cassettes; for flows with no cassette use `DEV_RECORD_REPLAY=record` once, then replay). For approve-effect flows the effect runs OUTSIDE record/replay → hits real Gmail (draft-only; delete the test draft after).

- [ ] **Step 1: Single run** — open `http://localhost:5173`, START the qualifier → it runs, the LeadCard/VerdictCard appears in the thread; pipeline shows the qualifier; status flips running→done. PASS = card renders, no console errors, no page self-reload.
- [ ] **Step 2: Handoff** — click VerdictCard "Draft reply" → a reply child appears under the qualifier in the pipeline (server `parentId`); opening it shows the draft + a gate banner; status `awaiting_approval`. PASS = child dispatched server-side, nested under parent.
- [ ] **Step 3: Approve WITH an edited artifact** — edit the draft body (insert a unique marker), Approve → gate resolves, work item `finished`; **fetch the Gmail draft by id and confirm the edited marker is in the body** (the load-bearing guarantee). PASS = edited text in the real draft.
- [ ] **Step 4: Reject + re-run** — on a fresh gate, Reject with a comment → item `finished`/`rejected`, zero ledger rows; re-run the source and confirm a new gate is offered.
- [ ] **Step 5: Cancel mid-run** — START, then Stop while running → item `cancelled`, stream killed; Stop at `awaiting_approval` → gate 404.
- [ ] **Step 6: Reload mid-run** — START, reload the tab mid-run → the open thread re-attaches (the id must survive a reload; persist `openId` in the URL like the spike did), full history restored, live tail continues. PASS = nothing lost.
- [ ] **Step 7: 3-at-once cap** — route/start 3 instances of a cap-2 agent at once → board shows **2 active + `queued: 1`**; when one finishes the queued one starts. (This now tests the SERVER WorkerPool.) Use the github-triage workers or 3 deliveries.
- [ ] **Step 8: Cross-workflow** — github-triage "Treat as lead → Lead inbox" → a child appears in lead-inbox (background, no auto-switch), the lead-inbox tab shows a badge + "Open in lead-inbox". PASS = background dispatch + badge.
- [ ] **Step 9: Second-tab coherence** — open two tabs; an action in one (approve/start) reflects in the other via board SSE (snapshot refetch). PASS = both tabs converge.

Record each PASS/FAIL with the observed evidence. FAIL on any flow → fix before proceeding (do NOT mark BUILT on partial flows — memory rule).

### Task 16: Drop `@copilotkit/*` deps (FINAL commit)

**Files:** Modify `apps/inbox/package.json`

- [ ] **Step 1: Confirm no imports remain** — `grep -rn "@copilotkit" apps/inbox packages | grep -v node_modules` → ZERO hits (source). If any remain, fix them.
- [ ] **Step 2: Remove deps** — delete `@copilotkit/react-core` and `@copilotkit/runtime` from `apps/inbox/package.json` `dependencies`. KEEP `@ag-ui/client`.
- [ ] **Step 3: Reinstall + full gate** — `yarn install --ignore-engines && yarn typecheck && yarn test && yarn lint && yarn build` → all green; `yarn build` succeeds without CopilotKit.
- [ ] **Step 4: One more browser smoke** — `yarn dev`, confirm the app still boots + one single-run flow works after the dep removal (the install can shift the lockfile).
- [ ] **Step 5: Commit**

```bash
git add apps/inbox/package.json yarn.lock
git commit -m "chore(inbox): drop @copilotkit/* deps — UI is fully server-driven"
```

### Task 17: Mark step 6 BUILT

- [ ] **Step 1: Update `HANDOFF.md`** — flip the step 6 line to ✅ BUILT with an As-built note (endpoints used, deliver-endpoint discovery, deletions, the browser PASS list, the resolveDelivery→core lift). Note the next step = step 7 (extraction + packaging). Reference this spec + plan.
- [ ] **Step 2: Update `docs/BUILD-LOG.md`** — add the step-6 narrative section.
- [ ] **Step 3: Commit**

```bash
git add HANDOFF.md docs/BUILD-LOG.md
git commit -m "docs(step-6): server-driven UI BUILT & browser-verified (As-built); next = step 7"
```

---

## Self-Review notes (spec coverage)

- S1 (lift delivery → core) = Task 1. S2 (`/api/deliver`) = Task 2. S3 (promote `/api/dispatch`) = Task 2. Server CopilotKit removal = Task 3.
- C1 hooks = Tasks 6/7/8. C2 (board→pipeline/status) = Tasks 4/5 + Task 11. C3 (local renderToolCall) = Tasks 10/12. C4 (gate-driven approval) = Tasks 9/12. C5 (handoff notes from topology) = Task 13.
- D (deletions) = Tasks 3/14/16. Browser DoD = Task 15. BUILT marker = Task 17.
- Open item flagged for the executor: **reload-mid-run requires persisting `openId` in the URL** (Task 12/15 step 6) — the spike used `?spike=1&id=`; replicate with a `?open=<id>` query param so a reload re-attaches.
- Risk carried: the `aggregate`/`pipelineModel` pure models are REUSED unchanged — if a test breaks, the board→PInstance mapping (Task 5) is the suspect, not the models.
