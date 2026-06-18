# Per-session demo isolation — design

**Date:** 2026-06-18 · **Branch:** `feat/demo-site` · **Status:** approved, pre-implementation

## Goal

On the public demo, each browser visitor gets their **own** board: they see only the work items
they started, and their Stop/Reset/START never touch another visitor's runs. Today the demo is one
process + one in-memory PGlite DB shared by everyone, so concurrent visitors collide.

This is the **simple wrapper** — not full multi-tenant auth. It scopes state by a **tenant key**
(`sessionId`) that the framework reads from a request header (default `'global'` → today's shared
behavior). The client sends a per-browser key **only in demo mode**, so:

- **demo:** each browser → its own `sessionId` → isolated board.
- **non-demo (single operator):** no header → `'global'` → shared board, unchanged.

The framework gains a **generic tenant-scoping** capability; the demo-specific policy ("per-browser
in demo") lives in the client. No demo/workflow literals enter the framework (I5).

## Invariants

- **I8 (server-authoritative, one `transition()` / one `dispatch()`):** preserved. `transition()`
  stays id-based and untouched. `dispatch()` stays the sole minter — it just stamps the tenant and
  scopes its own dedup/episode queries. We narrow query SCOPE from global to tenant; we do not add a
  second writer or chokepoint. `check-foundation` runs on this change.

## Architecture

### Tenant key flow

`sessionId` rides on the **work-item row**. It originates at a **root** dispatch (human START) from
the request header; a **child** (handoff/deliver) inherits its parent's `sessionId`. Everything that
operates by a work-item **id** (trace, per-item stream, gate-by-id, cancel-item, transition) needs no
tenant param — the row already carries it, and ids are unguessable UUIDs (benign for a demo). Only
operations that **enumerate** items, or that **read the board**, need the tenant explicitly.

### Server (`@atizar/server`)

1. **Schema:** add `work_items.sessionId text NOT NULL DEFAULT 'global'`. (Drizzle migration.) No
   `sessionId` on gates/trace/ledger/audit — those are reached by work-item id, already tenant-owned.
2. **`stateStore`:** `insertWorkItem` accepts `sessionId`. These enumerate queries take a `sessionId`
   filter: `getBoardSnapshot`, `getActiveByWorkflow`, `getResettable`, `getFinishedInputRoots`,
   `hasLiveInputScan`, `countActiveByAgent`. `getBoardSnapshot` also scopes open gates via a join to
   `work_items.sessionId`. `getActiveChildren(parentId)` is unchanged (parentId already scopes to one
   tenant's tree).
3. **`dispatch()`:** `DispatchInput` gains `sessionId`. It scopes the **source-dedup** query and the
   **episode-sibling** query by `sessionId`, stamps `sessionId` on the insert, and passes it to
   `pool.enqueue`. `countAncestors` (id walk) is unchanged.
4. **`workerPool`:** `enqueue(id, agentId, maxInstances, sessionId)`; the cap check counts active for
   `(agentId, sessionId)` — so each tenant gets its own `maxInstances` budget (one visitor's runs
   never fill another's slots).
5. **`pipelineService`:** thread `sessionId` into `getBoard`, `dispatch` (root: from request; child:
   read parent row → inherit), `cancelAll`, `resetAll`, `cancelWorkflow`, `resetWorkflow`,
   `cancelInstance`. `deliverImpl` inherits the parent's `sessionId`.
6. **Activity log:** tag each ring entry with the originating work item's `sessionId`; `snapshot` and
   the stream filter by the request's tenant — so the advertised "transparency" log stays per-visitor.
7. **Routes:** a `sessionOf(c) = c.req.header('x-atizar-session') ?? 'global'` helper; thread it into
   the board read, dispatch, the global cancel/reset ops, cancel-instance, and the activity read.
   Per-id routes unchanged.

### Client (`@atizar/react` + app)

1. **`session.ts`** (in `@atizar/react`): `setSessionEnabled(demo)` — in demo, create/persist a uuid
   in `localStorage['atizar-session']`; otherwise stay disabled. `sessionHeaders()` returns
   `{ 'X-Atizar-Session': id }` when enabled, else `{}`.
2. **Hooks:** inject `sessionHeaders()` into the **fetch** calls that enumerate or mutate — `useBoard`
   refetch (`GET /api/board`), all `useDispatch` POSTs, `useGate`, `useActivity` GET. **SSE
   (`EventSource`) stays headerless** — board/activity streams are global "something changed" pokes;
   each client **refetches** (with the header) and gets its own filtered snapshot. Per-item streams
   are id-scoped.
3. **App:** `Demo.tsx` calls `setSessionEnabled(config.demo)` after `/api/config` resolves, before
   mounting the board.

## Data flow (demo, two visitors)

```
Visitor A browser  →  X-Atizar-Session: aaa  →  GET /api/board → items WHERE sessionId='aaa'
Visitor B browser  →  X-Atizar-Session: bbb  →  GET /api/board → items WHERE sessionId='bbb'
A START → dispatch(sessionId='aaa') → root + children stamped 'aaa'; dedup/episode/cap scoped to 'aaa'
A Reset all → resetWorkflow(sessionId='aaa') → only A's items; B untouched
board SSE poke (global) → both refetch → each sees only its own items
```

## Testing

- **Server (unit, PGlite):** two `sessionId`s; assert `getBoardSnapshot('aaa')` returns only A's
  items (+ only A's open gates); `getActiveByWorkflow`/`getResettable`/`hasLiveInputScan`/
  `getFinishedInputRoots`/`countActiveByAgent` are tenant-scoped; `dispatch` with the same `source`
  under two tenants does NOT cross-dedup (B gets its own item); `'global'` default = pre-change
  behavior (one test proving non-demo is unchanged).
- **Client (unit):** `sessionHeaders()` empty until `setSessionEnabled(true)`, then a stable uuid;
  disabled in non-demo.
- **Browser E2E (two sessions):** open the demo in two browser contexts (distinct localStorage).
  Each starts a run → each sees ONLY its own pipeline. A's "Reset all" / "Stop all" leaves B intact.
  Two concurrent STARTs do NOT 409 each other (scoped `hasLiveInputScan`). Verified via the
  `browser-verify` skill with two contexts.

## Out of scope (named, not built)

- Per-id authorization (cancel/gate by another session's id) — benign for a demo (UUIDs, you only see
  your own); belongs to full multi-tenant.
- Per-tenant PGlite DBs — rejected (heavy: migrations + pool + observer per session).
- Auth/login. Sessions are anonymous, ephemeral (PGlite resets on restart — abandoned sessions
  self-clean).

## Boundary check (I5)

| Concern | Lives in | Why |
| --- | --- | --- |
| tenant-scoping of state, `X-Atizar-Session` header, default `'global'` | `@atizar/server` (framework) | Generic multi-tenant mechanism; no demo/workflow literals |
| per-browser id, "only in demo" | `@atizar/react` session util + `Demo.tsx` (app/client) | Demo policy |
