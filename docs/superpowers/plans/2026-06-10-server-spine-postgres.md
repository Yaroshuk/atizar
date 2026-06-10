# Server Spine on Postgres — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the step-2 in-memory spike store with a Postgres-backed server spine (StateStore, `transition()` with row-lock guards, `dispatch()` chokepoint, WorkerPool, RunObserver) so WorkItems/Gates/Trace are durable and survive a server restart.

**Architecture:** drizzle-orm + postgres.js over the dev Postgres container. One `transition()` owns every `work_items.status` write (`SELECT … FOR UPDATE`, ascending-id lock order). One `dispatch()` chokepoint mints ids + dedups + enqueues. WorkerPool ports the unit-tested cap/queue from `client/src/instancesCore.ts`. RunObserver consumes the SAME wrapped provider the spike used (`buildProvider`), appends Trace, reacts to `GATE_OPENED`, finalizes. Design → `docs/superpowers/specs/2026-06-10-server-spine-postgres-design.md`.

**Tech Stack:** drizzle-orm, drizzle-kit, postgres (postgres.js), Hono SSE, vitest (real-PG integration tests).

---

## Phase 0 — Deps, env, DB client

### Task 0.1: Install deps + env scaffolding

**Files:** Modify `package.json` (root) / `apps/inbox/package.json`; create `apps/inbox/.env.example`; modify `.gitignore` if needed.

- [ ] Install: `yarn add drizzle-orm postgres -W` and `yarn add -D drizzle-kit -W` (root workspace). Use `--ignore-engines` if Node 20.14 complains.
- [ ] Add `apps/inbox/.env.example` with `DATABASE_URL=postgres://aiworkflow:aiworkflow@localhost:5432/aiworkflow`.
- [ ] Put the real `DATABASE_URL` in `apps/inbox/.env.local` (gitignored). Confirm `tsx watch` loads it (the server already reads `.env.local`? if not, add `import 'dotenv/config'` guarded, or load via `node --env-file`). Verify: a throwaway script logs `process.env.DATABASE_URL`.
- [ ] Commit: `chore(db): add drizzle + postgres deps and DATABASE_URL env`.

### Task 0.2: drizzle schema

**Files:** Create `apps/inbox/server/pipeline/db/schema.ts`.

- [ ] Define pgEnums + tables exactly per design §3 (`schema_meta`, `work_items`, `gates`, `trace` PK `(work_item_id, seq)`, `action_ledger` PK `key`). Status pgEnum = the full §5 union; `resolution` pgEnum `cancelled|rejected`.
- [ ] Export inferred types: `WorkItem`, `NewWorkItem`, `Gate`, `TraceRow`, etc. (`typeof table.$inferSelect`).
- [ ] `yarn typecheck` green.
- [ ] Commit: `feat(db): drizzle schema for work_items/gates/trace/action_ledger`.

### Task 0.3: drizzle-kit config + first migration + client

**Files:** Create `apps/inbox/drizzle.config.ts`, `apps/inbox/server/pipeline/db/client.ts`; add `db:generate`/`db:migrate`/`db:reset` scripts.

- [ ] `drizzle.config.ts`: dialect `postgresql`, schema path → `server/pipeline/db/schema.ts`, out → `server/pipeline/db/migrations`, `dbCredentials.url` from `DATABASE_URL`.
- [ ] `client.ts`: `const sql = postgres(env.DATABASE_URL)`; `export const db = drizzle(sql, { schema })`; throw a clear error if `DATABASE_URL` is unset. Export a `closeDb()` for tests.
- [ ] `yarn db:generate` → a migration appears under `db/migrations/`. `yarn db:migrate` → tables exist (`docker exec aiworkflow-postgres psql -U aiworkflow -c '\dt'` shows them). Seed `schema_meta(schema_version,'1')` in the migration or a post-migrate step.
- [ ] Add `db:reset` (truncate all tables) script for tests.
- [ ] Commit: `feat(db): drizzle-kit config, first migration, db client`.

---

## Phase 1 — StateStore (typed CRUD, no status writes)

### Task 1.1: StateStore read/insert + Trace append (TDD, real PG)

**Files:** Create `apps/inbox/server/pipeline/stateStore.ts`; Test `apps/inbox/server/pipeline/stateStore.test.ts`.

- [ ] **Failing test:** insert a WorkItem (queued), read it back; append 3 trace rows (seq 0,1,2), read `getTrace(id, from:1)` → 2 rows ordered; `getBoard()` returns the item. Use a `beforeEach` that truncates via `db:reset` logic; `describe.skipIf(!process.env.DATABASE_URL)`.
- [ ] Run → FAIL (functions undefined).
- [ ] Implement `stateStore.ts`: `insertWorkItem`, `getWorkItem`, `appendTrace(id, seq, event, surfaced)`, `getTrace(id, from)`, `getBoardSnapshot()`, `insertGate`, `getOpenGate(workItemId)`, `resolveGateRow`, `setCard`, `setRunId`, `setError`. NO status writes here except via transition (Task 2).
- [ ] Run → PASS. `yarn lint` green.
- [ ] Commit: `feat(pipeline): StateStore CRUD + Trace append (real-PG tested)`.

---

## Phase 2 — transition() with FOR UPDATE guards

### Task 2.1: edge map + legal-transition guard (TDD)

**Files:** Create `apps/inbox/server/pipeline/transition.ts`; Test `transition.test.ts`.

- [ ] **Failing test:** insert queued item; `transition(start)` → running; `transition(gate)` → awaiting_approval; `transition(resume)` → running; `transition(finish)` → finished. An illegal edge (`transition(gate)` from `queued`) throws `IllegalTransition` and leaves status unchanged.
- [ ] Run → FAIL.
- [ ] Implement: `const EDGES: Record<Edge,{from:Status[];to:Status}>` per design §4; `transition(id, edge)` opens `db.transaction`, `SELECT … FOR UPDATE` the row (`for('update')` via drizzle / raw `sql`), checks `from.includes(current)`, UPDATEs status (+`error` on `fail`), bumps `updated_at`. Throw `IllegalTransition` if not legal.
- [ ] Run → PASS.
- [ ] Commit: `feat(pipeline): transition() edge guards with SELECT FOR UPDATE`.

### Task 2.2: leaf→root auto-finish walk + finished entry guard (TDD)

**Files:** Modify `transition.ts`; Test `transition.test.ts`.

- [ ] **Failing test:** parent (running) with two running children A,B. `finish(A)` → parent STILL running (B active). `finish(B)` → parent auto-finishes to `finished`. A parent with a `queued` child does NOT auto-finish.
- [ ] Run → FAIL.
- [ ] Implement: in the `finish` edge, after finishing the row, if `parent_id` set, lock parent ascending-id, count active children (`queued|running|awaiting_approval|awaiting_input`); if zero, finish the parent too (recurse to root). The "no active children" check IS the `finished` entry guard, factored into one helper `assertCanFinish`.
- [ ] Run → PASS.
- [ ] Commit: `feat(pipeline): auto-finish parent walk + finished entry guard`.

### Task 2.3: race tests against real PG (TDD)

**Files:** Test `transition.race.test.ts`.

- [ ] **Test:** `finish(A)` and `finish(B)` fired concurrently (`Promise.all`) on two siblings of one parent → parent ends `finished` exactly once (no lost update, no double-finish error). `finish(A)` concurrent with `dispatch(new child C)` under the same parent → parent does NOT finish while C is queued.
- [ ] Run → PASS (FOR UPDATE serializes). If it flakes, switch to SERIALIZABLE + retry on `40001` (design §1.7 alternative) and note it.
- [ ] Commit: `test(pipeline): real-PG race tests for finish/dispatch`.

---

## Phase 3 — dispatch() chokepoint + WorkerPool

### Task 3.1: port instancesCore cap predicate to the server pool (TDD)

**Files:** Create `apps/inbox/server/pipeline/workerPool.ts`; Test `workerPool.test.ts`.

- [ ] **Failing test (pure, no DB):** a pool with injected `run` spy, cap 2 for agent `X`. `enqueue` 3 ids → `run` called for the first 2, the 3rd waits; `release(X)` → the 3rd `run` fires. `resume(X, id)` acquires ahead of a still-queued id.
- [ ] Run → FAIL.
- [ ] Implement `makeWorkerPool({ run })`: `Map<agentId,{active,queue}>`; `enqueue(id,agentId,cap)`, `release(agentId)`, `resumeAcquire(id,agentId,cap)`. Reuse the `canStart = active < cap` predicate ported from `instancesCore.ts` (copy the comment crediting the source).
- [ ] Run → PASS.
- [ ] Commit: `feat(pipeline): WorkerPool (cap+queue ported from instancesCore)`.

### Task 3.2: dispatch() — mint, dedup, depth cap (TDD, real PG)

**Files:** Create `apps/inbox/server/pipeline/dispatch.ts`; Test `dispatch.test.ts`.

- [ ] **Failing test:** `dispatch({source:'thread:1',…})` inserts a queued row + enqueues (pool.enqueue spy called). A second `dispatch` with the same `source` (while the first is live) → `{deduped:true, id: first}`, NO second row. Depth: dispatch a chain parent→child→… past `DEPTH_CAP` → throws `DepthExceeded`.
- [ ] Run → FAIL.
- [ ] Implement per design §5. Dedup query = existing WorkItem with same `source` AND status NOT IN (`error`) AND `resolution` IS NOT `rejected`. Depth = recursive parent walk (or a CTE).
- [ ] Run → PASS.
- [ ] Commit: `feat(pipeline): dispatch() chokepoint (dedup + depth cap)`.

---

## Phase 4 — RunObserver + EventBus + PipelineService

### Task 4.1: EventBus (TDD)

**Files:** Create `apps/inbox/server/pipeline/eventBus.ts`; Test `eventBus.test.ts`.

- [ ] **Failing test:** subscribe to `workitem:1`, publish → received; `board` topic isolated.
- [ ] Implement a thin wrapper over one `EventEmitter` (`publish(topic,msg)`, `subscribe(topic,fn)→unsub`), `setMaxListeners(0)`.
- [ ] Run → PASS. Commit: `feat(pipeline): in-process EventBus (board + workitem topics)`.

### Task 4.2: RunObserver consume loop (integration test with mock provider, real PG)

**Files:** Create `apps/inbox/server/pipeline/runObserver.ts`; Test `runObserver.test.ts`.

- [ ] **Failing test:** drive a fake provider whose `run()` yields: text deltas, a render-tool result, then a `gateOpened(...)` CUSTOM event, then ends. After `observer.run(id)`: trace rows persisted in order; `work_items.card` filled from the render tool; a Gate row open; status `awaiting_approval`; pool slot released. Then `observer.resume(id, {approved})` with the fake provider's `resume()` yielding 2 more events → trace continues (seq 18,19…), Gate resolved, status `finished`.
- [ ] Run → FAIL.
- [ ] Implement per design §7. Build `RunAgentInput` from `payload` (use `encodeHandoff` when payload validates as a handoff parcel, else minimal input like the spike's `minimalInput`). Single in-memory seq counter per run. Publish each event on `workitem:<id>`; publish status changes on `board`.
- [ ] Run → PASS.
- [ ] Commit: `feat(pipeline): RunObserver (trace + GATE_OPENED + resume + finalize)`.

### Task 4.3: PipelineService wiring (TDD, real PG, mock provider)

**Files:** Create `apps/inbox/server/pipeline/pipelineService.ts`; Test `pipelineService.test.ts`.

- [ ] **Failing test:** `service.dispatch(...)` → eventually `awaiting_approval` (poll the store); `service.resolveGate(id,{approved})` → `finished`; `service.getTrace(id,0)` returns the full stitched trace; cap holds — 3 dispatches of a cap-2 agent → 2 running + 1 queued.
- [ ] Run → FAIL.
- [ ] Implement: construct WorkerPool with `run: (id)=>observer.run(id)`; `dispatch` delegates to `dispatch.ts`; `resolveGate` → `observer.resume`; expose `getTrace`/`getBoard`. Provider lookup injected (`getProvider(agentId)`), same `buildProvider` the spike used.
- [ ] Run → PASS.
- [ ] Commit: `feat(pipeline): PipelineService wiring`.

---

## Phase 5 — Routes + server wiring + startup migrate

### Task 5.1: routes.ts (port spike endpoint shapes onto PipelineService)

**Files:** Create `apps/inbox/server/pipeline/routes.ts`; modify `apps/inbox/server/index.ts`.

- [ ] Implement the routes in design §8 against `PipelineService`. Port the SSE handler from `dev-runs.ts` VERBATIM (the FIFO terminal-flush close ordering — the step-2 lesson) but read backlog from `getTrace` and tail from the EventBus `workitem:<id>` topic instead of the in-memory emitter. Add `GET /api/board` + `/api/board/stream`.
- [ ] In `index.ts`: build a `getProvider(agentId)` from the existing `providers` map; instantiate `PipelineService`; mount `pipelineRoutes`. REMOVE the `createDevRunsRoutes` mount (the spike's in-memory store) — replaced. Keep the CopilotKit endpoint untouched.
- [ ] `yarn typecheck` green.
- [ ] Commit: `feat(pipeline): Hono routes on PipelineService; retire in-memory spike store`.

### Task 5.2: startup migrate + sweep stub + predev migration

**Files:** Modify `apps/inbox/server/index.ts`; `scripts/ensure-postgres.sh` or `package.json` predev; create `apps/inbox/server/pipeline/migrate-on-boot.ts`.

- [ ] On boot (before `serve`): run drizzle migrations programmatically (`migrate(db, { migrationsFolder })`) so a fresh clone + `yarn dev` just works.
- [ ] Minimal startup sweep (the zombie-state guard, design §10 / spec §1.2): on boot mark every `running` row with no live executor → `error('executor lost')`; re-enqueue `queued` rows by `created_at`. (Cancel edges are step 4; this sweep stub prevents zombie running cards now.)
- [ ] `predev`: after `ensure-postgres.sh`, run `yarn db:migrate` (idempotent). Verify `yarn dev` boots with tables present + 0 errors.
- [ ] Commit: `feat(pipeline): migrate-on-boot + startup sweep + predev migrate`.

---

## Phase 6 — Verification (step-3 done gate)

### Task 6.1: full green + browser E2E

- [ ] `yarn typecheck && yarn test && yarn lint && yarn format:check` all green (race tests run against the live container).
- [ ] Kill stale dev stacks + free ports (CLAUDE.md gotcha). `DEV_RECORD_REPLAY=1 yarn dev`.
- [ ] Browser (`?spike=1`, design §10): (1) Start reply run → attach mid-run → folded thread + gate banner + `awaiting_approval`; (2) reload mid-run → full history; (3) Approve → SSE tail continues → `finished`; (4) **restart the server while `awaiting_approval`, reload → the gate is STILL there** (durability — the whole point of step 3).
- [ ] Update `HANDOFF.md` step-3 line → ✅ BUILT + an As-built note; update `docs/BUILD-LOG.md`.
- [ ] Commit: `docs: step-3 server spine BUILT & browser-verified (As-built note)`.

---

## Self-review notes

- **Spec coverage:** StateStore (P1), transition+guards+races (P2), dispatch+pool (P3), RunObserver+bus+service (P4), routes+wiring+migrate+sweep (P5), verification (P6). Deferred-by-design (step 4): effects, ledger writes, formRev 409, cancel/Stop, full all-edges guard table — seams present (tables, `resolution` col, `form_rev`).
- **Type consistency:** `transition(id, edge)` edges = `start|gate|resume|finish|fail`; status union from the schema pgEnum is the single source; `WorkItem`/`Gate`/`TraceRow` are `$inferSelect` types reused everywhere.
- **Real-PG tests** gate on `DATABASE_URL` and skip with a clear log when the container is down, so core-only work still runs `yarn test`.
