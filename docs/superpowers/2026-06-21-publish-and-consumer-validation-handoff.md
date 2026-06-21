# Handoff — publish `@atizar/*` to npm + validate via a clean external consumer project

## Goal
Make the framework installable from npm and **prove it** by rebuilding a demo in a FRESH project that
depends ONLY on published packages (no monorepo, no `./src`). This is the gate before a public launch:
"can someone `npm install @atizar/*` and build/deploy their own thing?"

## Why this matters (the bugs it prevents)
This session hit a string of issues that a consumer would also hit: a hard-pinned macOS-only binary
(`@rolldown/binding-darwin-arm64`) breaking non-mac installs; `build:web` needing `tsc --build` first
for composite declarations; `@atizar/server` eagerly loading `@mastra/core`. A clean-project smoke
test + CI catches this whole class **before** anyone outside hits it.

## Current state (2026-06-21)
- **Live demo:** https://atizar.io on Fly (`feat/demo-site`, `DEMO=1`, one always-on 1GB machine). Works.
- **PR #2** (`feat/framework-extract` → master, https://github.com/Yaroshuk/atizar/pull/2): the generic
  framework changes (deploy seam: staticDir/PORT/bind-0.0.0.0; multi-tenant `sessionId` scoping;
  Mastra-free boot via the `@atizar/server/mastra` subpath; `AppHeader` logoSrc/brandHref; `session.ts`;
  recordReplay `keyOf` seam). **Merge this FIRST** — the packages you publish must include it.
- **Open e2e fix** (separate handoff: `docs/superpowers/2026-06-19-e2e-cassette-decouple-handoff.md`):
  `yarn ui` is red after the 2-reply cassette change. Get it green before/with publish.
- **Package readiness today:**
  - `@atizar/react` — HAS a real build (Vite lib mode → `dist/index.js` ESM + rolled-up `.d.ts` +
    `react.css` with the `--atz-*` tokens). Publishable shape; just remove `private`.
  - `@atizar/core`, `@atizar/providers`, `@atizar/server`, `@atizar/integrations` — `exports` point at
    raw `./src/*.ts`, `private: true`, **no build**. Need build + packaging.
- The monorepo consumes `./src` via the **`development` export condition**
  (`customConditions: ["development"]` in `tsconfig.base.json`); a normal consumer (no dev condition)
  must resolve `dist`. Preserve this trick per package.

## Work — in order

### Phase 1 — build steps for the 4 unbuilt packages
Mirror `@atizar/react` (`packages/react/vite.config.ts` + its `package.json`). For each of
`core`, `providers`, `server`, `integrations`:
- Add a build (Vite lib mode, or `tsc`) → `dist/index.js` (ESM) + rolled-up `dist/index.d.ts`.
  Externalize ALL peers/siblings (`@atizar/*`, `react`/`react-dom`, `zod`, `@ag-ui/client`,
  `@mastra/*`, `@ai-sdk/*`, `googleapis`, `drizzle-orm`, `hono`, `@hono/*`, `postgres`,
  `@electric-sql/pglite`, `@modelcontextprotocol/sdk`) — bundle nothing from node_modules.
- `package.json`: remove `private: true`; `exports` keep the `development` → `./src` condition AND add
  default `import`/`types` → `./dist` (same dual-condition pattern as react — monorepo dev uses src,
  consumers get dist). Add `files: ["dist"]`, `main`, `types`, `publishConfig: { access: "public" }`.
- Preserve the subpath exports, resolved to dist for consumers too: `@atizar/server` has `./db/schema`
  + `./mastra`; `@atizar/providers` has `./ids`; `@atizar/integrations` has `./gmail/*`.
- Per-package `outDir`/`tsBuildInfoFile` (CLAUDE.md): `core` owns the root `dist-types`; `providers` +
  `integrations` set package-local `outDir`/`tsBuildInfoFile` to avoid TS5055 collisions.
- Versions: probably bump to `0.1.0` (honest beta) — or keep `1.0.0` and publish under an npm dist-tag
  `next`/`beta` until stable. Confirm with the user.
- Build order = dependency order: `core` first; `providers`/`react`/`integrations`/`server` depend on it.

### Phase 2 — local consumer smoke test (do this BEFORE `npm publish`)
The key validation; uses `npm pack` so nothing hits npm until it works.
1. Build all packages (`yarn build:web` builds react + app; add the new package builds to a
   `build:packages` script).
2. `npm pack` each of the 5 → five `.tgz` tarballs.
3. Fresh project OUTSIDE the repo (e.g. `/tmp/atizar-consumer`): `npm init -y`; install the 5 tarballs
   (`npm i ./atizar-core-*.tgz ./atizar-react-*.tgz …`) + peers (`react`, `react-dom`, `zod`,
   `@ag-ui/client`) + a bundler (`vite`) + `tsx`.
4. Rebuild a MINIMAL demo there (NOT the full email-inbox — just enough to exercise the public API):
   - server: `createServer({ workflowServers, providerRegistry, buildProvider, … })` with ONE tiny
     workflow descriptor + the `mock`/inert provider + `DEMO`/replay (or one hand-written cassette).
   - client: mount the `@atizar/react` board + `WorkflowsProvider`.
   - Goal: prove `dist` resolution, type resolution, and that the **public API is sufficient** to build
     a workflow from scratch — with zero monorepo paths.
5. `vite build` + run. Iterate on packaging until it's green. This is where raw-`src`/broken-`exports`/
   missing-`files`/type-resolution problems surface.
6. Reference for the consumer: the **`add-workflow` skill** + `apps/inbox/workflows/email-inbox` is the
   template a real consumer follows.

### Phase 3 — publish + CI + consumer docs
- `npm publish` the 5 (core first). **User action:** `npm login` + own the `@atizar` org/scope on npm.
- **CI (GitHub Actions, ubuntu)** — two jobs:
  1. `yarn install --ignore-engines && yarn build:web && yarn typecheck && yarn test` (+ optionally
     `yarn ui` headless once e2e is green).
  2. **consumer-smoke**: `npm pack` → install tarballs in a temp dir → build a tiny consumer app.
  This auto-catches the regressions this session hit (platform binary, tsc order, raw src).
- **Consumer quickstart doc**: "install `@atizar/*` and build your first workflow" (npm-based, distinct
  from the monorepo dev guide). Generalize `docs/DEPLOY.md` (Dockerfile/fly.toml) into a reusable
  deploy template for a consumer's own app.

### Phase 4 — public-launch polish
- e2e green (the other handoff) — a red `yarn ui` reads badly for a public repo.
- Clean pre-existing lint/format on master (`packages/react/src/primitives/CardShell/CardShell.tsx`,
  `apps/inbox/e2e/fixtures.ts` rules-of-hooks, the few format warnings).
- README: add a GIF/screenshot of the live board + **link `https://atizar.io`**; consider the sharper
  Notion rewrite (leads on the server-executed-effect guarantee + engine-agnostic HITL).
- LICENSE / CONTRIBUTING / SECURITY already present — sanity-check.
- Confirm the deploy template actually deploys a consumer app (Fly/Render) with `build:web` + `DEMO`.

## Branch
New branch **`feat/publish` off `master`** AFTER PR #2 merges (packages must include the framework
changes). If PR #2 isn't merged yet, branch off `feat/framework-extract`. Keep `feat/demo-site`
(the deployed demo) out of scope.

## Definition of done
- A fresh external project builds AND runs a demo from packed/published `@atizar/*` — no monorepo, no
  `./src`.
- `yarn test` + `yarn ui` green; CI green on linux including the consumer-smoke job.
- The 5 packages are installable from npm; a quickstart doc walks a newcomer from `npm install` to a
  running workflow.

## Gotchas (CLAUDE.md — don't relearn)
- The `development` export condition is what lets the monorepo use `./src` while consumers get `dist` —
  preserve it for every package you build.
- Keep `@atizar/server`'s main import Mastra-free (`captureTool` lives behind `@atizar/server/mastra`);
  don't reintroduce a heavy eager dep.
- Never hard-pin a platform-specific native binary (the `@rolldown/binding-darwin-arm64` lesson) — let
  tools resolve per-platform via their own `optionalDependencies`.
- `build:web` runs `tsc --build` first so composite `.d.ts` exist before the react dts build — keep that
  ordering in any web/package build.
- `demo-cassettes/` = synthetic, committed; `.cassettes/` = real data, gitignored + hook-guarded.
- The agent cannot push `master` (auto-mode blocks it) — the human merges PRs.
