# Demo-site deploy — design

**Date:** 2026-06-18 · **Branch:** `feat/demo-site` · **Status:** approved, pre-implementation

## Goal

Put the working `email-inbox` demo on a public URL under the project's domain
(`demo.atizar.io`), fronted by a small landing page (name + one-line pitch + feature sellers +
an "Open demo" button). A visitor clicks through the **real** pipeline — sorter → reply/reader/
spam/important — including a human approval gate, with zero credentials and zero external calls.

This reuses the **already-built** `DEMO=1` mode (PGlite in-memory DB + committed synthetic
`demo-cassettes/` + faked health + `email-inbox` only). No demo logic changes. The only gaps are
**packaging for a single-process host** and the **landing page**.

## Non-goals

- No GitHub Pages / static-only path (the client needs a live `/api/*` server; cassettes replay
  server-side). Rejected earlier in brainstorming.
- No npm package publish (separate track).
- No full marketing site for the apex `atizar.io` (kept for later; the apex is untouched here).
- No Docker (PGlite removes the DB container; the host's Node buildpack runs the process directly).
  A Dockerfile stays an optional later addition if a host needs it.

## Architecture

### 1. Server seams (`@atizar/server`, framework — generic mechanisms)

Two additions to `createServer` (`packages/server/src/createServer.ts`). Both are generic
("every deployed atizar app needs them"); the **policy/values are injected by the app**, so they
respect invariant I5.

- **Port from the host.** Replace the hardcoded `serve({ port: 4000 })` with
  `Number(process.env.PORT) || 4000`. `PORT` is a host/vendor convention (Render/Railway/Heroku),
  so per the env-namespace contract (`env.ts` header) it is read **without** the `ATIZAR_` prefix,
  same class as the legacy `DATABASE_URL`. No change to `atizarEnv`.

- **Static client serving.** Add an optional `staticDir?: string` to `CreateServerArgs`. When set,
  after the `/api` routes are registered, mount static serving for **non-`/api`** requests:
  - serve files from `staticDir` (built client assets), and
  - an SPA fallback: any unmatched non-`/api`, non-asset GET returns `staticDir/index.html`
    (so client-side routes like `/demo` deep-link correctly).
  - Implemented with `serveStatic` from `@hono/node-server/serve-static` (already a dep). The
    `/api` routes are registered **before** the static mount, so the catch-all never shadows the
    API. When `staticDir` is omitted, behavior is byte-identical to today (dev path unchanged —
    Vite still serves the client in `yarn dev`).

`check-foundation` runs on this change (touches `@atizar/server` + the framework/app boundary).
Expected: CLEAR — both are generic seams with app-injected values, no workflow literals enter the
framework.

### 2. Client landing route (`apps/inbox/client`, app)

Today `App.tsx` mounts `BoardApp` directly with no router. Introduce client-side routing:

- Add `react-router-dom`.
- `/` → `<Landing>` — a new presentational page: product name (ATIZAR), a one-line pitch, a short
  feature-seller list, and an **Open demo** button linking to `/demo`. Built via the
  `frontend-design` skill for a polished, non-generic look. Static content only — no server calls.
- `/demo` → the current board experience (the existing `/api/config` fetch + `BoardApp`, moved
  into a `Demo` route component unchanged).
- The SPA fallback (seam 1) serves `index.html` for both routes, so a direct hit on
  `demo.atizar.io/demo` works.

One build, one deploy, one origin. The "demo button" is a plain in-app link.

### 3. App wiring + deploy (`apps/inbox`, app)

- `apps/inbox/server/index.ts` passes `staticDir` resolved to the built client dir
  (`apps/inbox/dist`, resolved from the server file location) into `createServer`.
- A prod start script runs the server in demo mode as **one process**:
  `DEMO=1 tsx apps/inbox/server/index.ts` (tsx is already a root dep; it resolves the workspace
  `@atizar/*` `development` export condition = TS source — no package build needed). The host
  injects `PORT`.
- `README` (deploy section): Render service — Build `yarn install --ignore-engines && yarn build`,
  Start `DEMO=1 tsx apps/inbox/server/index.ts`; then a Namecheap DNS step — `demo` CNAME →
  the Render hostname. Note that `@electric-sql/pglite` is an optional dep of `@atizar/server` and
  must be installed on the host (default `yarn install` includes optional deps).

## Data flow (deployed, demo mode)

```
browser → demo.atizar.io (Render, one Node process)
  GET /                 → index.html → React Router → <Landing>
  click "Open demo"     → /demo (client route) → <Demo> → GET /api/config
  GET /api/board,/api/workitems/:id/stream (SSE), POST /api/dispatch,/api/gates/:id/resolve …
                        → Hono → PipelineService → PGlite (in-memory) + demo-cassettes (replay)
  GET /demo (deep link) → SPA fallback → index.html → React Router → <Demo>
  GET /assets/*         → serveStatic(dist)
```

Auth is off in demo (`auth.ts` — `active = !demo && token`), so approvals/dispatches work for an
anonymous visitor. PGlite is fresh per boot (no persistence) — acceptable for a demo; a restart
resets the board.

## Testing

- **Server (unit, PGlite):** `staticDir` set → a non-`/api` GET returns `index.html`; an unknown
  deep path (`/demo`) returns `index.html` (SPA fallback); `/api/config` still returns JSON (API
  not shadowed). `staticDir` omitted → no static routes mounted (dev path intact). PORT override
  asserted at the env-read level (avoid binding a real socket in unit tests).
- **Client (component):** `/` renders the landing (name + Open demo link); `/demo` renders the
  board mount. React Router with a memory router in tests.
- **Browser E2E (the only-the-browser set):** build the client, run the single-process
  `DEMO=1` server, then drive: load `/` → see landing → click Open demo → `/demo` board →
  start the email-inbox run → reach an approval gate → approve → see the resulting card.
  Plus a hard reload on `/demo` (SPA-fallback deep-link). Via the `browser-verify` skill.

## Boundary check (I5)

| Concern | Lives in | Why |
| --- | --- | --- |
| PORT from env, static-serving mechanism | `@atizar/server` (framework) | Generic — any deployed atizar app needs it; no workflow literals |
| `staticDir` value (`apps/inbox/dist`) | `apps/inbox/server` (app) | The path is this app's policy |
| Landing content / routes / look | `apps/inbox/client` (app) | Product/marketing content is app policy |
| Deploy commands + DNS | `README` (app/repo) | Operational, app-specific |

## Risks / open points

- `tsx` in prod: acceptable (it's how the app already runs); if a host disallows devDeps in prod,
  fall back to `NODE_ENV` leaving devDeps installed, or add a server build later. Documented, not
  built now.
- Render free tier sleeps on idle → first hit is slow (cold boot + migrations). Acceptable for a
  demo; note it in the README.
- Vite `base` stays default `/` (SPA served at origin root), so no asset-path rewrite needed.
```
