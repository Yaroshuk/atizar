# Instance Model (Pass 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the board draw **one card per Agent** with its Runs **grouped by a caller-supplied `key`** (the Instance), so a singleton stops showing two cards, a server restart collapses orphan+new into one card, and START becomes a safe re-scan instead of a destructive wipe+confirm.

**Architecture:** A new **required `key` column** on `work_items` is set at dispatch by the app (never inferred by the framework). The framework stores it and the client view groups Runs by `(agentId, key)` into Instances. START of an input agent reverts from *wipe-on-START* to *supersede-the-prior-finished-scan + one-live-scan gate* (both helpers already exist in `stateStore`). `maxInstances` loses every identity/singleton role and stays only as the worker-pool concurrency throttle.

**Tech Stack:** TypeScript, yarn-classic workspace, Postgres + drizzle-orm (`@atizar/server`), React (`@atizar/react`), Hono routes, vitest. Spec: `docs/superpowers/specs/2026-06-16-instance-model.md`.

---

## Planning decisions (made while reading the live code — confirm at plan review)

1. **`key` is set via a single app-supplied resolver `instanceKeyOf(agentId, payload) => string`**, injected into `makePipelineService` (a **required** dep — no framework default, honoring "key is required, the app decides"). Both dispatch entry points (`pipelineService.dispatch` for human START and `deliverImpl` for machine/card dispatch) call it. The email-inbox policy: `reply → payload.email.from`; `reader/spam/important → the stripped agent id` (constant); `sorter → the stripped agent id` (constant). It is **workflow/app wiring**, never a field on `defineAgent` (the spec's "agent declares nothing about keying" holds).
2. **No origin-based `covers` bypass.** The input scan carries **no `source`** (empty START payload), so `covers`/dedup never gates it already. The scan re-trigger is controlled purely by **supersede-prior-finished-scan + the one-live-scan gate** — both already in `stateStore` (`getFinishedInputRoots`, `hasLiveInputScan`). This drops the spec's defensive origin-bypass as unnecessary.
3. **`key` does not change dedup.** Dedup stays by `source` + `lifecycle().covers` exactly as today. `key` is purely an **identity/grouping label** stored on the row and consumed by the client view (and by supersede-scoping). This bounds the blast radius.
4. **Dev DB is reset** (data disposable, no prod). The `key` column is added `NOT NULL` with no backfill — a fresh DB starts clean.

---

## Two invariants this plan MUST hold (read before every task)

**1. Framework vs app separation.** Generic dispatch/identity *mechanism* lives in the framework
(`@atizar/server`, `@atizar/react`); only the *policy* (what key a given workflow assigns) lives in
the app.
- **Framework:** the `key` column, threading it through dispatch/store, the supersede-prior +
  one-live-scan re-scan semantics, grouping Runs by `(agentId, key)` in the view. Every workflow
  gets these for free.
- **App (apps/inbox):** the `instanceKeyOf` body (reply→sender, batch/sorter→constant). It is passed
  IN to the framework, never hardcoded inside it. If you find yourself writing `'reply'` or
  `'sorter'` inside `@atizar/server` or `@atizar/react` — stop, it belongs in the app.

**2. Single source of truth (the bug class that bit us before — agent state computed in N places).**
- **Identity** has exactly ONE source: the stored `key`. Nothing re-derives "which Runs are one
  instance" any other way. The whole point of this change is to delete the *second* identity
  derivation (one-card-per-Run in the view).
- **Status priority** has exactly ONE source: `PRIORITY` in `aggregate.ts`. `pickHead` (instance
  head) and `aggregateAgent` (agent card) both consume it — never a copy (see Task C2).
- **Liveness** has ONE source: core `hasLiveDescendant` / `lifecycle()`. Do NOT add a new
  live-derivation. (`pipelineModel` already has a local live-descendant walk for the "Working"
  promotion — pre-existing; do not duplicate it further, and prefer the core walk if you touch it.)
- **Known coincidence to keep honest:** the re-scan helpers `getFinishedInputRoots` /
  `hasLiveInputScan` identify the input instance by `(workflowId, agentId)`. For an input agent the
  key IS constant (= the agent id), so this EQUALS `(agentId, key)` — they do not diverge. Acceptable
  for Pass 1; do not add a parallel key-based input-scan lookup that could drift from these.

---

## File structure

**`@atizar/server` (packages/server/src + db):**
- `db/schema.ts` — add `key text NOT NULL` to `workItems`.
- `db/migrations/*` — new drizzle migration for the column (generated).
- `stateStore.ts` — `InsertWorkItemInput.key`; thread into `insertWorkItem`; add `supersedePriorScan` helper usage is via existing `getFinishedInputRoots`.
- `dispatch.ts` — `DispatchInput.key` (required); store it on insert.
- `pipelineService.ts` — inject `instanceKeyOf`; compute `key` for human START + delivery; **remove wipe-on-START**, restore supersede-prior + live-gate; `reenqueue`/boot carry `key` (already on the row, no change).
- `createServer.ts` — accept + pass `instanceKeyOf`.
- `routes.ts` — `/api/dispatch` unchanged (key is computed server-side, not sent by the client).

**`@atizar/core` (packages/core/src):** *no change* (lifecycle/`covers` untouched — "no protected-core surgery").

**App (apps/inbox):**
- `server/workflows.ts` (or `createServer` call site) — supply the email-inbox `instanceKeyOf`.

**`@atizar/react` (packages/react/src):**
- `serverTypes.ts` — `WorkItem.key`.
- `boardModel.ts` — carry `key` onto `PInstance`.
- `pipelineModel.ts` — group Runs by `(agentId, key)` into Instances; emit one node per instance.
- `hooks/useBoardNavigation.ts` — `openAgent` never opens a per-Run picker for one agent; **delete** `startOver`/`hasLiveScan`/`isSingletonInput`/`confirmStartOver`/`cancelStartOver`; `startInput` → plain `doStart`.
- Components consuming the deleted Start-over confirm + the new instance shape (read them at execution; mechanical glue).

---

## Phase A — `key` column + plumbing (server)

### Task A1: Add the `key` column to the schema

**Files:**
- Modify: `packages/server/src/db/schema.ts:52-71`
- Generate: `packages/server/src/db/migrations/<n>_*.sql` (drizzle-kit)

- [ ] **Step 1: Add the column to the drizzle table**

In `packages/server/src/db/schema.ts`, inside `workItems`, add directly under `source`:

```ts
  // Dedup key (deliveryKey-style); null ⇒ never deduped.
  source: text('source'),
  // Instance identity (spec 2026-06-16). Caller-supplied at dispatch; same key → same instance.
  // NOT derivable from `source` (reply: key=sender, source=email; spam: key='spam', source=email).
  key: text('key').notNull(),
```

- [ ] **Step 2: Generate the migration**

Run (drizzle-kit reads `schema.ts`):
```bash
yarn workspace @atizar/server drizzle-kit generate
```
Expected: a new SQL file under `packages/server/src/db/migrations/` adding `key` to `work_items`. If `key NOT NULL` on an existing table fails to generate cleanly, that is fine — we reset the dev DB in Step 3.

- [ ] **Step 3: Reset the dev DB and apply migrations**

Run (recreates the dev schema — data is disposable):
```bash
yarn workspace @atizar/server drizzle-kit push
```
Expected: schema applied, `work_items.key` present. Verify:
```bash
psql "$DATABASE_URL" -c '\d work_items' | grep key
```
Expected: a `key | text | not null` row.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/db/schema.ts packages/server/src/db/migrations
git commit -m "feat(server): add required key column to work_items"
```

---

### Task A2: Thread `key` through the store insert + dispatch chokepoint

**Files:**
- Modify: `packages/server/src/stateStore.ts:19-63`
- Modify: `packages/server/src/dispatch.ts:22-103`
- Test: `packages/server/src/dispatch.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/server/src/dispatch.test.ts` inside the `describe.skipIf(!reachable)` block (mirror the existing `base`/`fakePool` harness at the top of the file; note `base` must now include `key`):

```ts
it('stores the caller-supplied key on the work item', async () => {
  const { pool } = fakePool()
  const { id } = await dispatch(db, pool, { ...base, key: 'alice@example.com' })
  expect((await store.getWorkItem(id))?.key).toBe('alice@example.com')
})
```

Also update the shared `base` literal at the top of the file to add `key`:
```ts
const base = {
  workflowId: 'lead-inbox',
  agentId: 'lead-inbox__reply',
  origin: 'human' as const,
  payload: {},
  maxInstances: 2,
  key: 'lead-inbox__reply',
}
```

- [ ] **Step 2: Run it — expect a TYPE error then a failure**

Run:
```bash
yarn workspace @atizar/server vitest run src/dispatch.test.ts -c ../../vitest.config.ts
```
Expected: FAIL — `key` is not a property of `DispatchInput` (TS) / the column write is missing.

- [ ] **Step 3: Add `key` to `DispatchInput` and the insert**

In `packages/server/src/dispatch.ts`, add to the interface (after `source`):
```ts
export interface DispatchInput {
  workflowId: string
  agentId: string
  origin: OriginKind
  payload: Record<string, unknown>
  source?: string | null
  key: string
  parentId?: string | null
  maxInstances: number
}
```
And in the insert (the `tx.insert(workItems).values({...})` block), add `key`:
```ts
    await tx.insert(workItems).values({
      id,
      workflowId: input.workflowId,
      agentId: input.agentId,
      origin: input.origin,
      payload: input.payload,
      source: input.source ?? null,
      key: input.key,
      parentId: input.parentId ?? null,
      phase: 'queued',
      outcome: 'running',
    })
```

- [ ] **Step 4: Mirror `key` in the store's typed insert (used by the boot sweep / any direct insert)**

In `packages/server/src/stateStore.ts`, add to `InsertWorkItemInput` (after `source`):
```ts
  source?: string | null
  key: string
```
And in `insertWorkItem`'s `.values({...})` add `key: input.key,` next to `source`.

- [ ] **Step 5: Run the test — expect PASS**

Run:
```bash
yarn workspace @atizar/server vitest run src/dispatch.test.ts -c ../../vitest.config.ts
```
Expected: PASS (all dispatch tests, including the new one).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/dispatch.ts packages/server/src/stateStore.ts packages/server/src/dispatch.test.ts
git commit -m "feat(server): thread required key through dispatch + store insert"
```

---

### Task A3: Inject `instanceKeyOf` and compute `key` at both dispatch entry points

**Files:**
- Modify: `packages/server/src/pipelineService.ts:42-98, 248-275`
- Modify: `packages/server/src/createServer.ts` (read live — add an `instanceKeyOf` option, pass it through)
- Modify: `apps/inbox/server/workflows.ts` or the `createServer(...)` call site (read live — supply the email-inbox policy)
- Test: `packages/server/src/pipelineService.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/server/src/pipelineService.test.ts` (mirror its existing `makePipelineService` setup; supply the new required dep). Assert that a human START stamps the resolver's key:

```ts
it('stamps the instanceKeyOf result on a human START', async () => {
  const keys: Record<string, string> = { 'wf__sorter': 'wf__sorter' }
  const service = makePipelineService({
    ...baseDeps, // the test file's existing deps object
    instanceKeyOf: (agentId) => keys[agentId] ?? agentId,
  })
  const { id } = await service.dispatch({
    workflowId: 'wf',
    agentId: 'wf__sorter',
    origin: 'human',
    payload: {},
  })
  expect((await store.getWorkItem(id))?.key).toBe('wf__sorter')
})
```

- [ ] **Step 2: Run it — expect FAIL**

Run:
```bash
yarn workspace @atizar/server vitest run src/pipelineService.test.ts -c ../../vitest.config.ts
```
Expected: FAIL — `instanceKeyOf` is not a known dep / `key` is undefined on insert.

- [ ] **Step 3: Add the required dep and use it**

In `packages/server/src/pipelineService.ts`, add to `PipelineServiceDeps`:
```ts
export interface PipelineServiceDeps {
  db: Db
  resolveAgent: (agentId: string) => AgentRuntime | undefined
  descriptors: WorkflowDescriptor[]
  // The app's instance-key policy (spec 2026-06-16). REQUIRED — the framework never invents a key.
  // Same key → same instance. e.g. reply → payload.email.from; spam/sorter → the agent id.
  instanceKeyOf: (agentId: string, payload: Record<string, unknown>) => string
  getAgentHealth?: () => Record<string, HealthCheck>
  refreshHealth?: () => Promise<Record<string, HealthCheck>>
}
```
In `deliverImpl`, compute the key alongside `source` and pass it to the chokepoint:
```ts
    const result = await dispatchChokepoint(db, pool, {
      workflowId: workflowId ?? r.instanceId,
      agentId: r.instanceId,
      origin: 'agent',
      payload: req.payload,
      source: deliveryKey(req.payload) ?? null,
      key: deps.instanceKeyOf(r.instanceId, req.payload),
      parentId: req.parentId,
      maxInstances,
    })
```
In the public `dispatch(req)` method, compute the key for the human START path:
```ts
      const result = await dispatchChokepoint(db, pool, {
        ...req,
        key: deps.instanceKeyOf(req.agentId, req.payload),
        maxInstances,
      })
```

- [ ] **Step 4: Wire `instanceKeyOf` through `createServer` and supply the app policy**

Read `packages/server/src/createServer.ts` live (it builds `runtimes` from defs ~line 114 and constructs the pipeline service ~line 159). Add an `instanceKeyOf` option to its public options type and pass it into `makePipelineService({ ..., instanceKeyOf })`.

Read the app's `createServer(...)` call site (`apps/inbox/server/workflows.ts` or `index.ts`) and supply the email-inbox policy (the agent ids are `wf__sorter`, `wf__reply`, `wf__reader`, `wf__spam`, `wf__important` — strip the `wf__` prefix to branch):
```ts
instanceKeyOf: (agentId, payload) => {
  const bare = agentId.includes('__') ? agentId.slice(agentId.indexOf('__') + 2) : agentId
  if (bare === 'reply') {
    const email = (payload as { email?: { from?: string } }).email
    return email?.from ?? agentId // a malformed reply payload falls back to one instance per agent
  }
  return agentId // sorter + batch agents (reader/spam/important) = one constant instance each
}
```

- [ ] **Step 5: Update every other `makePipelineService` / `createServer` caller to supply the dep**

Run a search and add a trivial `instanceKeyOf: (agentId) => agentId` to any test/helper that constructs the service without it:
```bash
grep -rln "makePipelineService(" packages/server/src
```
Expected: each match compiles after adding the dep (tests can use the identity resolver).

- [ ] **Step 6: Run typecheck + the service test — expect PASS**

Run:
```bash
yarn workspace @atizar/server vitest run src/pipelineService.test.ts -c ../../vitest.config.ts && yarn typecheck
```
Expected: PASS + clean typecheck.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/pipelineService.ts packages/server/src/createServer.ts apps/inbox/server packages/server/src/pipelineService.test.ts
git commit -m "feat(server): app-supplied instanceKeyOf sets the instance key at dispatch"
```

---

## Phase B — START = safe re-scan (server)

### Task B1: Replace wipe-on-START with supersede-prior + one-live-scan gate

**Files:**
- Modify: `packages/server/src/pipelineService.ts:248-275` (the `dispatch` method)
- Test: `packages/server/src/pipelineService.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/server/src/pipelineService.test.ts` (uses the existing harness + the `instanceKeyOf` dep from A3):

```ts
it('re-START does NOT wipe sibling worker runs (no wipe-on-START)', async () => {
  const service = makePipelineService({ ...baseDeps, instanceKeyOf: (a) => a })
  // a worker run already on the board (a draft awaiting approval)
  const draft = await service.dispatch({
    workflowId: 'wf', agentId: 'wf__reply', origin: 'agent', payload: {},
  })
  await service.dispatch({ workflowId: 'wf', agentId: 'wf__sorter', origin: 'human', payload: {} })
  // the worker run is untouched (NOT cancelled/reset by the re-START)
  expect((await store.getWorkItem(draft.id))?.outcome).not.toBe('stopped')
  expect((await store.getWorkItem(draft.id))?.outcome).not.toBe('reset')
})

it('a fresh input START supersedes the prior FINISHED scan root', async () => {
  const service = makePipelineService({ ...baseDeps, instanceKeyOf: (a) => a })
  const first = await service.dispatch({
    workflowId: 'wf', agentId: 'wf__sorter', origin: 'human', payload: {},
  })
  // drive the first scan to a clean finish (helper in the test file, or transition start→finish)
  await transition(db, first.id, 'start')
  await settleEdge(first.id, 'finish', null) // the test file's settle binding
  const second = await service.dispatch({
    workflowId: 'wf', agentId: 'wf__sorter', origin: 'human', payload: {},
  })
  expect(second.id).not.toBe(first.id)
  expect((await store.getWorkItem(first.id))?.outcome).toBe('superseded')
})

it('a second START while a scan is LIVE returns the live scan (no second scan)', async () => {
  const service = makePipelineService({ ...baseDeps, instanceKeyOf: (a) => a })
  const first = await service.dispatch({
    workflowId: 'wf', agentId: 'wf__sorter', origin: 'human', payload: {},
  })
  await transition(db, first.id, 'start') // now active = a live scan
  const second = await service.dispatch({
    workflowId: 'wf', agentId: 'wf__sorter', origin: 'human', payload: {},
  })
  expect(second.id).toBe(first.id)
  expect(second.deduped).toBe(true)
})
```

- [ ] **Step 2: Run — expect FAIL**

Run:
```bash
yarn workspace @atizar/server vitest run src/pipelineService.test.ts -c ../../vitest.config.ts
```
Expected: FAIL — current code wipes on START (first test fails) and has no supersede/live-gate.

- [ ] **Step 3: Rewrite the human-START branch in `dispatch`**

In `packages/server/src/pipelineService.ts`, replace the wipe block (currently `if (req.origin === 'human' && isInputAgent(req.agentId)) { await wipeWorkflowImpl(req.workflowId) }`) with the supersede + live-gate path:

```ts
    async dispatch(req: DispatchRequest): Promise<DispatchResult> {
      const runtime = deps.resolveAgent(req.agentId)
      const maxInstances = runtime?.maxInstances ?? 1
      // START = safe re-scan (spec 2026-06-16). A human re-START of an input agent:
      //  1. if a scan is already LIVE, do not start a second — return the live scan (one-open).
      //  2. otherwise supersede the prior FINISHED scan root(s) so only the latest scan shows
      //     (reuse-on-closed), then dispatch a fresh scan Run. Worker runs are NEVER touched.
      // No wipe, no confirm modal. (The wipeWorkflow primitive stays — it backs the Clear button.)
      if (req.origin === 'human' && isInputAgent(req.agentId)) {
        if (await store.hasLiveInputScan(req.workflowId, req.agentId)) {
          const live = (await store.getActiveByWorkflow(req.workflowId)).find(
            (w) => w.agentId === req.agentId && !w.parentId
          )
          if (live) return { id: live.id, deduped: true }
        }
        const prior = await store.getFinishedInputRoots(req.workflowId, req.agentId)
        for (const root of prior) {
          await settleEdge(root.id, 'supersede', null, { summary: 'superseded by re-scan' }).catch(
            () => {}
          )
        }
      }
      const result = await dispatchChokepoint(db, pool, {
        ...req,
        key: deps.instanceKeyOf(req.agentId, req.payload),
        maxInstances,
      })
      activity.record({
        ts: Date.now(),
        workflowId: req.workflowId,
        agentId: req.agentId,
        workItemId: result.id,
        kind: 'queued',
        summary: req.origin === 'human' ? `START ${req.agentId}` : `dispatched ${req.agentId}`,
      })
      publishBoard()
      return result
    },
```

(Note: `getActiveByWorkflow` returns only live items; the parentless one of this agent is the live scan root. `hasLiveInputScan` + `getFinishedInputRoots` already exist in `stateStore`.)

- [ ] **Step 4: Run — expect PASS**

Run:
```bash
yarn workspace @atizar/server vitest run src/pipelineService.test.ts -c ../../vitest.config.ts
```
Expected: PASS (all three new tests + the existing suite).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/pipelineService.ts packages/server/src/pipelineService.test.ts
git commit -m "feat(server): START = supersede-prior-scan + one-live-gate (drop wipe-on-START)"
```

---

### Task B2: Stop a whole instance (server `cancelInstance`)

**Decision:** the unit of Stop becomes the **instance**. **Stopping any instance stops that instance
AND every instance it spawned, transitively** — a general rule for any spawning instance, not a
special case for inbox. Mechanically: cancel every live Run sharing the instance's
`(workflowId, agentId, key)`; the existing `cancelItem` cascade then walks each Run's descendants, so
the whole spawned subtree stops for free. Per-Run cancel and per-workflow cancel stay as-is.

**Files:**
- Modify: `packages/server/src/pipelineService.ts` (add `cancelInstance`, reusing `cancelItem`)
- Modify: `packages/server/src/routes.ts` (a `POST /api/instances/cancel` route)
- Modify: `packages/react/src/hooks/useDispatch.ts` (a `cancelInstance` mutation)
- Test: `packages/server/src/pipelineService.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/server/src/pipelineService.test.ts`:
```ts
it('cancelInstance stops every live Run of one (agentId, key) + cascades to children', async () => {
  const service = makePipelineService({ ...baseDeps, instanceKeyOf: (a, p) => (p as any).k ?? a })
  // two reply Runs for the SAME sender key 'alice', each active
  const r1 = await service.dispatch({ workflowId: 'wf', agentId: 'wf__reply', origin: 'agent', payload: { k: 'alice' } })
  const r2 = await service.dispatch({ workflowId: 'wf', agentId: 'wf__reply', origin: 'agent', payload: { k: 'alice' } })
  await transition(db, r1.id, 'start')
  await transition(db, r2.id, 'start')
  await service.cancelInstance('wf', 'wf__reply', 'alice')
  expect((await store.getWorkItem(r1.id))?.outcome).toBe('stopped')
  expect((await store.getWorkItem(r2.id))?.outcome).toBe('stopped')
})
```

- [ ] **Step 2: Run — expect FAIL**

Run:
```bash
yarn workspace @atizar/server vitest run src/pipelineService.test.ts -c ../../vitest.config.ts
```
Expected: FAIL — `cancelInstance` does not exist.

- [ ] **Step 3: Implement `cancelInstance` (reuse `cancelItem`)**

In `packages/server/src/pipelineService.ts`, add a method to the returned object (it reuses the
tested per-Run cascade — single source for the cancel logic):
```ts
    // Stop a whole instance: cancel every LIVE Run sharing (workflowId, agentId, key). Each
    // cancelItem cascades to that Run's descendants, so stopping ANY spawning instance stops every
    // instance it spawned, transitively. Reuses the ONE cancel primitive (no duplicated cascade).
    async cancelInstance(workflowId: string, agentId: string, key: string): Promise<void> {
      const snap = await store.getBoardSnapshot()
      const live = snap.items.filter(
        (w) =>
          w.workflowId === workflowId &&
          w.agentId === agentId &&
          w.key === key &&
          lifecycle(w.phase, w.outcome, false, false).isLive
      )
      for (const w of live.sort((a, b) => a.id.localeCompare(b.id))) await cancelItem(w.id)
    },
```

- [ ] **Step 4: Add the route + client mutation**

In `packages/server/src/routes.ts`:
```ts
  app.post('/api/instances/cancel', async (c) => {
    const { workflowId, agentId, key } = await c.req.json<{
      workflowId: string; agentId: string; key: string
    }>()
    await service.cancelInstance(workflowId, agentId, key)
    return c.json({ ok: true })
  })
```
In `packages/react/src/hooks/useDispatch.ts`, add (mirroring the other POST mutations):
```ts
  const cancelInstance = useCallback(
    async (workflowId: string, agentId: string, key: string): Promise<void> => {
      await fetch('/api/instances/cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders(authToken) },
        body: JSON.stringify({ workflowId, agentId, key }),
      })
    },
    [authToken]
  )
```
and return it from the hook. Wire the instance's Stop button (read the instance/agent modal
component live) to call `cancelInstance(workflowId, instance.agentId, instance.key)`. Note: the
client must pass the **runtime** agent id (`wf__reply`), which is `PInstance.runtimeKey`.

- [ ] **Step 5: Run + typecheck — expect PASS**

Run:
```bash
yarn workspace @atizar/server vitest run src/pipelineService.test.ts -c ../../vitest.config.ts && yarn typecheck
```
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/pipelineService.ts packages/server/src/routes.ts packages/react/src/hooks/useDispatch.ts packages/server/src/pipelineService.test.ts
git commit -m "feat: Stop a whole instance (cancelInstance) — cascades to children"
```

---

## Phase C — View: one card per Agent, Runs grouped by key (client)

### Task C1: Carry `key` onto the client `WorkItem` + `PInstance`

**Files:**
- Modify: `packages/react/src/serverTypes.ts` (find the `WorkItem` type)
- Modify: `packages/react/src/boardModel.ts:33-45`
- Modify: `packages/react/src/pipelineModel.ts:5-16`
- Test: `packages/react/src/boardModel.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/react/src/boardModel.test.ts` (mirror its existing `toPInstances` fixtures — a `WorkItem` factory; add `key`):

```ts
it('carries the work item key onto the PInstance', () => {
  const items = [makeItem({ id: 'r1', agentId: 'wf__reply', key: 'alice@x.com' })]
  const [p] = toPInstances(items, 'wf', roleOf, metaIcon, nameOf, labelOf)
  expect(p.key).toBe('alice@x.com')
})
```

- [ ] **Step 2: Run — expect FAIL**

Run:
```bash
yarn workspace @atizar/react vitest run src/boardModel.test.ts -c ../../vitest.config.ts
```
Expected: FAIL — `key` missing on `WorkItem`/`PInstance`.

- [ ] **Step 3: Add `key` to the types and map it**

In `packages/react/src/serverTypes.ts`, add `key: string` to the `WorkItem` type (next to `source`).
In `packages/react/src/pipelineModel.ts`, add to `PInstance`:
```ts
export type PInstance = {
  localId: string
  runtimeKey: string
  agentId: string
  key: string
  name: string
  ...
}
```
In `packages/react/src/boardModel.ts` `toPInstances`, add `key: w.key,` to the mapped object.

- [ ] **Step 4: Run — expect PASS**

Run:
```bash
yarn workspace @atizar/react vitest run src/boardModel.test.ts -c ../../vitest.config.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/serverTypes.ts packages/react/src/boardModel.ts packages/react/src/pipelineModel.ts packages/react/src/boardModel.test.ts
git commit -m "feat(react): carry instance key onto PInstance"
```

---

### Task C2: Group Runs by `(agentId, key)` into Instances in `buildPipeline`

**Files:**
- Modify: `packages/react/src/pipelineModel.ts:18-123`
- Test: `packages/react/src/pipelineModel.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/react/src/pipelineModel.test.ts` (mirror its `PInstance` fixtures):

```ts
it('collapses two Runs sharing (agentId, key) into ONE instance node', () => {
  const sorter = mk({ localId: 's', agentId: 'sorter', key: 'sorter', isInput: true })
  const r1 = mk({ localId: 'r1', agentId: 'reply', key: 'alice', parentLocalId: 's' })
  const r2 = mk({ localId: 'r2', agentId: 'reply', key: 'alice', parentLocalId: 's' })
  const [block] = buildPipeline([sorter, r1, r2], {})
  const replyGroup = block.groups.find((g) => g.agentId === 'reply')!
  expect(replyGroup.instances).toHaveLength(1) // one instance for sender 'alice'
  expect(replyGroup.instances[0].runs).toHaveLength(2) // two Runs under it
})

it('keeps two different keys as two instances', () => {
  const sorter = mk({ localId: 's', agentId: 'sorter', key: 'sorter', isInput: true })
  const a = mk({ localId: 'a', agentId: 'reply', key: 'alice', parentLocalId: 's' })
  const b = mk({ localId: 'b', agentId: 'reply', key: 'bob', parentLocalId: 's' })
  const [block] = buildPipeline([sorter, a, b], {})
  expect(block.groups.find((g) => g.agentId === 'reply')!.instances).toHaveLength(2)
})

it('two scan Runs of the input agent (same key) collapse to one instance', () => {
  const s1 = mk({ localId: 's1', agentId: 'sorter', key: 'sorter', isInput: true, status: 'running' })
  const s2 = mk({ localId: 's2', agentId: 'sorter', key: 'sorter', isInput: true, status: 'running' })
  const blocks = buildPipeline([s1, s2], {})
  expect(blocks).toHaveLength(1) // one card, not two
})
```

- [ ] **Step 2: Run — expect FAIL**

Run:
```bash
yarn workspace @atizar/react vitest run src/pipelineModel.test.ts -c ../../vitest.config.ts
```
Expected: FAIL — `AgentGroup.instances` is still per-Run and has no `.runs`.

- [ ] **Step 3: Introduce the `Instance` type and group by key**

In `packages/react/src/pipelineModel.ts`, change the group model so an `AgentGroup` holds **Instances**, each bundling its Runs:

```ts
export type Instance = {
  agentId: string
  key: string
  runs: PInstance[] // ≥1 Run, all sharing (agentId, key); newest last
  head: PInstance // the Run whose status represents the instance (worst-meaningful — see below)
}

export type AgentGroup = {
  agentId: string
  name: string
  iconName: IconName
  instances: Instance[] // ≥1 instance, all the same agentId
  queued: number
}
```

Replace the per-child push in `buildPipeline` (the `groups.get(k.agentId)!.instances.push(view(k))` line) with a key-grouping step. After collecting the shown `kids` for a parent, build instances:

```ts
    // group children by agentId, then by key into instances (spec 2026-06-16)
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
      const g = groups.get(k.agentId)!
      const inst = g.instances.find((i) => i.key === k.key)
      const run = view(k)
      if (inst) {
        inst.runs.push(run)
        inst.head = pickHead(inst.runs)
      } else {
        g.instances.push({ agentId: k.agentId, key: k.key, runs: [run], head: run })
      }
      if ((childrenOf.get(k.localId) ?? []).some(isShownChild)) queue.push(k)
    }
```

Add `pickHead` — **reuse the ONE priority list** from `aggregate.ts` (single source of truth; do NOT redeclare it here). First export it from `aggregate.ts`:
```ts
// aggregate.ts — promote PRIORITY from a private const to an export (the ONE status-priority order).
export const PRIORITY: Status[] = ['awaiting_approval', 'error', 'running', 'done', 'idle']
```
Then in `pipelineModel.ts` import and use it:
```ts
import { PRIORITY } from './aggregate'

// The Run whose status represents the instance: worst-meaningful first (an awaiting approval must
// surface over a finished Run). Uses the SAME PRIORITY order as the agent aggregate — one source.
const pickHead = (runs: PInstance[]): PInstance =>
  PRIORITY.map((s) => runs.find((r) => r.status === s)).find(Boolean) ?? runs[runs.length - 1]
```

For the **root** blocks (the input scan): the roots loop currently emits one block per root PInstance. Collapse roots sharing `(agentId, key)` too — emit one block per distinct root instance, its `parent` being the `pickHead` of that instance's root Runs. Replace the `roots` derivation + block loop head so a root key appears once:

```ts
  // distinct root instances (collapse same-(agentId,key) roots — e.g. orphan+new scan after a
  // restart become ONE card). Keep first-seen order.
  const rootRuns = instances.filter((x) => shown.has(x.localId) && (x.isInput || !x.parentLocalId))
  const rootInstances: PInstance[] = []
  const seenRoot = new Set<string>()
  for (const r of rootRuns) {
    const ik = `${r.agentId} ${r.key}`
    if (seenRoot.has(ik)) continue
    seenRoot.add(ik)
    rootInstances.push(pickHead(rootRuns.filter((x) => x.agentId === r.agentId && x.key === r.key)))
  }
```
and seed `const queue = [...rootInstances]` (instead of `[...roots]`). Keep `emitted` keyed by `localId` of the chosen head; a same-instance root won't re-enter because `seenRoot` deduped it.

- [ ] **Step 4: Run — expect PASS**

Run:
```bash
yarn workspace @atizar/react vitest run src/pipelineModel.test.ts -c ../../vitest.config.ts
```
Expected: PASS (the three new tests + the existing suite — fix any existing test that asserted the old per-Run `instances` shape by reading `.instances[i].runs`).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/pipelineModel.ts packages/react/src/pipelineModel.test.ts
git commit -m "feat(react): group Runs by (agentId, key) into instances in the pipeline model"
```

---

### Task C3: Render the grouped instances (component glue)

**Files:**
- Modify: the pipeline column component that consumes `AgentGroup.instances` (read live: search below)
- Test: existing component/render tests if present; otherwise rely on browser-verify in Phase D

- [ ] **Step 1: Locate the consumers of the old shape**

Run:
```bash
grep -rln "\.instances" packages/react/src/components apps/inbox/client/src
```
Expected: the pipeline column / agent group components that iterate `group.instances`.

- [ ] **Step 2: Adapt each consumer to the Instance shape**

For each consumer: where it previously rendered one row per `PInstance`, render one row per **`Instance`** using `instance.head` for the status/label and `instance.runs` for the nested Run list / result cards. An instance with `runs.length > 1` shows the nested Runs with the existing L-connector treatment; `runs.length === 1` renders as today. Keep the `queued: N` line per agent group. (This is mechanical JSX over the new fields — no new logic.)

- [ ] **Step 3: Typecheck**

Run:
```bash
yarn typecheck
```
Expected: clean (every `.instances[i]` access now goes through `.head` / `.runs`).

- [ ] **Step 4: Commit**

```bash
git add packages/react/src packages/inbox 2>/dev/null; git add apps/inbox/client/src
git commit -m "feat(react): render grouped instances (head status + nested runs)"
```

---

### Task C4: Navigation by INSTANCE (variant B); delete the Start-over confirm

**Decision (variant B):** clicking an agent card with several instances shows a **list of instances**
(by `key` — e.g. one row per sender), and selecting one opens that instance's content. This is NOT
the forbidden "picker of agent copies" — the rows are distinct instances. A singleton (one constant
key) always has exactly one instance, so it opens directly, never a list.

**Files:**
- Modify: `packages/react/src/hooks/useBoardNavigation.ts:33-121, 162-189`
- Modify: the component(s) rendering the Start-over confirm modal + the instance list/picker (read live)
- Test: add a focused test for `openAgent` if `useBoardNavigation` has a test; else cover via browser-verify

- [ ] **Step 1: Simplify `startInput` and delete the confirm machinery**

In `packages/react/src/hooks/useBoardNavigation.ts`:
- Delete `startOver` state, `hasLiveScan`, the `isSingletonInput` branch, `confirmStartOver`, `cancelStartOver`.
- Reduce `startInput` to a direct dispatch:
```ts
  // START = a plain dispatch. The server handles re-scan safety (supersede-prior + one-live gate);
  // no client-side wipe confirm. (Clear stays separate, via useResetController.)
  const startInput = (agentDef: AgentDefinition): void => doStart(agentDef)
```
- Remove `startOver`, `confirmStartOver`, `cancelStartOver` from the returned object.

- [ ] **Step 2: Make `openAgent` count INSTANCES (by key), not Runs**

Derive the agent's distinct instances from `liveOf(agentId)` (the visible PInstances) by `key`, and
branch 0 / 1 / ≥2 on instance count:
```ts
  // distinct visible instances of an agent = unique keys among its shown Runs.
  const instancesOf = (agentId: string): string[] =>
    [...new Set(liveOf(agentId).map((p) => p.key))]

  const openAgent = (agentId: string): void => {
    setOpenTypeId(null)
    setOpenPickerId(null)
    setOpenId(null)
    const keys = instancesOf(agentId)
    if (keys.length === 0) setOpenTypeId(agentId)            // intro (+ START for input)
    else if (keys.length === 1) setOpenId(agentId)           // open the single instance directly
    else setOpenPickerId(agentId)                            // ≥2 → instance list (variant B)
  }
```
`pickerInstances` now resolves to the **instance list** (one entry per key, represented by its head
Run): read the picker component live and feed it `liveOf(openPickerId)` grouped by key (reuse the
`buildPipeline` instance shape or a small local group-by-key). Selecting a row opens that instance.

- [ ] **Step 3: Delete the Start-over confirm modal usage**

Run:
```bash
grep -rln "startOver\|confirmStartOver\|cancelStartOver" packages/react/src apps/inbox/client/src
```
Remove the confirm-modal JSX + props from each match. Keep the `useResetController` Clear-confirm modal untouched.

- [ ] **Step 4: Typecheck + lint**

Run:
```bash
yarn typecheck && yarn lint
```
Expected: clean — no dangling references to the deleted symbols.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src apps/inbox/client/src
git commit -m "feat(react): START dispatches directly; open by instance, list when ≥2 (variant B)"
```

---

## Phase D — Green gate + browser verification

### Task D1: Full green gate + react build

- [ ] **Step 1: Run the whole gate from repo root**

Run:
```bash
yarn typecheck && yarn test && yarn lint && yarn format:check && yarn workspace @atizar/react build
```
Expected: all green. Fix any drift (e.g. a stale test asserting the old per-Run group shape, or a caller missing `instanceKeyOf`) before proceeding.

- [ ] **Step 2: Run `check-foundation`**

This change touches the framework dispatch contract (`@atizar/server` dispatch chokepoint + a new required dep). Invoke the `check-foundation` skill and resolve any flagged tension before merge (expected: clean — no `@atizar/core` / provider / belief change; `key` is data, identity stays framework-owned).

- [ ] **Step 3: Commit any gate fixes**

```bash
git add -p
git commit -m "test: align suites with the instance-model grouping"
```

### Task D2: Browser-verify every user-visible flow

- [ ] **Step 1: Invoke the `browser-verify` skill** (dev-server hygiene + Playwright recovery live there).

- [ ] **Step 2: Verify the three target bugs are fixed, with `DEV_RECORD_REPLAY` as needed:**
  - **Singleton one card:** START the sorter twice (let the first finish) → the board shows **one** sorter card, not two; the prior scan is gone (superseded), the latest shows.
  - **Safe re-scan, no wipe/modal:** with a reply draft awaiting approval, press START again → **no confirm modal**, the draft is **still there**, only new emails get new Runs.
  - **Reply grouping by sender:** two emails from the same sender → **one** reply instance with **two** Run rows; two senders → two instances.
  - **Restart collapse:** restart the server mid-scan → after the boot sweep the board shows **one** keyed instance per agent, no duplicate card.
  - **Navigation (variant B):** click a reply card with 2 senders → an **instance list** (Petya / Vasya); click one → its content. Click the sorter card (one instance) → opens directly, no list.
  - **Stop per instance:** Stop on any instance stops that instance AND every instance it spawned (transitively). Verify both: Stop a reply instance with a live draft → that instance stops; Stop a spawning instance (e.g. the sorter) → it and all instances it spawned stop.
  - **Clear still works:** the explicit Clear button still opens its confirm and wipes the board (the `wipeWorkflow` primitive is intact).

- [ ] **Step 3: Record the verification outcome** in the PR description (which flows were driven, replay vs record, screenshots if useful).

---

## Self-review notes (already reconciled)

- **Spec coverage:** keying (A1–A3) · dedup unchanged/by-source (Planning decision 3) · view card=agent + grouped Runs (C1–C3) · navigation by instance, list when ≥2 = variant B (C4) · START safe re-scan (B1) · Stop per instance + cascade (B2) · `maxInstances` identity stripped (C4 removes `isSingletonInput`/`hasLiveScan`; the pool throttle is untouched) · no protected-core surgery (core unchanged) · migration/dev-DB reset (A1). Bidirectional ask is **Pass 2** — out of scope here.
- **`maxInstances` throttle:** intentionally NOT removed from `dispatch`/`workerPool`/`runObserver` — it stays the concurrency cap. Only its client identity uses are deleted (C4).
- **Type consistency:** `key: string` is added to `DispatchInput`, `InsertWorkItemInput`, `WorkItem` (schema + client), and `PInstance`; `AgentGroup.instances` becomes `Instance[]` with `Instance.runs`/`Instance.head`; `instanceKeyOf` has one signature `(agentId, payload) => string` everywhere.
- **Separation honored:** no agent id literal appears inside `@atizar/server`/`@atizar/react`; the only policy (`instanceKeyOf` body) is in `apps/inbox` and injected.
- **Single source honored:** identity = the stored `key` (one place); status priority = `aggregate.PRIORITY` (exported, reused by `pickHead`); liveness = core `hasLiveDescendant`. The `(workflowId, agentId)` re-scan lookups equal `(agentId, key)` for input agents (noted, non-diverging).
- **Stale app comment:** `apps/inbox/workflows/email-inbox/descriptor.ts:41` (`// one reply instance per email`) should read "per sender" — fix it as part of Task A3's app edit.
