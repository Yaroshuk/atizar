# Bearer Token on Mutating Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate every mutating HTTP route (POST/DELETE) behind a single shared bearer token, while reads (GET/SSE) stay open and both `yarn dev` and `yarn demo` remain one-command.

**Architecture:** A method-based Hono middleware in `@atizar/server` checks `Authorization: Bearer <token>` on non-GET requests, active only when a token is configured and not in demo mode (fail-open otherwise, with a startup warning). The token reaches the browser via a build-time `VITE_ATIZAR_AUTH_TOKEN`, is threaded into `@atizar/react` through the existing `WorkflowsConfig` context, and merged into every mutation `fetch`.

**Tech Stack:** TypeScript, Hono (server), React (`@atizar/react`), Vite, Vitest, yarn-classic workspace.

**Spec:** `docs/superpowers/specs/2026-06-12-bearer-token-mutating-routes-design.md`

**Conventions reminder:** Prettier (`semi:false`, single quotes, `printWidth:100`); run from repo root (`yarn test`, `yarn typecheck`, `yarn lint`); `console` allowed in `server/**`; `any` allowed only in `*.test.*`. Run `yarn lint` before each commit (a per-session footgun). Workspace deps need no build step — `exports` point at `./src/index.ts`. Test files start with `// @vitest-environment node` for server packages.

---

## File Structure

**Server (`@atizar/server`):**
- `packages/server/src/env.ts` — add `authToken()` accessor (MODIFY).
- `packages/server/src/auth.ts` — `createAuthMiddleware` (CREATE).
- `packages/server/src/auth.test.ts` — behaviour matrix (CREATE).
- `packages/server/src/index.ts` — barrel export `createAuthMiddleware` (MODIFY).

**App server:**
- `apps/inbox/server/index.ts` — mount middleware + startup warning (MODIFY).

**Client (`@atizar/react`):**
- `packages/react/src/authHeaders.ts` — `authHeaders` helper (CREATE).
- `packages/react/src/authHeaders.test.ts` — helper test (CREATE).
- `packages/react/src/workflowsContext.tsx` — `authToken?` on `WorkflowsConfig` (MODIFY).
- `packages/react/src/WorkflowBoard.tsx` — split into `WorkflowBoard` (provider wrapper) + `BoardInner` (MODIFY).
- `packages/react/src/hooks/useDispatch.ts` — read token from context, merge headers, guard `res.ok` (MODIFY).
- `packages/react/src/hooks/useGate.ts` — merge headers on resolve (MODIFY).
- `packages/react/src/components/Connections.tsx` — merge headers on disconnect (MODIFY).
- `packages/react/src/index.ts` — export `authHeaders` (MODIFY).

**Demo app client:**
- `apps/inbox/client/src/workflows.ts` — set `authToken` from `VITE_ATIZAR_AUTH_TOKEN` (MODIFY).

**Comment cleanup:**
- `packages/server/src/runObserver.ts:282` — correct the aspirational `resolvedBy` comment (MODIFY).

---

## Task 1: Server env accessor — `authToken()`

**Files:**
- Modify: `packages/server/src/env.ts`
- Test: `packages/server/src/env.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the `describe('atizarEnv', …)` block in `packages/server/src/env.test.ts`:

```ts
it('reads the shared bearer token', () => {
  process.env.ATIZAR_AUTH_TOKEN = 'sekret'
  expect(atizarEnv.authToken()).toBe('sekret')
})

it('returns undefined when no bearer token is set', () => {
  delete process.env.ATIZAR_AUTH_TOKEN
  expect(atizarEnv.authToken()).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test packages/server/src/env.test.ts`
Expected: FAIL — `atizarEnv.authToken is not a function`.

- [ ] **Step 3: Add the accessor**

In `packages/server/src/env.ts`, add to the `atizarEnv` object (place it next to `secretKey`, before `apiKey`):

```ts
  // The shared bearer token gating mutating routes. Undefined ⇒ auth disabled (fail-open).
  authToken(): string | undefined {
    return process.env.ATIZAR_AUTH_TOKEN
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test packages/server/src/env.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
yarn lint
git add packages/server/src/env.ts packages/server/src/env.test.ts
git commit -m "feat(7c-C): ATIZAR_AUTH_TOKEN accessor on atizarEnv"
```

---

## Task 2: Auth middleware — `createAuthMiddleware`

**Files:**
- Create: `packages/server/src/auth.ts`
- Create: `packages/server/src/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/auth.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createAuthMiddleware } from './auth.js'

// Mount the middleware on a tiny app with one GET and one POST route, then probe it.
const makeApp = (opts: { token: string | undefined; demo: boolean }) => {
  const app = new Hono()
  app.use('*', createAuthMiddleware(opts))
  app.get('/api/board', (c) => c.json({ ok: true }))
  app.post('/api/dispatch', (c) => c.json({ id: 'x' }))
  app.delete('/api/connections/:i', (c) => c.json({ ok: true }))
  return app
}
const bearer = (t: string) => ({ headers: { Authorization: `Bearer ${t}` } })

describe('createAuthMiddleware', () => {
  it('passes all requests in demo mode even with a token set', async () => {
    const app = makeApp({ token: 'sek', demo: true })
    expect((await app.request('/api/dispatch', { method: 'POST' })).status).toBe(200)
  })

  it('passes all requests when no token is configured (fail-open)', async () => {
    const app = makeApp({ token: undefined, demo: false })
    expect((await app.request('/api/dispatch', { method: 'POST' })).status).toBe(200)
  })

  describe('active (token set, not demo)', () => {
    const app = makeApp({ token: 'sek', demo: false })

    it('lets GET through with no header', async () => {
      expect((await app.request('/api/board')).status).toBe(200)
    })

    it('401s a POST with no Authorization header', async () => {
      expect((await app.request('/api/dispatch', { method: 'POST' })).status).toBe(401)
    })

    it('401s a POST with a wrong token', async () => {
      const res = await app.request('/api/dispatch', { method: 'POST', ...bearer('nope') })
      expect(res.status).toBe(401)
    })

    it('passes a POST with the correct token', async () => {
      const res = await app.request('/api/dispatch', { method: 'POST', ...bearer('sek') })
      expect(res.status).toBe(200)
    })

    it('401s a DELETE with a wrong token and passes with the right one', async () => {
      expect((await app.request('/api/connections/gmail', { method: 'DELETE' })).status).toBe(401)
      const ok = await app.request('/api/connections/gmail', { method: 'DELETE', ...bearer('sek') })
      expect(ok.status).toBe(200)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test packages/server/src/auth.test.ts`
Expected: FAIL — cannot resolve `./auth.js`.

- [ ] **Step 3: Write the middleware**

Create `packages/server/src/auth.ts`:

```ts
import type { MiddlewareHandler } from 'hono'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Gate mutating requests behind a shared bearer token. Active ONLY when a token is configured
// AND not in demo mode; otherwise every request passes (fail-open — see spec §2). GET/HEAD/
// OPTIONS (board, trace, SSE, health, config, gate-read) always pass: gating on the HTTP method
// covers all current mutating routes and auto-protects any future one.
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

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test packages/server/src/auth.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Export from the barrel**

In `packages/server/src/index.ts`, add after the `createConnectRoutes` export line:

```ts
export { createAuthMiddleware } from './auth.js'
```

- [ ] **Step 6: Typecheck + commit**

```bash
yarn typecheck
yarn lint
git add packages/server/src/auth.ts packages/server/src/auth.test.ts packages/server/src/index.ts
git commit -m "feat(7c-C): createAuthMiddleware (method-based bearer gate)"
```

---

## Task 3: Mount the middleware + startup warning

**Files:**
- Modify: `apps/inbox/server/index.ts`

This task has no unit test (it's composition-root wiring; covered by the Task 8 browser E2E). Verify by booting.

- [ ] **Step 1: Import the middleware + env accessor**

In `apps/inbox/server/index.ts`, the `@atizar/server` import block currently lists named imports. Add `createAuthMiddleware` and `atizarEnv` to it:

```ts
import {
  db,
  runMigrations,
  startupSweep,
  makePipelineService,
  createPipelineRoutes,
  makeCredentialStore,
  createConnectRoutes,
  createAuthMiddleware,
  atizarEnv,
  isDemo,
  type AgentRuntime,
} from '@atizar/server'
```

- [ ] **Step 2: Mount the middleware before the route factories**

Find the line `const app = new Hono()` (just after the `makePipelineService({...})` block). Immediately after it — and BEFORE the `app.get('/api/config', …)` and the two `app.route('/', …)` calls — insert:

```ts
// Bearer-token gate on every mutating route (spec 7c-C). Active only when a token is set and
// not in demo; GET/SSE stay open. Mounted before the route factories so it covers both.
const authToken = atizarEnv.authToken()
app.use('*', createAuthMiddleware({ token: authToken, demo: isDemo() }))
```

(`/api/config` is a GET, so it stays open — the client must read `demo` before it could send a token.)

- [ ] **Step 3: Add the startup warning in boot()**

In the `boot()` function, after the `console.log('server on http://localhost:4000')` line, add:

```ts
  if (!isDemo() && !authToken) {
    console.warn('[auth] disabled — set ATIZAR_AUTH_TOKEN to require a token on mutations')
  }
```

- [ ] **Step 4: Verify boot — fail-open path**

Run (no token, real Postgres must be up — `docker compose up -d postgres` if needed):

```bash
yarn dev:server
```

Expected in the log: `[auth] disabled — set ATIZAR_AUTH_TOKEN to require a token on mutations`.
Then in another shell: `curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:4000/api/cancel-all` → `200` (fail-open). Stop the server (Ctrl-C).

- [ ] **Step 5: Verify boot — active path**

Run: `ATIZAR_AUTH_TOKEN=sek yarn dev:server`
Expected: NO `[auth] disabled` line.
Then: `curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:4000/api/cancel-all` → `401`.
And: `curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer sek" -X POST localhost:4000/api/cancel-all` → `200`.
And GET stays open: `curl -s -o /dev/null -w "%{http_code}\n" localhost:4000/api/board` → `200`.
Stop the server.

- [ ] **Step 6: Commit**

```bash
yarn typecheck
yarn lint
git add apps/inbox/server/index.ts
git commit -m "feat(7c-C): mount auth middleware + startup warning"
```

---

## Task 4: Client `authHeaders` helper

**Files:**
- Create: `packages/react/src/authHeaders.ts`
- Create: `packages/react/src/authHeaders.test.ts`
- Modify: `packages/react/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/react/src/authHeaders.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { authHeaders } from './authHeaders.js'

describe('authHeaders', () => {
  it('returns an empty object when no token is given', () => {
    expect(authHeaders(undefined)).toEqual({})
  })

  it('returns a Bearer Authorization header when a token is given', () => {
    expect(authHeaders('sek')).toEqual({ Authorization: 'Bearer sek' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test packages/react/src/authHeaders.test.ts`
Expected: FAIL — cannot resolve `./authHeaders.js`.

- [ ] **Step 3: Write the helper**

Create `packages/react/src/authHeaders.ts`:

```ts
// Build the Authorization header for a mutation fetch from the (optional) shared bearer token.
// No token ⇒ no header (the server is fail-open / demo-disabled in that case). The token comes
// from WorkflowsConfig.authToken — the package never reads import.meta.env.
export const authHeaders = (token?: string): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test packages/react/src/authHeaders.test.ts`
Expected: PASS.

- [ ] **Step 5: Export from the barrel**

In `packages/react/src/index.ts`, add an export line (group it with the other small util/type exports):

```ts
export { authHeaders } from './authHeaders.js'
```

- [ ] **Step 6: Commit**

```bash
yarn lint
git add packages/react/src/authHeaders.ts packages/react/src/authHeaders.test.ts packages/react/src/index.ts
git commit -m "feat(7c-C): authHeaders helper in @atizar/react"
```

---

## Task 5: Add `authToken?` to `WorkflowsConfig`

**Files:**
- Modify: `packages/react/src/workflowsContext.tsx`

No new unit test (a pure type addition; consumed in Tasks 6–7). Typecheck is the gate.

- [ ] **Step 1: Add the optional field**

In `packages/react/src/workflowsContext.tsx`, extend the `WorkflowsConfig` type. Add the field after `hitl`:

```ts
export type WorkflowsConfig = {
  workflows: WorkflowDescriptor[]
  meta: Record<string, AgentMeta>
  renders: RenderSpec[]
  hitl: HitlSpec[]
  // Optional shared bearer token; merged into every mutation fetch. Unset in dev/demo. The
  // demo app sources it from VITE_ATIZAR_AUTH_TOKEN — the package stays env-agnostic.
  authToken?: string
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
yarn typecheck
yarn lint
git add packages/react/src/workflowsContext.tsx
git commit -m "feat(7c-C): authToken? on WorkflowsConfig"
```

---

## Task 6: Split `WorkflowBoard` so hooks sit inside the provider

**Files:**
- Modify: `packages/react/src/WorkflowBoard.tsx`

**Why:** `useDispatch()` (and `useBoard`/`useHealth`/`useActivity`) are called in `WorkflowBoard`'s body, while `<WorkflowsProvider>` currently wraps only the returned JSX — so those hooks run OUTSIDE the context and `useWorkflowsConfig()` would throw there. Splitting into a thin provider wrapper + `BoardInner` puts every hook inside the provider. Mechanical move, no logic change.

No unit test (structural; the existing `@atizar/react` tests + Task 8 browser E2E cover it). Typecheck + the existing test suite are the gate.

- [ ] **Step 1: Rename the component to `BoardInner` and add the wrapper**

In `packages/react/src/WorkflowBoard.tsx`:

1. Rename the current exported component declaration from
   `export const WorkflowBoard = ({ config, demo }: { config: WorkflowsConfig; demo?: boolean }) => {`
   to
   `const BoardInner = ({ config, demo }: { config: WorkflowsConfig; demo?: boolean }) => {`
   (drop `export`, rename to `BoardInner`).

2. In `BoardInner`'s returned JSX, REMOVE the outer `<WorkflowsProvider config={config}>` open tag (currently the first element after `return (`) and its matching `</WorkflowsProvider>` close tag (the last element before `)`). The `<div className='app'>…</div>` becomes the single returned root.

3. At the bottom of the file (after `BoardInner` closes), add the new thin exported wrapper:

```tsx
export const WorkflowBoard = ({ config, demo }: { config: WorkflowsConfig; demo?: boolean }) => (
  <WorkflowsProvider config={config}>
    <BoardInner config={config} demo={demo} />
  </WorkflowsProvider>
)
```

The existing `import { WorkflowsProvider, type WorkflowsConfig } from './workflowsContext'` stays.

- [ ] **Step 2: Typecheck + run the react test suite**

Run: `yarn typecheck`
Expected: PASS.
Run: `yarn test packages/react`
Expected: PASS (no regressions — the provider now wraps the same tree, just one level up).

- [ ] **Step 3: Commit**

```bash
yarn lint
git add packages/react/src/WorkflowBoard.tsx
git commit -m "refactor(7c-C): split WorkflowBoard into provider wrapper + BoardInner"
```

---

## Task 7: Thread the token into the mutation fetches

**Files:**
- Modify: `packages/react/src/hooks/useDispatch.ts`
- Modify: `packages/react/src/hooks/useGate.ts`
- Modify: `packages/react/src/components/Connections.tsx`

No new unit test (the fetch-header merge is exercised by the Task 8 browser E2E; the existing hook tests must stay green). After this task `useDispatch`/`useGate`/`Connections` all read `authToken` from `useWorkflowsConfig()`.

- [ ] **Step 1: `useDispatch` — read the token, merge headers, guard `res.ok`**

Rewrite `packages/react/src/hooks/useDispatch.ts` to:

```ts
import { useCallback } from 'react'
import type { Destination } from '@atizar/core'
import { useWorkflowsConfig } from '../workflowsContext'
import { authHeaders } from '../authHeaders'

// The act surface: every mutation is a plain HTTP POST (no CopilotKit transport).
//   start  — the human-initiated START gesture on an input agent card
//   deliver — a human-gated handoff from a rendered card (server resolves the Destination)
//   cancel / cancelWorkflow — Stop a work item / a whole workflow
// Each mutation carries the shared bearer token (if configured) so a deployed instance with
// ATIZAR_AUTH_TOKEN set accepts it; unset ⇒ no header (server is fail-open / demo-disabled).
export const useDispatch = () => {
  const { authToken } = useWorkflowsConfig()

  const start = useCallback(
    async (agentKey: string): Promise<string> => {
      const res = await fetch('/api/dispatch', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders(authToken) },
        body: JSON.stringify({ agent: agentKey }),
      })
      if (!res.ok) throw new Error(`dispatch failed: ${res.status}`)
      const { id } = (await res.json()) as { id: string }
      return id
    },
    [authToken]
  )

  const deliver = useCallback(
    async (origin: string, dest: Destination, payload: unknown, parentId: string): Promise<void> => {
      await fetch('/api/deliver', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders(authToken) },
        body: JSON.stringify({ origin, dest, payload, parentId }),
      })
    },
    [authToken]
  )

  const cancel = useCallback(
    async (id: string): Promise<void> => {
      await fetch(`/api/workitems/${id}/cancel`, { method: 'POST', headers: authHeaders(authToken) })
    },
    [authToken]
  )

  const cancelWorkflow = useCallback(
    async (id: string): Promise<void> => {
      await fetch(`/api/workflows/${id}/cancel`, { method: 'POST', headers: authHeaders(authToken) })
    },
    [authToken]
  )

  // Emergency brake: halt every active item across ALL workflows.
  const cancelAll = useCallback(async (): Promise<void> => {
    await fetch('/api/cancel-all', { method: 'POST', headers: authHeaders(authToken) })
  }, [authToken])

  return { start, deliver, cancel, cancelWorkflow, cancelAll }
}
```

- [ ] **Step 2: `useGate` — merge headers on resolve**

In `packages/react/src/hooks/useGate.ts`, add the two imports at the top (after the existing `import type { Gate }` line):

```ts
import { useWorkflowsConfig } from '../workflowsContext'
import { authHeaders } from '../authHeaders'
```

Inside the `useGate` hook body, after `const [gate, setGate] = useState<Gate | null>(null)`, add:

```ts
  const { authToken } = useWorkflowsConfig()
```

In the `resolve` callback, change the resolve `fetch` headers from
`headers: { 'content-type': 'application/json' },`
to
`headers: { 'content-type': 'application/json', ...authHeaders(authToken) },`
and add `authToken` to the `resolve` `useCallback` dependency array (it currently is `[gate, refetch]` → make it `[gate, refetch, authToken]`).

(The two read fetches — `refetch` and the effect — stay header-less: they are GET, always open.)

- [ ] **Step 3: `Connections` — merge headers on disconnect**

Rewrite `packages/react/src/components/Connections.tsx`:

```tsx
import { useConnections, type ConnectionStatus } from '../hooks/useConnections.js'
import { ConnectionChip } from './ConnectionChip.js'
import { useWorkflowsConfig } from '../workflowsContext.js'
import { authHeaders } from '../authHeaders.js'

// The Connections panel: lists every required integration with its chip. A Disconnect on a
// row DELETEs the connection then refetches the snapshot. Self-fetches — no props needed.
export const Connections = () => {
  const { connections, refetch } = useConnections()
  const { authToken } = useWorkflowsConfig()

  const disconnect = async (c: ConnectionStatus): Promise<void> => {
    await fetch(
      `/api/connections/${encodeURIComponent(c.integration)}?connection=${encodeURIComponent(
        c.connection
      )}`,
      { method: 'DELETE', headers: authHeaders(authToken) }
    )
    refetch()
  }

  return (
    <div className='conn-list'>
      {connections.map((c) => (
        <ConnectionChip
          key={`${c.integration}:${c.connection}`}
          connection={c}
          onDisconnect={() => void disconnect(c)}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Typecheck + run the react test suite**

Run: `yarn typecheck`
Expected: PASS.
Run: `yarn test packages/react`
Expected: PASS (hooks now call `useWorkflowsConfig`; they render within the provider after Task 6, so existing tests that mount them through `WorkflowBoard`/provider stay green. If a hook is unit-tested in isolation WITHOUT a provider, wrap it in `<WorkflowsProvider config={…}>` in that test — note the file and fix.)

- [ ] **Step 5: Commit**

```bash
yarn lint
git add packages/react/src/hooks/useDispatch.ts packages/react/src/hooks/useGate.ts packages/react/src/components/Connections.tsx
git commit -m "feat(7c-C): thread bearer token into client mutation fetches"
```

---

## Task 8: Demo app sources the token from `VITE_ATIZAR_AUTH_TOKEN`

**Files:**
- Modify: `apps/inbox/client/src/workflows.ts`

- [ ] **Step 1: Set `authToken` on the demo's `workflowsConfig`**

In `apps/inbox/client/src/workflows.ts`, in the `workflowsConfig` object literal, add the `authToken` field after `hitl: hitlSpecs,`:

```ts
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

- [ ] **Step 2: Typecheck**

Run: `yarn typecheck`
Expected: PASS. (Vite injects `import.meta.env`; if the app's tsconfig lacks `vite/client` types and `import.meta.env` errors, add `/// <reference types="vite/client" />` at the top of the file — note it if needed.)

- [ ] **Step 3: Commit**

```bash
yarn lint
git add apps/inbox/client/src/workflows.ts
git commit -m "feat(7c-C): demo app sources authToken from VITE_ATIZAR_AUTH_TOKEN"
```

---

## Task 9: Correct the `resolvedBy` aspirational comment

**Files:**
- Modify: `packages/server/src/runObserver.ts` (around line 282)

- [ ] **Step 1: Update the comment**

Find the comment near line 282 that reads (approximately):

```ts
        // resolvedBy comes from the bearer-token identity at step 4; null in the dev path.
```

Replace it with:

```ts
        // resolvedBy stays null: the bearer token (7c-C) authorises but is a single SHARED
        // secret with no per-user identity. Per-identity attribution needs real auth (post-beta).
```

- [ ] **Step 2: Typecheck + commit**

```bash
yarn typecheck
yarn lint
git add packages/server/src/runObserver.ts
git commit -m "docs(7c-C): correct resolvedBy comment (shared token = no identity)"
```

---

## Task 10: Full verification + browser E2E

**Files:** none (verification only).

- [ ] **Step 1: Full green gate**

Run from repo root:

```bash
yarn typecheck && yarn lint && yarn test && yarn build
```

Expected: all green. (Test count should rise by the new auth + authHeaders + env cases.)

- [ ] **Step 2: Browser E2E — invoke the `browser-verify` skill first**

Use the `browser-verify` skill (kills stale dev stacks, frees ports, Playwright-MCP recovery). Then run the four scenarios from spec §8. Use the non-demo stack with `DEV_RECORD_REPLAY=1` and the lead-inbox cassette.

- [ ] **Step 3: Scenario 1 — token set + client matches → approve works**

Start the server with a token and the client with the matching build-time var:

```bash
# server
ATIZAR_AUTH_TOKEN=sek DEV_RECORD_REPLAY=1 yarn dev:server
# client (separate shell)
VITE_ATIZAR_AUTH_TOKEN=sek yarn dev:client
```

In the browser: START lead-inbox → qualifier runs → reply gate opens → edit the draft body to insert a marker → Approve. Expected: gate resolves, item `finished`, ledger one `{ok,draftId}` row. (Verify via the DB or the thread narration; delete the test Gmail draft if a real one was created — but under `DEV_RECORD_REPLAY=1` the effect path is the only real-Gmail touch; if it creates one, delete it.)

- [ ] **Step 4: Scenario 2 — token set + client wrong → 401, no false success**

Restart the client with a MISMATCHED token (`VITE_ATIZAR_AUTH_TOKEN=wrong yarn dev:client`), server still `ATIZAR_AUTH_TOKEN=sek`. Try to Approve a gate. Expected: the resolve POST returns `401`; the UI does NOT report success (gate stays open / surfaces the error). Confirm in the Network tab the request had `Authorization: Bearer wrong` and got `401`.

- [ ] **Step 5: Scenario 3 — plain `yarn dev` (no token) → warning + works**

Stop both. Run plain `DEV_RECORD_REPLAY=1 yarn dev`. Expected: server log shows `[auth] disabled — set ATIZAR_AUTH_TOKEN …`; START + approve work end-to-end (fail-open).

- [ ] **Step 6: Scenario 4 — `yarn demo` (token unset) → works**

Stop. Run `yarn workspace inbox demo` (DEMO=1, PGlite, no Postgres). Expected: Email-inbox tab only, everything works, no token needed (middleware inactive in demo). A token set in the demo env is ignored (not required).

- [ ] **Step 7: Update HANDOFF**

In `HANDOFF.md`, flip the 7c-C line under "Sub-projects C–F" to ✅ BUILT with a concise as-built note (env accessor; method-based middleware in `@atizar/server`; client token via `WorkflowsConfig`/`VITE_ATIZAR_AUTH_TOKEN`; `WorkflowBoard` split; `resolvedBy` stays null; the four E2E scenarios verified). Note that D is next.

```bash
git add HANDOFF.md
git commit -m "docs(handoff): 7c-C bearer token BUILT & browser-verified"
```

---

## Self-Review Notes

- **Spec coverage:** §1 env → Task 1; §2 middleware → Task 2; §3 wiring + warning → Task 3; §4 client (config field → Task 5, helper → Task 4, provider split → Task 6, fetch threading → Task 7, demo source → Task 8); §6 resolvedBy → Task 9; §8 testing → Tasks 2/4 (unit) + Task 10 (browser E2E); §9 files all covered; §10 foundation → run `check-foundation` during execution (auth is transport-edge; expected CLEAR). All sections mapped.
- **Type consistency:** `createAuthMiddleware({ token, demo })`, `authHeaders(token?)`, `WorkflowsConfig.authToken?: string`, `useWorkflowsConfig().authToken` — names consistent across Tasks 2/4/5/7/8.
- **Foundation:** run `check-foundation` once before Task 10 (or after Task 3) — touches the transport edge, not actions/providers/core boundary; token flows via the established config-injection pattern.
