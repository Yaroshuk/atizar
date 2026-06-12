# Bearer token on mutating routes — sub-project 7c-C

**Date:** 2026-06-12 · **Branch:** `feat/7c-packaging` · **Status:** design

## Goal

Gate every mutating HTTP route behind a single shared bearer token, so a *deployed* instance
requires the secret for actions (approve / dispatch / cancel / deliver / disconnect). Reads
(`GET`/SSE: board, trace, health, config, gate-read) stay open. Both `yarn dev` and `yarn demo`
remain one-command (token off → fail-open). This realises the README claim *"mutations require a
token"* and makes a public auditor's test pass: deploy with `ATIZAR_AUTH_TOKEN` set, POST without
the header → `401`.

Out of the original step-7 note's "honest `resolvedBy`": a *single shared* token carries **no
per-user identity**, so this sub-project does **not** populate `resolved_by`. See §6.

## Non-goals (YAGNI)

- No user accounts, roles, multiple tokens, rotation, expiry, or token hashing.
- No UI field to paste a token (decided: build-time env var, §4).
- No per-user `resolved_by` attribution (a shared token cannot identify a person).
- No constant-time comparison (beta; noted as a future hardening in §7).
- No CORS changes — same-origin via the Vite `/api` proxy; preflight is not in play.

## Decisions (locked with the user, 2026-06-12)

1. **Client token source = build-time env var** `VITE_ATIZAR_AUTH_TOKEN`, baked into the bundle;
   the operator sets it in the deploy/build environment. (Trade-off accepted: the secret is
   readable in the bundle — standard for a self-hosted internal tool.)
2. **No token configured + not demo = fail-open + a startup warning.** Mutations work without a
   token (as today); the server logs one line at boot so a deploy that forgot the token is
   visible. (Rationale: a plain `yarn dev` sets no token; fail-closed would 401 every action and
   silently "break" dev.)

## Architecture

### 1. Server env — `packages/server/src/env.ts`

Add one accessor to the existing `atizarEnv` object (the single place `ATIZAR_*` is read):

```ts
// The shared bearer token gating mutating routes. Undefined ⇒ auth disabled (fail-open).
authToken(): string | undefined {
  return process.env.ATIZAR_AUTH_TOKEN
}
```

`ATIZAR_AUTH_TOKEN` is an **official** runtime var → carries the `ATIZAR_` prefix per the env
contract (`env.ts` header rule).

### 2. Auth middleware — new file `packages/server/src/auth.ts`

A pure Hono-middleware factory, framework-side (the routes it guards live in `@platform/server`,
and "mutations require a token" is a *framework* guarantee):

```ts
import type { MiddlewareHandler } from 'hono'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Gate mutating requests behind a shared bearer token. Active only when a token is configured
// AND not in demo. GET/HEAD/OPTIONS (board, trace, SSE, health, config, gate-read) always pass.
export function createAuthMiddleware(opts: {
  token: string | undefined
  demo: boolean
}): MiddlewareHandler {
  const active = !opts.demo && !!opts.token
  return async (c, next) => {
    if (!active || !MUTATING.has(c.req.method)) return next()
    const header = c.req.header('Authorization') ?? ''
    const presented = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (presented !== opts.token) return c.json({ error: 'unauthorized' }, 401)
    return next()
  }
}
```

**Why method-based, not a path list:** all 7 mutating routes are `POST`/`DELETE`; every read is
`GET`/SSE. Gating on the HTTP method covers them all and auto-protects any *future* mutation —
exactly the README claim. No path enumeration to drift out of sync.

The guarded routes (the step-7 audit list, for the record — not enumerated in code):
`POST /api/dispatch`, `POST /api/deliver`, `POST /api/gates/:id/resolve`,
`POST /api/workitems/:id/cancel`, `POST /api/workflows/:id/cancel`, `POST /api/cancel-all`
(all `routes.ts`), and `DELETE /api/connections/:integration` (`connectRoutes.ts`).

Export `createAuthMiddleware` from the package barrel (`packages/server/src/index.ts`).

### 3. Wiring — `apps/inbox/server/index.ts`

Mount the middleware on the Hono app **before** the route factories, so it covers both
`createPipelineRoutes` and `createConnectRoutes`. Note `/api/config` is a `GET` → stays open
(the client needs it to learn `demo` before it could ever send a token).

```ts
const authToken = atizarEnv.authToken()
app.use('*', createAuthMiddleware({ token: authToken, demo: isDemo() }))
```

Startup warning (in `boot()`, after the server is listening), once, only when relevant:

```ts
if (!isDemo() && !authToken) {
  console.warn('[auth] disabled — set ATIZAR_AUTH_TOKEN to require a token on mutations')
}
```

### 4. Client token plumbing — `@platform/react` + demo app

**Framework stays env-agnostic.** The package never reads `import.meta.env`; it receives the
token through the existing config object.

- `WorkflowsConfig` (`packages/react/src/workflowsContext.tsx`) gains an optional field:
  ```ts
  authToken?: string
  ```
- A tiny pure helper (new `packages/react/src/authHeaders.ts`):
  ```ts
  export const authHeaders = (token?: string): Record<string, string> =>
    token ? { Authorization: `Bearer ${token}` } : {}
  ```
- All package mutation `fetch`es merge `authHeaders(config.authToken)` into their headers:
  `useDispatch` (dispatch/deliver/cancel×3), `useGate` (resolve), `Connections` (disconnect).
  Each reads the token from `useWorkflowsConfig().authToken`.

**The provider-scope refactor (required, also a fragility fix).** Today `WorkflowBoard` calls
`useDispatch()` (and `useBoard`/`useHealth`/`useActivity`) in its *body*, while
`<WorkflowsProvider>` wraps only the returned JSX — so those hooks run **outside** the context and
`useWorkflowsConfig()` would throw there. Split the component so every hook sits inside the
provider:

```tsx
export const WorkflowBoard = ({ config, demo }: WorkflowBoardProps) => (
  <WorkflowsProvider config={config}>
    <BoardInner config={config} demo={demo} />
  </WorkflowsProvider>
)
```

`BoardInner` = today's `WorkflowBoard` body **minus** its inner `<WorkflowsProvider>` wrap (the
provider now lives in the thin outer component). Mechanical move; no logic change. `useGate`
(in `ThreadModal`) and `Connections` (in `AppHeader`) are already inside the provider — unchanged
except for adding the header.

**Demo app** (`apps/inbox/client`): where `workflowsConfig` is assembled
(`apps/inbox/client/src/workflows.ts`), set:
```ts
authToken: import.meta.env.VITE_ATIZAR_AUTH_TOKEN as string | undefined
```
Unset in dev/demo → `undefined` → no header (matches the fail-open server and the demo's
disabled middleware). For a real deploy the operator sets `VITE_ATIZAR_AUTH_TOKEN` (client build)
and `ATIZAR_AUTH_TOKEN` (server) to the same value.

## 5. Data flow

```
deploy: ATIZAR_AUTH_TOKEN=secret (server) + VITE_ATIZAR_AUTH_TOKEN=secret (client build)
  client mutation fetch ── Authorization: Bearer secret ──▶ Vite /api proxy ──▶ Hono
                                                                                 │
                          createAuthMiddleware (active: !demo && token)          │
                            method ∈ {POST,PUT,PATCH,DELETE}? ── no ─▶ next() (GET/SSE)
                                          │ yes
                            Bearer matches token? ── no ─▶ 401 {error:'unauthorized'}
                                          │ yes
                                        next() ─▶ route handler

dev/demo: no token (or demo) → middleware inactive → every request passes; client sends no header
```

## 6. `resolved_by` — explicit scope

`gates.resolved_by` (text, nullable) exists in the schema, and `runObserver.ts:282` carries an
aspirational comment ("resolvedBy comes from the bearer-token identity at step 4; null in the dev
path"). A **single shared** token authorises but does not identify — there is no honest per-user
value to write. This sub-project therefore leaves `resolved_by` **null** and does not touch
`resolveGate`'s signature. Per-identity attribution requires per-user tokens / real auth and is
**post-beta**. The aspirational comment will be corrected to say so (no behavioural change).

## 7. Error handling & edge cases

- **Wrong/missing token on a mutation:** `401 {error:'unauthorized'}`. The client surfaces the
  failure through each hook's existing error path (e.g. `useGate`'s resolve already inspects
  `res.ok`; verify `useDispatch.start` does too — it returns the parsed id, so a 401 must not be
  treated as success). Any hook that ignored `res.ok` gets a guard added.
- **Demo mode:** middleware inactive regardless of token → `yarn demo` stays one-command.
- **GET/SSE:** always open — board/trace/health/config/gate-read and both SSE tails are
  unauthenticated by design (read-only).
- **`OPTIONS`/`HEAD`:** not in `MUTATING` → pass (no CORS today, but safe if added later).
- **Token present but demo:** inactive (demo wins) — a token set in a demo env is ignored, not an
  error.

## 8. Testing

**Unit — `packages/server/src/auth.test.ts`** (behaviour matrix over `createAuthMiddleware`,
driven through a minimal Hono app or by invoking the handler with a fake context):
- demo=true, token set → POST passes (inactive).
- demo=false, no token → POST passes (inactive) .
- demo=false, token set:
  - `GET` passes with no header;
  - `POST` no header → 401;
  - `POST` `Authorization: Bearer wrong` → 401;
  - `POST` `Authorization: Bearer <token>` → passes;
  - `DELETE` correct token → passes; wrong → 401.

**Unit — `authHeaders`:** `undefined` → `{}`; `'x'` → `{ Authorization: 'Bearer x' }`.

**Browser E2E** (project law — unit tests provably miss this codebase's bug class). Run with the
non-demo stack (real Postgres, `DEV_RECORD_REPLAY=1`, lead-inbox cassette):
1. **Token set + client matches** (`ATIZAR_AUTH_TOKEN=secret yarn dev:server` +
   `VITE_ATIZAR_AUTH_TOKEN=secret` for the client) → START + approve flow works end-to-end
   (gate resolves, ledger one row, item `finished`).
2. **Token set + client wrong/empty** → the approve POST returns `401`; the UI does not report a
   false success (gate stays open / surfaces the error).
3. **Plain `yarn dev` (no token)** → boot logs `[auth] disabled …`; approve works (fail-open).
4. **`yarn demo` (token unset)** → everything works; no warning is required (demo path).

## 9. Files touched

- `packages/server/src/env.ts` — `authToken()` accessor.
- `packages/server/src/auth.ts` — **new**, `createAuthMiddleware`.
- `packages/server/src/auth.test.ts` — **new**, behaviour matrix.
- `packages/server/src/index.ts` — barrel export `createAuthMiddleware`.
- `apps/inbox/server/index.ts` — mount middleware + startup warning.
- `packages/react/src/workflowsContext.tsx` — `authToken?` on `WorkflowsConfig`.
- `packages/react/src/authHeaders.ts` — **new** helper (+ a small test, or fold into an existing).
- `packages/react/src/WorkflowBoard.tsx` — split into `WorkflowBoard` (provider) + `BoardInner`.
- `packages/react/src/hooks/useDispatch.ts`, `hooks/useGate.ts`,
  `components/Connections.tsx` — merge `authHeaders(config.authToken)` into mutation fetches; add
  `res.ok` guards where missing.
- `packages/react/src/index.ts` — export `authHeaders` if useful to userland (optional).
- `apps/inbox/client/src/workflows.ts` — set `authToken` from `VITE_ATIZAR_AUTH_TOKEN`.
- `runObserver.ts:282` — correct the aspirational comment (no behavioural change).

## 10. Foundation check

Touches providers/actions? No — auth is transport-edge middleware, no change to the action ledger,
gate semantics, or the framework/userland boundary (token flows via config, the established
injection pattern). Run `check-foundation` during the plan to confirm CLEAR before building.

## 11. Definition of done

Typecheck + lint + all unit tests green; the §8 browser E2E (all 4) verified; HANDOFF 7c-C line
flipped to ✅ BUILT with an as-built note; `yarn demo` and plain `yarn dev` both still one-command.
