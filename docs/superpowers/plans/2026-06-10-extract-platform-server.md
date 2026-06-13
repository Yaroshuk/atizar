# Extract `@atizar/server` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task (inline, with green-gate checkpoints). This is a code-MOVE migration, not
> feature work — the existing 277-test suite + typecheck + lint + build + a browser E2E ARE the
> verification. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move the server pipeline engine (`apps/inbox/server/pipeline/`) into a new public
package `@atizar/server`, so the demo app consumes the server spine only through a versioned
package boundary — the first half of belief #3's physical framework/userland boundary (the second
half, `@atizar/react`, is a separate plan).

**Architecture:** No build step (the established `@atizar/*` pattern — `exports` points at
`./src/index.ts`; tsx/vitest/Vite transpile raw TS). The pipeline folder moves wholesale; a barrel
`index.ts` re-exports the public surface; the 7 app-side import sites repoint at `@atizar/server`;
3 config touchpoints (drizzle config, vitest globalSetup, app db scripts) follow the moved paths.
The one cross-boundary type (`EffectFn`) relocates to `@atizar/core` FIRST so the move is then
violation-free.

**Tech Stack:** yarn-classic workspace, TypeScript composite project refs, drizzle-orm + postgres,
hono, vitest. New package deps: `@atizar/core`, `@ag-ui/client`, `drizzle-orm`, `postgres`,
`hono`, `zod` (runtime); `@mastra/pg` is used ONLY by the test-DB global setup (test infra).

**Foundation note (run `check-foundation` before committing Task 4):** this REALIZES belief #3
(physical boundary) and does not touch beliefs #1/#2. `@atizar/server` depends on infra (db, http)
but imports NO engine at runtime (`@mastra/pg` appears only in `db/test-global-setup.ts`, test
infra) — belief #2 ("core knows no engine") is about `@atizar/core`, and is intact. No invariant
I1–I15 is weakened.

---

## File Structure (after the move)

```
packages/server/
  package.json            # new — name @atizar/server, exports ./src/index.ts
  tsconfig.json           # new — extends base, package-local outDir/tsBuildInfoFile (providers pattern)
  src/
    index.ts              # new — barrel: the public surface (see Task 2)
    dispatch.ts           # moved
    eventBus.ts           # moved
    pipelineService.ts    # moved
    routes.ts             # moved
    runObserver.ts        # moved (import of EffectFn repoints to @atizar/core in Task 0)
    stateStore.ts         # moved
    sweep.ts              # moved
    transition.ts         # moved
    workerPool.ts         # moved
    *.test.ts             # moved (9 files; vitest include `packages/*/src/**` already covers them)
    db/
      client.ts migrate.ts reset.ts schema.ts test-global-setup.ts   # moved
      migrations/         # moved (drizzle SQL)
```

App-side after the move:
- `apps/inbox/server/index.ts` — imports from `@atizar/server` (was `./pipeline/*`)
- `apps/inbox/server/providers.ts` — imports `databaseUrl` from `@atizar/server`
- `apps/inbox/server/agent-checks.ts` — imports `EffectFn` from `@atizar/core` (Task 0)
- `apps/inbox/workflows/server-binding.ts` — imports `EffectFn` from `@atizar/core` (Task 0)
- `apps/inbox/drizzle.config.ts` — schema/out paths point at `packages/server/src/db/*`
- `apps/inbox/package.json` — `db:migrate`/`db:reset` scripts repoint; add `@atizar/server: "*"`
- `vitest.config.ts` — globalSetup path repoints
- `tsconfig.json` (root) — add `{ "path": "./packages/server" }` reference

---

## Task 0: Relocate the `EffectFn` contract type to `@atizar/core`

`EffectFn` is the only thing pipeline imports from outside its folder (`runObserver.ts:10`,
`pipelineService.test.ts:17` → `../../workflows/server-binding.js`). It is a pure contract type
(the server-executed-effect signature) — it belongs in core next to `GateResolution`/`PromptStrategy`.
`ServerBinding` (which references workflow-specific prompts/allow-list) STAYS in userland and will
re-import `EffectFn` from core.

**Files:**
- Create: `packages/core/src/effects.ts`
- Modify: `packages/core/src/index.ts` (add export)
- Modify: `apps/inbox/workflows/server-binding.ts:1` (import EffectFn from core; drop local def)
- Modify: `apps/inbox/server/agent-checks.ts:2`
- Modify: `apps/inbox/server/pipeline/runObserver.ts:10`
- Modify: `apps/inbox/server/pipeline/pipelineService.test.ts:17`

- [ ] **Step 1: Create `packages/core/src/effects.ts`** with the verbatim type:

```ts
// A server-executed effect: keyed by APPROVAL tool name, called by the server on approve
// with the gate form (the edited artifact = the args) + context. Returns the result that
// becomes the ledger entry + the resume narrative. The model never sees this function.
export type EffectFn = (
  form: Record<string, unknown>,
  ctx: { workItemId: string; gateId: string }
) => Promise<Record<string, unknown>>
```

- [ ] **Step 2: Export it from the core barrel.** In `packages/core/src/index.ts` add (group with
  the other contract exports):

```ts
export type { EffectFn } from './effects.js'
```

(Confirm the barrel's existing style — if it uses `export * from './x.js'` for some modules, match
whichever is dominant; `export type { … }` is correct for a type-only module.)

- [ ] **Step 3: Rewrite `apps/inbox/workflows/server-binding.ts`** — remove the local `EffectFn`
  definition, import it from core, keep `ServerBinding`:

```ts
import type { PromptStrategy, EffectFn } from '@atizar/core'

export type { EffectFn }

// Per-agent server runtime binding for a workflow placement: the prompt strategy +
// the fully-qualified MCP allow-list (the single-entry-point boundary). `origin` (the
// workflow id) is woven into handoff-emitting render prompts by the prompts factory.
export type ServerBinding = {
  agentId: string
  prompts: PromptStrategy
  allowedTools: string[]
  effects?: Record<string, EffectFn>
}
```

(The `export type { EffectFn }` re-export keeps any existing `server-binding` EffectFn importers
working; the two pipeline files are repointed to core directly in Step 4 so pipeline has zero
out-of-folder imports before the move.)

- [ ] **Step 4: Repoint the three other importers to core directly.**
  - `apps/inbox/server/agent-checks.ts:2` → `import type { EffectFn } from '@atizar/core'`
  - `apps/inbox/server/pipeline/runObserver.ts:10` → `import type { EffectFn } from '@atizar/core'`
  - `apps/inbox/server/pipeline/pipelineService.test.ts:17` → `import type { EffectFn } from '@atizar/core'`

- [ ] **Step 5: Green gate.**

Run: `yarn typecheck && yarn test && yarn lint`
Expected: typecheck clean; all 277 tests pass; lint green. (No behavior changed — type moved only.)

- [ ] **Step 6: Commit.**

```bash
git add packages/core/src/effects.ts packages/core/src/index.ts \
  apps/inbox/workflows/server-binding.ts apps/inbox/server/agent-checks.ts \
  apps/inbox/server/pipeline/runObserver.ts apps/inbox/server/pipeline/pipelineService.test.ts
git commit -m "refactor(core): relocate EffectFn contract type to @atizar/core

EffectFn is a pure server-effect signature, not a userland concept; moving it
out of apps/inbox/workflows removes the only out-of-folder import in server/pipeline/,
making the @atizar/server extraction a clean move.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 1: Scaffold the empty `@atizar/server` package

**Files:**
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/src/index.ts` (temporary empty placeholder)
- Modify: `tsconfig.json` (root — add the project reference)

- [ ] **Step 1: Create `packages/server/package.json`:**

```json
{
  "name": "@atizar/server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./db/schema": "./src/db/schema.ts"
  },
  "dependencies": {
    "@ag-ui/client": "^0.0.55",
    "@atizar/core": "*",
    "drizzle-orm": "^0.45.2",
    "hono": "^4.12.23",
    "postgres": "^3.4.9",
    "zod": "^3.25.76"
  }
}
```

(The `./db/schema` subpath export gives drizzle-kit a stable path to the schema. `@mastra/pg` is
NOT a runtime dep — it is used only in `db/test-global-setup.ts`, which runs under the root vitest
where `@mastra/pg` is already resolvable from the workspace; if typecheck complains, add it to root
devDeps, not here. Verify in Task 3.)

- [ ] **Step 2: Create `packages/server/tsconfig.json`** (providers pattern — package-local outDir
  to avoid the TS5055 dist-types collision documented in CLAUDE.md):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist-types",
    "tsBuildInfoFile": "dist-types/tsconfig.tsbuildinfo",
    "types": ["node"]
  },
  "include": ["src"],
  "references": [{ "path": "../core" }]
}
```

- [ ] **Step 3: Create a placeholder `packages/server/src/index.ts`:**

```ts
export {}
```

- [ ] **Step 4: Add the root project reference.** In `tsconfig.json` (root) add to `references`
  (order before apps/inbox):

```json
    { "path": "./packages/server" },
```

- [ ] **Step 5: Install + green gate.**

Run: `yarn install --ignore-engines && yarn typecheck`
Expected: install links `@atizar/server`; typecheck clean (nothing imports the empty package yet).

- [ ] **Step 6: Commit.**

```bash
git add packages/server/package.json packages/server/tsconfig.json \
  packages/server/src/index.ts tsconfig.json package.json yarn.lock
git commit -m "chore(server): scaffold empty @atizar/server package

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Move the pipeline folder into the package + write the barrel

**Files:**
- Move (git mv): every file under `apps/inbox/server/pipeline/` → `packages/server/src/`
- Rewrite: `packages/server/src/index.ts` (the real barrel)

- [ ] **Step 1: Move the tree with `git mv` (preserves history).** From the repo root:

```bash
git mv apps/inbox/server/pipeline/dispatch.ts        packages/server/src/dispatch.ts
git mv apps/inbox/server/pipeline/eventBus.ts        packages/server/src/eventBus.ts
git mv apps/inbox/server/pipeline/pipelineService.ts packages/server/src/pipelineService.ts
git mv apps/inbox/server/pipeline/routes.ts          packages/server/src/routes.ts
git mv apps/inbox/server/pipeline/runObserver.ts     packages/server/src/runObserver.ts
git mv apps/inbox/server/pipeline/stateStore.ts      packages/server/src/stateStore.ts
git mv apps/inbox/server/pipeline/sweep.ts           packages/server/src/sweep.ts
git mv apps/inbox/server/pipeline/transition.ts      packages/server/src/transition.ts
git mv apps/inbox/server/pipeline/workerPool.ts      packages/server/src/workerPool.ts
# tests
git mv apps/inbox/server/pipeline/dispatch.test.ts        packages/server/src/dispatch.test.ts
git mv apps/inbox/server/pipeline/pipelineService.test.ts packages/server/src/pipelineService.test.ts
git mv apps/inbox/server/pipeline/stateStore.test.ts      packages/server/src/stateStore.test.ts
git mv apps/inbox/server/pipeline/transition.test.ts      packages/server/src/transition.test.ts
git mv apps/inbox/server/pipeline/workerPool.test.ts      packages/server/src/workerPool.test.ts
# (run `git status` — move EVERY remaining *.test.ts under pipeline/ the same way; there were 9)
# db
git mv apps/inbox/server/pipeline/db packages/server/src/db
```

After moving, run `git status` and confirm `apps/inbox/server/pipeline/` is EMPTY (then it
disappears). If any `.test.ts` was missed, `git mv` it too.

- [ ] **Step 2: Verify intra-package relative imports survived.** The moved files import each other
  via `./x.js` / `./db/x.js` — those resolve identically inside `packages/server/src/`. Confirm
  none reach out with `../../` (there should be none after Task 0):

Run: `grep -rn "from '\.\./\.\." packages/server/src` — Expected: NO results.

- [ ] **Step 3: Confirm the only `@atizar/*` imports are core.** The moved code imports
  `@atizar/core` (fine). It must NOT import `@atizar/providers`/`integrations`/back into
  `apps/inbox`:

Run: `grep -rn "@atizar/" packages/server/src | grep -v "@atizar/core"` — Expected: NO results.

- [ ] **Step 4: Write the real barrel `packages/server/src/index.ts`** — re-export exactly the
  surface the app consumes (from the consumer audit: `db`, `runMigrations`, `startupSweep`,
  `makePipelineService`, `createPipelineRoutes`, `databaseUrl`, type `AgentRuntime`; plus
  `PipelineService` type, `resetDb` for the db:reset script):

```ts
// @atizar/server — the server-authoritative pipeline engine (StateStore, dispatch,
// transition, WorkerPool, RunObserver, gate-keyed resolve, board/thread HTTP+SSE).
// Public surface consumed by the app's composition root.
export { db, databaseUrl } from './db/client.js'
export { runMigrations } from './db/migrate.js'
export { resetDb } from './db/reset.js'
export { startupSweep } from './sweep.js'
export { makePipelineService } from './pipelineService.js'
export type { PipelineService } from './pipelineService.js'
export { createPipelineRoutes } from './routes.js'
export type { AgentRuntime } from './runObserver.js'
```

(Cross-check each export name against the moved file — e.g. confirm `client.ts` exports both `db`
and `databaseUrl`, `reset.ts` exports `resetDb`. Adjust names to match the actual moved code; do
NOT invent. If `routes.ts` also needs a type export the app uses, add it.)

- [ ] **Step 5: Update `apps/inbox/drizzle.config.ts`** schema + out paths:

```ts
export default defineConfig({
  dialect: 'postgresql',
  schema: '../../packages/server/src/db/schema.ts',
  out: '../../packages/server/src/db/migrations',
  dbCredentials: { url: DATABASE_URL },
})
```

- [ ] **Step 6: Update `vitest.config.ts` globalSetup path:**

```ts
    globalSetup: ['./packages/server/src/db/test-global-setup.ts'],
```

- [ ] **Step 7: Update `apps/inbox/package.json` db scripts** (they pointed at `server/pipeline/db`):

```json
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx -e \"import('@atizar/server').then(m=>m.runMigrations()).then(()=>process.exit(0))\"",
    "db:reset": "tsx -e \"import('@atizar/server').then(m=>m.resetDb()).then(()=>process.exit(0))\"",
```

(`drizzle-kit generate` reads `drizzle.config.ts` which now points at the package — no change to
that line beyond the config update in Step 5. Confirm `migrate.ts` exports `runMigrations` as a
callable with no required args; if its current top-level form runs on import, keep a thin export
that the `-e` import can call, or leave `db:migrate` pointing at the file via a subpath. Match
actual code.)

- [ ] **Step 8: Typecheck the package in isolation** (catches barrel name mismatches early):

Run: `yarn workspace @atizar/server exec tsc --build` (or `yarn typecheck` for the whole graph)
Expected: clean. Fix any export-name mismatch in the barrel against the real moved code.

- [ ] **Step 9: Commit (WIP — app still references old paths; that's Task 3).**

```bash
git add -A packages/server apps/inbox/drizzle.config.ts apps/inbox/package.json vitest.config.ts
git commit -m "refactor(server): move server/pipeline into @atizar/server + barrel

Wholesale git-mv of the pipeline engine; barrel re-exports the app-consumed surface;
drizzle config, vitest globalSetup, and db scripts follow the moved paths. App import
sites repointed in the next commit.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(Note: `git add -A` is acceptable here because the move is the whole change set; the user's
parallel doc edits — `docs/ARCHITECTURE.md`, `docs/PHILOSOPHY.md` — are unrelated paths. Still,
prefer staging the explicit paths above; verify `git status` shows no stray doc files staged.)

---

## Task 3: Repoint the app's import sites at `@atizar/server`

**Files:**
- Modify: `apps/inbox/server/index.ts:7-12`
- Modify: `apps/inbox/server/providers.ts:9`
- Modify: `apps/inbox/package.json` (add the dep)

- [ ] **Step 1: Add the package dependency.** In `apps/inbox/package.json` dependencies (alongside
  the other `@atizar/*`):

```json
    "@atizar/server": "*",
```

Run: `yarn install --ignore-engines`

- [ ] **Step 2: Rewrite `apps/inbox/server/index.ts:7-12`** — collapse the 6 deep imports into the
  package barrel:

```ts
import {
  db,
  runMigrations,
  startupSweep,
  makePipelineService,
  createPipelineRoutes,
} from '@atizar/server'
import type { AgentRuntime } from '@atizar/server'
```

(Keep the import ordering/grouping the file already uses; match the existing convention.)

- [ ] **Step 3: Rewrite `apps/inbox/server/providers.ts:9`:**

```ts
import { databaseUrl } from '@atizar/server'
```

- [ ] **Step 4: Full green gate.**

Run: `yarn typecheck && yarn test && yarn lint && yarn build && yarn format:check`
Expected: typecheck clean; all 277 tests pass (DB tests hit `aiworkflow_test` via the moved
globalSetup — confirm the path update in Task 2 Step 6 took); lint green; vite build succeeds;
prettier clean. If a moved test file's relative import to a fixture broke, fix it.

- [ ] **Step 5: Commit.**

```bash
git add apps/inbox/server/index.ts apps/inbox/server/providers.ts apps/inbox/package.json yarn.lock
git commit -m "refactor(inbox): consume the pipeline engine via @atizar/server

The demo server now imports the spine only through the package barrel — the
framework/userland boundary is physical (belief #3) for the server half.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Browser E2E + foundation check + handoff update

The unit suite provably misses this codebase's bug class (CLAUDE.md). The extraction touched the
DB boot path, the SSE routes, and the db scripts — drive the real app.

- [ ] **Step 1: Run `check-foundation`** over the diff (server extraction). Expected: PASS —
  realizes belief #3, no engine import added to core, no invariant weakened. Record the verdict.

- [ ] **Step 2: Invoke the `browser-verify` skill** (kills stale dev stacks, frees :4000/:5173,
  recovers the Playwright-MCP lock per its references). Then `DEV_RECORD_REPLAY=1 yarn dev`.

- [ ] **Step 3: Verify the full server-driven flow** (the step-6 checklist, now through the
  package) on `http://localhost:5173`:
  - Board loads (board snapshot + SSE) — confirms `@atizar/server` routes mounted + DB migrate-on-boot ran.
  - START a single run → qualifier runs → Done.
  - Handoff → reply child nested under the qualifier; parent reopens to Working.
  - Approve WITH an edited gate body → real Gmail draft saved with the edit (the load-bearing path;
    effect runs OUTSIDE record/replay → hits real Gmail draft-only — delete the test draft after).
  - Reject → `finished`/`rejected`, zero ledger rows.
  - Stop (UI button) → `finished`/`cancelled`, gate 404.
  - Reload mid-thread (`?open=<id>`) → full thread + gate rebuilt from trace/gate endpoints.

- [ ] **Step 4: Verify `db:reset` + `db:migrate` scripts still work** (they were repointed):

Run: `yarn workspace inbox db:reset && yarn workspace inbox db:migrate`
Expected: both succeed against the dev DB (tables dropped + recreated, migrations applied).

- [ ] **Step 5: Update `HANDOFF.md`** — mark step 7's first sub-step (`@atizar/server`
  extraction) ✅ BUILT & browser-verified with an As-built note (commits, what moved, the
  `EffectFn`→core relocation, the 3 config touchpoints); note the next sub-step is the
  `@atizar/react` extraction, which starts with a brainstorm on the card-injection API
  (`registerCard` registry vs props/context) because `ThreadModal` currently couples to the demo's
  `renderRegistry` + `workflows` aggregator.

- [ ] **Step 6: Commit the HANDOFF update.**

```bash
git add HANDOFF.md
git commit -m "docs(handoff): @atizar/server extracted & browser-verified; next = @atizar/react

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review checklist (run before declaring the plan done)

- **Spec coverage:** the HANDOFF step-7 line "FIRST extract `apps/inbox/server/pipeline/` →
  `@atizar/server`" + "the import discipline held: `server/pipeline/` imports only `@atizar/*`
  + its own folder" → Tasks 0–3. The `@atizar/react` half is explicitly OUT of this plan (its own
  brainstorm + plan). ✅
- **Import-discipline micro-decisions honored:** package-local outDir/tsBuildInfoFile (CLAUDE.md
  TS5055 gotcha) — Task 1 Step 2. ✅
- **Breakage points covered:** drizzle config (T2.S5), vitest globalSetup (T2.S6), db scripts
  (T2.S7), root tsconfig ref (T1.S4), the `@mastra/pg` test-only dep flagged (T1.S1). ✅
- **No invented names:** the barrel (T2.S4) is explicitly "cross-check against the actual moved
  code; do NOT invent" — the executor verifies `databaseUrl`/`resetDb`/`runMigrations`/`AgentRuntime`
  against the real files. ✅
- **Browser E2E required** (T4) — the project's hard rule; unit tests miss this bug class. ✅
```
