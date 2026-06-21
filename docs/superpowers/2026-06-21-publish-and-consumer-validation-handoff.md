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

## Current state (updated 2026-06-21 — Phase 1 + 2 DONE on `chore/publish-prep-readme`)
- **Live demo:** https://atizar.io on Fly (`feat/demo-site`, `DEMO=1`, one always-on 1GB machine). Works.
- **PR #2 — MERGED.** `master` is at `fe083bd Merge pull request #2`. The generic framework changes
  (deploy seam staticDir/PORT/0.0.0.0; multi-tenant `sessionId`; Mastra-free boot via
  `@atizar/server/mastra`; `AppHeader` logoSrc/brandHref; `session.ts`; recordReplay `keyOf`) are all
  in master.
- **e2e fix — DONE** (`ab255c2`): `yarn ui` is green under the 2-reply cassettes. The
  `2026-06-19-e2e-cassette-decouple-handoff.md` is closed.
- **Phase 1 (packaging) — DONE** (`706af61`): all 5 packages `0.1.0`, `private:false`, MIT,
  `files:["dist"]`, internal deps `^0.1.0`. `core`/`providers`/`server`/`react` build via Vite lib mode
  → `dist/` (ESM + rolled-up `.d.ts`; react also ships `react.css`). `integrations` ships compiled
  `src/**/*.mjs`+`.d.ts`. Root `build:lib` script. The `development` export condition (src in monorepo,
  dist for consumers) is preserved per package — keep it.
- **README polish — DONE** (`706af61`/`0491cd3`/`bdb04cf`): atizar.io links, self-host section,
  runnable Quick start.
- **Phase 2 (consumer smoke test) — DONE this session** (see the block below). A fresh external project
  built + ran the full approve→executed→done pipeline from packed tarballs; surfaced + fixed two real
  packaging bugs.

### Phase 2 results + the two packaging fixes (committed on `chore/publish-prep-readme`)
A throwaway consumer at `/private/tmp/atizar-consumer` (one mock-provider workflow, no monorepo paths)
installed the 5 tarballs and proved: tarball cross-resolution of `@atizar/*`, `tsc --noEmit` from
`dist/*.d.ts`, `vite build` of the client (react dist + the 64 kB CSS bundle in a foreign Vite), server
boot in DEMO (PGlite), and the full `dispatch → gate → approve → executed saveDraft → done` path.
Two bugs found and fixed:
- **Migrations weren't shipped.** The bundler doesn't emit the drizzle SQL + `meta/_journal.json`, so
  `createServer({ start:true })` crashed at boot (`Can't find meta/_journal.json`). Fix: a
  `copyMigrations` Vite plugin copies `src/db/migrations` → `dist/migrations` (resolved at
  `dirname(import.meta.url)/migrations` = `dist/migrations` after bundling). `packages/server/vite.config.ts`.
- **Mastra forced on every consumer.** `@mastra/core`/`@mastra/pg`/`@ai-sdk/anthropic` were hard deps,
  and `@atizar/providers`' main index statically re-exported `mastraRunner` (which imports `@mastra/*` as
  runtime values) — so even a mock consumer crashed at import / pulled all of Mastra. Fix: those are now
  optional `peerDependencies`, and the Mastra provider+runner moved behind a new
  **`@atizar/providers/mastra`** subpath (mirrors `@atizar/server/mastra`); the main entry is Mastra-free.
  A mock/claude-cli consumer no longer installs `@mastra` at all; `@electric-sql/pglite` auto-resolves as
  an optional dep. Files: `packages/providers/{package.json,vite.config.ts,src/index.ts,src/mastra.ts}`,
  `packages/server/package.json`, `apps/inbox/server/providers.ts`.
- **Note:** building requires Node ≥20.19/22 (vite8/rolldown native binding); on Node 20.14 the binding
  is skipped (environment, not a defect). The smoke ran under Node 22.22 via nvm.
- Green gate after the fixes: typecheck ✅, test 734 (3 known flaky timeouts under load — green in
  isolation) ✅, lint ✅, format (changed files) ✅.

## Work — in order

### Phase 1 — build steps for the 4 unbuilt packages — ✅ DONE (`706af61`)
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

### Phase 2 — local consumer smoke test (do this BEFORE `npm publish`) — ✅ DONE (see Current state)
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
