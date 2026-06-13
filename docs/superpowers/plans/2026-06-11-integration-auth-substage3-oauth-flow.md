# Integration Auth — Sub-stage 3: OAuth connect flow + Connections UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The in-app "Connect" mechanism (spec `docs/superpowers/specs/2026-06-11-integration-auth-contract-design.md` §4): OAuth connect/callback routes that write an encrypted token into the sub-stage-2 store, a Connections UI (the global-header Connect chip + a small Connections view), and the `claude-spawn` env pass-through so claude-cli's MCP children can `resolveCredential`. After this, an end user CONNECTS Gmail via a button instead of hand-placing files. NO skill change, NO gmail rewrite (sub-stages 4–5).

**Architecture:** Routes in `@atizar/server` (`connectRoutes.ts`, mounted by the app) build the provider auth URL from `oauthProvider(provider)` + `atizarEnv.oauthClient(provider)` + a signed `state`, redirect to the provider, and on callback exchange the code for tokens and `store.upsert`. The UI is in `@atizar/react` (a `Connections` surface + a header `ConnectionChip`) reading a new `GET /api/connections` status endpoint. `apps/inbox/server/claude-spawn.ts` passes `ATIZAR_SECRET_KEY`/`ATIZAR_DATABASE_URL`/`ATIZAR_CONNECTION` + the provider client envs to each spawned MCP child so it resolves the same credential.

**Tech Stack:** Hono routes + redirects, `fetch` (token exchange), Node `crypto` (HMAC state signing), React (the existing `@atizar/react` chrome), vitest, Playwright-MCP for browser E2E. yarn-classic, NO build step.

**Branch:** `feat/gmail-viewer`. Verify the branch; STOP if wrong.

**PREREQUISITE:** Sub-stages 1 + 2 BUILT (the contract types, `atizarEnv`, the `credentials` store, `resolveCredential`, `oauthProvider`, `.env.example`). **Keys required to run the browser E2E:** `ATIZAR_SECRET_KEY` (any random string), `ATIZAR_GOOGLE_CLIENT_ID`, `ATIZAR_GOOGLE_CLIENT_SECRET` (a Google Cloud OAuth **Web** client whose authorized redirect URI is `<ATIZAR_PUBLIC_URL>/api/connect/google/callback`, default `http://localhost:5173/...`). Unit tests need NO keys (fetch + store injected).

---

## CONTEXT FOR A FRESH AGENT

### What this is

Integration auth feature, sub-stage 3 — the user-facing "Connect" flow that makes the credential store (sub-stage 2) usable without files. The spec §4 + the §0 inversion (no hand-placed files; an end user clicks Connect, the token is stored encrypted) is what this builds.

### Invariants

- **I1/I2** — connecting is a HUMAN gesture (a button), never automatic. No machine action.
- **I3/I5** — routes/UI live outside core; `@atizar/server` owns the flow, `@atizar/react` the chrome. The connect flow is generic over `oauthProvider` (adding a provider = a descriptor entry, no flow change).

### Conventions (same as prior sub-stages)

English only; Prettier (`semi:false`/single quotes/`printWidth:100`); never `git add -A`; commit trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; TDD for logic; **`browser-verify` skill before any browser/dev work**. Sweep: `yarn typecheck && yarn test && yarn lint && yarn build`.

### The seams you touch (confirmed as-built)

- **`@atizar/server`:** `resolveCredential`/`registerResolver`, `makeCredentialStore(db)`, `oauthProvider(provider)` (→ `{ authUrl, tokenUrl }`), `atizarEnv` (`secretKey`/`oauthClient`/`connection`/`databaseUrl`), `db`. Routes are built in `createPipelineRoutes` style (Hono) — add a sibling `createConnectRoutes(deps)` and mount it in `apps/inbox/server/index.ts` alongside `createPipelineRoutes`.
- **`apps/inbox/server/index.ts`** — mounts routes (`app.route('/', createPipelineRoutes(pipeline))`). Add the connect routes + a `makeCredentialStore(db)` instance.
- **`apps/inbox/server/claude-spawn.ts`** — builds the spawn `env` (`const env = { ...process.env }; delete env.ANTHROPIC_API_KEY`). The child already inherits `process.env`, so `ATIZAR_*` flow through automatically — BUT verify, and if the spawn ever filters env, explicitly pass `ATIZAR_SECRET_KEY`/`ATIZAR_DATABASE_URL`/`ATIZAR_CONNECTION`/`ATIZAR_GOOGLE_CLIENT_*`. (The MCP child resolves credentials itself — sub-stage 5 makes gmail use it; this sub-stage just guarantees the env reaches the child.)
- **`@atizar/react`:** `WorkflowBoard` (the root), the header area (the F3 health work + Stage-4 chrome live here). Add a `Connections` view + a header `ConnectionChip`. The board snapshot already carries `agentHealth` (F3) — connection status can reuse that OR a dedicated `/api/connections` endpoint (this plan adds the endpoint for a clean per-integration status).
- **Vite proxy:** `/api` → `:4000` (in `apps/inbox/vite.config.ts`), so a browser hitting `http://localhost:5173/api/connect/...` reaches the server. The OAuth `redirect_uri` is built from `ATIZAR_PUBLIC_URL` (new, default `http://localhost:5173`).

### What sub-stage 3 does NOT do

No skill change (sub-stage 4), no gmail rewrite (sub-stage 5). Gmail still reads files until sub-stage 5 — so the browser E2E here proves the FLOW (connect → token row stored encrypted → status flips → disconnect), not yet that gmail USES the stored token. (You verify the stored row is correct + decryptable; gmail consuming it is sub-stage 5's E2E.)

---

## TASK 1: `ATIZAR_PUBLIC_URL` + state signing helper (TDD)

**Files:**
- Modify: `packages/server/src/env.ts` (+ its test) — add `publicUrl()`
- Create: `packages/server/src/oauthState.ts` + test

- [ ] **Step 1 (env):** add to `atizarEnv`: `publicUrl(): string { return process.env.ATIZAR_PUBLIC_URL || 'http://localhost:5173' }`. Add a test case. This is the origin the `redirect_uri` is built on.

- [ ] **Step 2 (state, TDD):** `oauthState.ts` — `signState(payload, key)` → a tamper-proof string (`base64url(json).base64url(hmacSHA256)`), `verifyState(state, key)` → the payload or `null` on a bad signature. Key = `atizarEnv.secretKey()`. Failing test first: round-trip a `{ integration, connection }` payload; a tampered state → `null`.

```ts
// oauthState.ts
import { createHmac } from 'node:crypto'
export function signState(payload: Record<string, string>, key: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', key).update(body).digest('base64url')
  return `${body}.${sig}`
}
export function verifyState(state: string, key: string): Record<string, string> | null {
  const [body, sig] = state.split('.')
  if (!body || !sig) return null
  const expected = createHmac('sha256', key).update(body).digest('base64url')
  if (sig !== expected) return null
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}
```

- [ ] **Step 3:** run both tests green; commit.

```bash
git add packages/server/src/env.ts packages/server/src/env.test.ts packages/server/src/oauthState.ts packages/server/src/oauthState.test.ts
git commit -m "feat(server): ATIZAR_PUBLIC_URL + signed OAuth state helper (auth sub-stage 3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK 2: connect routes (`createConnectRoutes`) (TDD where possible)

**Files:**
- Create: `packages/server/src/connectRoutes.ts`
- Test: `packages/server/src/connectRoutes.test.ts`
- Modify: `packages/server/src/index.ts` (export `createConnectRoutes`)

**Design:** `createConnectRoutes({ store })` → a Hono app with:
- `GET /api/connect/:provider?integration=<id>&connection=<id>` → look up `oauthProvider(provider)` (404 if unknown) + `atizarEnv.oauthClient(provider)` (500 "not configured" if no client id); build the auth URL: `authUrl?client_id=…&redirect_uri=<publicUrl>/api/connect/:provider/callback&response_type=code&access_type=offline&prompt=consent&scope=<the integration's scopes, space-joined>&state=<signState({integration, connection})>`. **Scopes come from the integration's `auth.scopes`** — but routes don't know integrations; pass a `scopesFor(integration) → string[]` resolver in deps (the app supplies it from the loaded workflows' integration `auth` decls). 302 to the auth URL.
- `GET /api/connect/:provider/callback?code=…&state=…` → `verifyState` (400 on bad state) → POST the provider `tokenUrl` (form-encoded `grant_type=authorization_code&code&client_id&client_secret&redirect_uri`) via injectable `fetchFn` → on `ok`, build the token JSON `{ accessToken, refreshToken, expiresAt }` → `store.upsert({ connectionId: state.connection, integration: state.integration, kind:'oauth2', secret: JSON.stringify(token), expiresAt })` → 302 to `<publicUrl>/?connected=<integration>`. On a non-ok exchange → 302 to `<publicUrl>/?connect_error=<integration>`.
- `GET /api/connections` → status per known (connection, integration): `{ integration, connection, connected: boolean, detail?: string }[]`. `connected` = a usable `resolveCredential` (or just "a row exists / env key set"). Deps supply the list of (integration, connection, auth) to report.
- `DELETE /api/connections/:integration?connection=<id>` → `store.remove(...)` → `{ ok: true }`.

> Unit-test the testable parts: state verify on callback (bad state → 400), the token-exchange→upsert path with an injected `fetchFn` + fake store (assert `store.upsert` got the right `{connectionId, integration, kind, secret}`), the auth-URL construction (contains client_id, redirect_uri, scope, state). The live Google round-trip is the browser E2E (Task 5).

- [ ] **Step 1: failing test** for: (a) callback with a tampered state → 400; (b) callback with a valid state + a fake `fetchFn` returning `{access_token, refresh_token, expires_in}` → `store.upsert` called with `kind:'oauth2'`, the right key, an encrypted-bound secret (here the store is faked so assert the JSON it received); (c) `GET /api/connect/google?...` → 302 with a `location` containing `client_id`, the redirect_uri, the scope, and a `state`. Use Hono's `app.request(...)` for route testing (check an existing routes test for the pattern, e.g. how `routes.ts` is tested if at all; if not, use `app.fetch(new Request(...))`).

- [ ] **Step 2: run, fail. Step 3: implement `connectRoutes.ts`** per the design. **Step 4: green + typecheck. Step 5: export + commit.**

```bash
git add packages/server/src/connectRoutes.ts packages/server/src/connectRoutes.test.ts packages/server/src/index.ts
git commit -m "feat(server): OAuth connect/callback + /api/connections routes (auth sub-stage 3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK 3: mount the routes + wire scopes/status from the app

**Files:**
- Modify: `apps/inbox/server/index.ts`
- Maybe create: `apps/inbox/server/connections.ts` (the app-side glue: which (integration, connection, auth) the loaded workflows require)

**Design:** the app knows its integrations' `auth` declarations (sub-stage 5 adds `auth` to the gmail integration; for THIS sub-stage, since gmail isn't rewritten yet, declare the required connections in a small app-side list so the flow is testable end-to-end). Build `createConnectRoutes({ store: makeCredentialStore(db), scopesFor, list })` and `app.route('/', connectRoutes)`.

- [ ] **Step 1:** in `index.ts`, construct `const store = makeCredentialStore(db)`; define `scopesFor(integration)` (for now a small map `{ gmail: ['https://www.googleapis.com/auth/gmail.modify'] }` — sub-stage 5 replaces this with the integration's own `auth.scopes`); define the `list` of `{ integration: 'gmail', connection: 'default', provider: 'google' }` to report on `/api/connections`. Mount `app.route('/', createConnectRoutes({ store, scopesFor, list }))`.

- [ ] **Step 2:** boot smoke — `set -a; . ./.env.local; set +a; yarn dev:server`, then `curl 'localhost:4000/api/connections'` → JSON (gmail not connected); `curl -sI 'localhost:4000/api/connect/google?integration=gmail&connection=default'` → 302 with a `location:` to accounts.google.com. (No real login yet — that's the browser E2E.)

- [ ] **Step 3: commit.**

```bash
git add apps/inbox/server/index.ts apps/inbox/server/connections.ts
git commit -m "feat(email-inbox app): mount connect routes + report gmail connection status (auth sub-stage 3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK 4: Connections UI — header chip + Connections view (`@atizar/react`)

**Files:**
- Create: `packages/react/src/hooks/useConnections.ts`
- Create: `packages/react/src/components/ConnectionChip.tsx`
- Create: `packages/react/src/components/Connections.tsx`
- Modify: `packages/react/src/WorkflowBoard.tsx` (render the chip in the header area) + barrel `index.ts`
- Test: `packages/react/src/components/Connections.test.tsx`

**Design:**
- `useConnections()` — fetches `GET /api/connections` (+ refetch on focus / after a `?connected=` redirect). Returns `{ connections, refetch }`.
- `ConnectionChip` — per required integration: `not connected → [Connect]` (an `<a href="/api/connect/:provider?integration=…&connection=default">`, a full navigation so the OAuth redirect works — NOT fetch); `connected → "<integration> ✓ <detail>"`; the same chip handles "reconnect" (a failed/expired status shows `[Reconnect]` → same href). A **Disconnect** affordance calls `DELETE /api/connections/:integration` then `refetch`.
- `Connections` — a small panel listing all rows with their chips (opened from the header). For the beta the header shows the chips for the CURRENT workflow's required integrations; the panel lists all.
- **Placement:** the connect ACTION is global (header), per spec §4 — a connection is per-integration, shared across workflows. The per-agent "needs Gmail" badge is the F3 work (Stage 4 of email-inbox) — this sub-stage adds the connect chip/panel; if the F3 badge isn't built yet, that's fine, the chip is the primary affordance.

- [ ] **Step 1: TDD `Connections`** — render with a fake `connections` (one connected, one not); assert the connected row shows the detail, the not-connected row shows a Connect link with the right href, and Disconnect calls the delete + refetch (mock fetch).

- [ ] **Step 2: implement** the hook + components; wire the chip into `WorkflowBoard`'s header; export from the barrel. Use the existing Smedja classes (generic primitives are Stage 4 of email-inbox; reuse current card/button classes).

- [ ] **Step 3:** `yarn typecheck && yarn test && yarn lint && yarn build` green. Commit.

```bash
git add packages/react/src/hooks/useConnections.ts packages/react/src/components/ConnectionChip.tsx packages/react/src/components/Connections.tsx packages/react/src/components/Connections.test.tsx packages/react/src/WorkflowBoard.tsx packages/react/src/index.ts
git commit -m "feat(react): Connections UI — header connect chip + panel (auth sub-stage 3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK 5: claude-spawn env pass-through + browser E2E

**Files:**
- Modify (verify): `apps/inbox/server/claude-spawn.ts`

- [ ] **Step 1:** confirm the spawn passes `ATIZAR_*` to MCP children. Today `claude-spawn.ts` does `const env = { ...process.env }; delete env.ANTHROPIC_API_KEY`. Since it spreads `process.env`, `ATIZAR_SECRET_KEY`/`ATIZAR_DATABASE_URL`/`ATIZAR_CONNECTION`/`ATIZAR_GOOGLE_*` already pass through — ADD a comment documenting that these MUST reach the child (so a future refactor that filters env doesn't silently break credential resolution in MCP children). If the spawn is per-agent and you want a per-agent `ATIZAR_CONNECTION`, set `env.ATIZAR_CONNECTION = <the agent's connection>` here (default `'default'` for the beta).

- [ ] **Step 2: browser E2E** (invoke `browser-verify` first; needs the real Google Web client env). With `.env.local` loaded:
  1. Open `http://localhost:5173`, go to a workflow that needs Gmail → the header chip shows **Gmail: not connected [Connect]**.
  2. Click Connect → redirected to Google → log in + consent → redirected back to `/?connected=gmail` → the chip flips to **Gmail ✓** (the account/detail shows).
  3. **Verify the stored row:** in `aiworkflow` DB, the `credentials` row `(default, gmail)` exists, `kind='oauth2'`, the `secret` column is the encrypted blob (NOT plaintext — `:`-joined base64), `expires_at` set. Decrypt via a one-off `tsx` using `resolveCredential` → returns a valid `accessToken`.
  4. **Disconnect** → the row is removed → the chip returns to "not connected".
  5. (Expiry path is unit-tested in sub-stage 2's refresh test; a live expiry is not forced here.)

> NOTE: gmail does NOT yet USE this token (it still reads files until sub-stage 5) — so do NOT expect email-inbox to run off the connected token in THIS sub-stage. The proof here is: connect → encrypted row stored → resolveCredential yields a live token → disconnect. Sub-stage 5's E2E proves gmail consuming it.

- [ ] **Step 3: commit** any spawn comment/tweak.

```bash
git add apps/inbox/server/claude-spawn.ts
git commit -m "chore(server): document ATIZAR_* env pass-through to MCP children for credential resolution (auth sub-stage 3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK 6: wrap-up — foundation check + docs

- [ ] **check-foundation:** connecting is a human gesture (I1); routes/UI outside core (I3/I5); the flow is generic over `oauthProvider` (a new provider = a descriptor entry). WARN → STOP.
- [ ] **HANDOFF:** "Sub-stage 3 ✅ BUILT — OAuth connect/callback + `/api/connections` routes, signed state, `ATIZAR_PUBLIC_URL`, the Connections UI (header chip + panel), claude-spawn env pass-through. End users connect Gmail via a button; the token is stored encrypted. NOT yet consumed by gmail (sub-stage 5). Next = sub-stage 4 (skill auth interview)." Record the browser E2E result + the keys setup (the Google Web client + the `.env.local` vars).
- [ ] **Final sweep** `yarn typecheck && yarn test && yarn lint && yarn build`; commit docs; final review (state signing prevents CSRF/tamper; the token is encrypted at rest; the connect link is a full navigation not a fetch; disconnect removes the row).

## SELF-REVIEW NOTES

- Spec §4 covered: routes (Task 2), UI (Task 4), claude-spawn pass-through (Task 5), connection-per-integration global chip (Task 4). Scopes come from the integration's `auth` — stubbed app-side here, replaced by the real `auth.scopes` in sub-stage 5.
- The connect link MUST be a real navigation (`<a href>`), not `fetch` — an OAuth redirect can't happen inside fetch.
- State is HMAC-signed (anti-tamper/CSRF) with `ATIZAR_SECRET_KEY`.
- gmail not consuming the token yet is called out so the E2E expectation is honest.
