# Server spine on Postgres — design (beta build order step 3)

> Scope: the server-authoritative spine. Supersedes the step-2 spike's in-memory store
> (`apps/inbox/server/dev-runs.ts`) with a Postgres-backed pipeline. Locked architecture →
> `docs/pipeline-updated-3.md` (§ numbers below refer to it). Anticipated decisions already
> answered → `HANDOFF.md` ("Anticipated decisions, steps 3–7").
>
> **Out of scope (later steps, seams only here):** server-executed effects + ledger writes +
> `formRev` 409 + cancel/Stop + startup sweep (step 4); Mastra (step 5); UI re-point + delete
> `@copilotkit/*` (step 6). Step 3 keeps the spike's dev surface (`?spike=1` page + the
> trace/SSE endpoint shapes) as its verification harness and drives lead-inbox through the new
> Postgres spine.

## 1. Goal

One in-process server pipeline, backed by Postgres, that for **every** dispatch (browser or
not): mints a WorkItem, enqueues it under a per-agent concurrency cap, runs the provider while
appending a lossless Trace, opens a Gate + suspends on `GATE_OPENED`, resumes on resolve, and
finalizes status — all observable live (SSE) and after a `tsx watch` restart (durable rows).

## 2. Code layout (`apps/inbox/server/pipeline/`)

Package extraction (`@atizar/server`) is deferred (HANDOFF). Everything lives under
`apps/inbox/server/pipeline/`:

- `db/schema.ts` — drizzle table definitions (the only place DDL is expressed).
- `db/client.ts` — `postgres` (postgres.js) connection + drizzle instance from `DATABASE_URL`.
- `drizzle.config.ts` (repo-relative under `apps/inbox/`) + `db/migrations/` — drizzle-kit.
- `stateStore.ts` — typed CRUD over the tables; the ONLY module that touches drizzle queries
  (transition() is the sole writer of `work_items.status`).
- `transition.ts` — `transition(db, workItemId, edge)`: `BEGIN` → `SELECT … FOR UPDATE` (row,
  and parent for finish/reopen in ascending-id order) → guard → `UPDATE` → `COMMIT`.
- `dispatch.ts` — the one chokepoint: mint id, dedup by `source`, depth cap, insert `queued`,
  enqueue in the pool.
- `workerPool.ts` — per-agent cap + FIFO queue (pure logic ported from
  `client/src/instancesCore.ts`), drains on slot release.
- `runObserver.ts` — consumes `provider.run()` / `provider.resume()`; appends Trace; reacts to
  `GATE_OPENED` (insert Gate + `transition(awaiting_approval)` + kill) and to a registered
  render tool (fill `card`); finalizes status; republishes events on the bus.
- `eventBus.ts` — one in-process `EventEmitter`, topics `board` and `workitem:<id>`.
- `pipelineService.ts` — wires store + pool + observer; exposes `dispatch`, `resolveGate`
  (dev-grade: transition + resume, NO effect/ledger — that's step 4), `getTrace`, `getBoard`.
- `routes.ts` — Hono routes (below). Mounted from `server/index.ts` beside the CopilotKit
  endpoint (which stays the live surface until step 6).

## 3. Schema (Postgres, drizzle-kit migrated from the first table; §1.7)

`schema_meta` — `{ key text PK, value text }`; seed one row `schema_version = '1'` (the
app-readable version; drizzle-kit's own journal tracks migration application).

`work_items`:
| col | type | notes |
|---|---|---|
| `id` | uuid PK | `crypto.randomUUID()` minted at dispatch (NOT derived from model output) |
| `workflow_id` | text | |
| `agent_id` | text | the `wf__agent` instance id |
| `parent_id` | uuid null | self-FK; the dispatch tree |
| `origin` | text | `'human' \| 'agent' \| 'inbound'` (inbound reserved, no producer in beta) |
| `source` | text null | dedup key (deliveryKey-style); null ⇒ never deduped |
| `payload` | jsonb | the handoff payload / input seed |
| `status` | text | §5 union — see below |
| `resolution` | text null | `'cancelled' \| 'rejected'` marker (NOT a status) |
| `card` | jsonb null | filled by a registered render tool |
| `run_id` | text null | provider runId (the `workItemId ↔ runId` map, belief #2) |
| `error` | text null | finalize-on-error reason |
| `created_at` | timestamptz | `defaultNow()`; queue order |
| `updated_at` | timestamptz | bumped on each transition |

`status` allowed set (§5, stored as text — drizzle pgEnum):
`queued | running | awaiting_approval | awaiting_input | result | finished | error | closed`.
Step 3 WIRES only `queued → running → awaiting_approval → running → finished | error`; the rest
are defined for forward-compat (cancel/result/closed land in step 4 / P1).

`gates`:
| col | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `work_item_id` | uuid FK | |
| `kind` | text | `'approval'` (beta) |
| `status` | text | `'open' \| 'resolved'` |
| `form` | jsonb | editable artifact; seeded = `proposed_artifact` |
| `form_rev` | int | default 0 (step-4 optimistic-lock seam) |
| `proposed_artifact` | jsonb | kept alongside `form` for audit |
| `tool_name` | text | the approval tool |
| `tool_call_id` | text | correlates with TOOL_CALL_* |
| `comment` | text null | reject/feedback seed |
| `assignee` | text null | first multi-user primitive |
| `resolved_by` | text null | |
| `resolved_at` | timestamptz null | |
| `expires_at` | timestamptz null | badge only; never auto-resolves |
| `created_at` | timestamptz | |

`trace` — append-only, PK `(work_item_id, seq)`:
| col | type | notes |
|---|---|---|
| `work_item_id` | uuid | |
| `seq` | int | per-WorkItem monotonic; RunObserver is the single writer (no `max(seq)` race) |
| `event` | jsonb | the AG-UI `BaseEvent` |
| `surfaced` | boolean | default true; surfacing is a UI filter, recording is lossless |
| `created_at` | timestamptz | |

`action_ledger` — created now (HANDOFF: "from the very first table"), written at step 4:
| col | type | notes |
|---|---|---|
| `key` | text PK | `workItemId + ':' + gateId` |
| `work_item_id` | uuid | |
| `gate_id` | uuid | |
| `result` | jsonb null | the executed effect result (step 4) |
| `created_at` | timestamptz | |

## 4. transition() — guards (§1.2, §3.6)

`transition(db, id, edge)` runs in one tx: `SELECT … FOR UPDATE` the row (ascending-id lock of
the parent too when the edge can auto-finish the parent), check the edge is legal **from the
current status**, `UPDATE`, `COMMIT`. Illegal edge → throws `IllegalTransition` (no write). The
edge map (step 3 wired subset):

| edge | from | to | extra |
|---|---|---|---|
| `start` | `queued` | `running` | — |
| `gate` | `running` | `awaiting_approval` | — |
| `resume` | `awaiting_approval` | `running` | — |
| `finish` | `running` | `finished` | leaf→root auto-finish walk (parent FOR UPDATE) |
| `fail` | `running`, `awaiting_approval` | `error` | sets `error` col |

`finished` entry guard (invariant, checked on every inbound edge to a terminal state, once,
here): a parent may auto-finish only when it has **no active children** (`queued | running |
awaiting_approval | awaiting_input`). The auto-finish walk: on `finish`, if the item has a
`parent_id`, lock the parent (ascending id) and finish it too iff its other children are all
terminal — recurse to the root. Cancel edges + the full all-inbound-edges guard table land in
step 4; the guard *mechanism* is built here.

Race tests (real PG, CI): concurrent `finish`-vs-`finish` on two siblings (exactly one parent
auto-finish) and `finish`-vs-`dispatch` (a new child mid-finish keeps the parent active).

## 5. dispatch() — chokepoint (§1.8)

```ts
dispatch(db, pool, {
  workflowId, agentId, origin, source?, payload, parentId?, maxInstances,
}): Promise<{ id: string; deduped: boolean }>
```

1. **Dedup** (one-time): if `source` is set and a non-terminal-rejected/non-error WorkItem with
   the same `source` already exists, return `{ id: existing, deduped: true }` (no insert).
   (Ledger/approved-only dedup is refined at step 4; step 3 dedups against live + finished.)
2. **Depth cap:** walk `parent_id` to root; depth > `DEPTH_CAP` (5) → throw `DepthExceeded`.
3. Insert `work_items` row `status='queued'`, mint `id = randomUUID()`.
4. `pool.enqueue(id, agentId, maxInstances)` → runs `runObserver.run(id)` on a freed slot.
5. Emit `board` event. Return `{ id, deduped: false }`.

## 6. WorkerPool (port `instancesCore.ts`)

Per-agent: in-memory `Map<agentId, { active: number; queue: string[] }>`. `canStart` reuses the
ported predicate (`active < maxInstances`). `enqueue(id, agentId, cap)`: if a slot is free start
immediately, else push to the agent's queue. `release(agentId)`: `active--`, then dequeue the
oldest waiting id and start it. The pool calls an injected `run(id)` (the RunObserver). A run
that goes `awaiting_approval` (process killed by HITL) **releases its slot**; `resume` re-acquires
a slot for that agent ahead of the queue (continuing work has priority over new dispatches).

## 7. RunObserver (the spike's consume loop, now Postgres-backed; §1.5)

`run(id)`:
- `transition(start)`; load the WorkItem; build `RunAgentInput` from `payload` (seed the handoff
  message via `encodeHandoff` when `payload` is a handoff parcel; else minimal input); persist
  `run_id`.
- consume `provider.run(input)`: for each event `stateStore.appendTrace(id, event)` (seq from an
  in-memory per-run counter — single writer), publish on `workitem:<id>`.
  - `readGateOpened(event)` → insert Gate (`form = proposedArtifact`), `transition(gate)`, publish
    `board`. The claude-cli provider already kills its process at the approval tool call, so the
    iterable ends naturally after this event; release the pool slot.
  - a registered render tool's result (name ∈ the agent's `renders` keys) → set `work_items.card`.
- stream end: if a Gate is open → stay `awaiting_approval`; else `transition(finish)`. Publish a
  terminal `board` status. **Close the SSE only after the terminal status write flushes** (the
  step-2 lesson — port verbatim).
- on iterable error → `transition(fail)`, set `error`, release slot.

`resume(id, resolution)`: mark the Gate resolved, `transition(resume)`, acquire a slot,
`provider.resume({ runId, input }, resolution)`, consume into the SAME trace (seq continues),
finalize as above. (Step 3 does NOT execute an effect or write the ledger — that is step 4.)

## 8. Routes (`routes.ts`)

Durable shapes preserved from the spike (the client already orders/dedupes by `seq`):

- `POST /api/dev/runs` `{ agent }` → `dispatch(origin:'human', payload: minimal)` → `{ id }`
  (dev entry; the production trigger is step 6 — keeps the `?spike=1` page working).
- `GET  /api/workitems/:id/trace?from=seq` → `{ id, status, done, nextSeq, events:[{seq,event}] }`.
- `GET  /api/workitems/:id/stream` → SSE; `id:` = seq, `data:` = AG-UI event, `event: status` on
  change; honors `Last-Event-ID`. Closes only after the terminal status write flushes.
- `POST /api/dev/workitems/:id/resolve` `{ decision, form? }` → `resolveGate` (transition + resume).
- `GET  /api/board` → `{ items, gates, lastEventId }` (snapshot).
- `GET  /api/board/stream` → SSE, coarse status events only, `Last-Event-ID` resume.

## 9. DB lifecycle & dev wiring

- `DATABASE_URL=postgres://aiworkflow:aiworkflow@localhost:5432/aiworkflow` in `.env.local`
  (gitignored) with a committed `.env.example`.
- `db/client.ts` reads `DATABASE_URL`; throws a clear message if unset.
- `yarn db:generate` (drizzle-kit generate) + `yarn db:migrate` (apply). `predev` already runs
  `ensure-postgres.sh`; extend it to also run migrations (idempotent) before the server boots.
- Tests against **real Postgres** (the compose container, already healthy): a `db:reset` helper
  truncates all tables between tests; race tests run two concurrent transitions and assert the
  invariant. (CI wiring is noted; this repo has no CI yet — the race tests run under `yarn test`
  and require `DATABASE_URL`; they skip with a clear log if the DB is unreachable.)

## 10. Verification (step-3 done = ALL green)

- `yarn typecheck` + `yarn test` (incl. real-PG race tests) + `yarn lint` + `yarn format:check`.
- Browser E2E on the `?spike=1` page driving the **Postgres** spine (cassette replay):
  (1) Start reply run → attach mid-run → folded thread + gate banner + `awaiting_approval`;
  (2) reload mid-run → re-attach, full history (durable, survives a server restart now);
  (3) Approve → same open SSE tail continues across resume → status `finished`;
  (4) restart the server mid-`awaiting_approval`, reload → the gate is STILL there (the zombie/
  stale-state public-embarrassment guard — the whole point of moving off the in-memory store).
