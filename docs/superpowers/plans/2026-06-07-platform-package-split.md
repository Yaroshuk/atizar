# @platform/* Package Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a yarn-classic workspace and split `apps/inbox/core/` into three packages — `@platform/core` (contract), `@platform/providers` (claude-cli + mock), `@platform/integrations` (node-only batteries with a `./gmail-basic` subpath, `googleapis` as an optional peer) — with no behavior change.

**Architecture:** A root npm/yarn workspace holds `packages/*` and `apps/*`. `@platform/core` is the isomorphic contract everyone depends on (it depends on nothing concrete). `@platform/providers` is isomorphic with the Node `spawn` injected from the app. `@platform/integrations` is node-only; heavy SDKs are optional peers loaded lazily with a fail-fast message. The app (`apps/inbox`) consumes the three packages by name; concrete agents/prompts/UI-tools stay in the app. Internal packages are consumed as raw TS source (no build step) — Vite and tsx transpile workspace deps directly.

**Tech Stack:** yarn classic 1.22 workspaces, TypeScript 6 (moduleResolution `bundler`, ESM with `.js` import specifiers), Vitest, ESLint flat config, Vite, Hono, CopilotKit v2 / AG-UI, `@modelcontextprotocol/sdk`, `googleapis`.

> **Spec:** `docs/superpowers/specs/2026-06-07-platform-package-split-design.md`
> **Branch:** `feat/platform-package-split` (already created; the spec is committed there).
> **Scope reminder:** `@platform/react` and `@platform/server` are NOT extracted in this plan.
> `@platform/*` is a placeholder scope — do not rename it here.

---

## File Structure

**New (root):**
- `package.json` — workspace root (private, `workspaces`, shared scripts + dev deps)
- `tsconfig.base.json` — shared compiler options
- `tsconfig.json` — solution file referencing all workspaces (for `tsc --build`)
- `vitest.config.ts` — moved from `apps/inbox/`, globs all workspaces
- `eslint.config.js` — moved from `apps/inbox/`, lints all workspaces
- `.prettierrc`, `.prettierignore` — moved from `apps/inbox/` (root already has copies; reconcile)
- `yarn.lock` — replaces `apps/inbox/package-lock.json`

**New (`packages/core/` — isomorphic):**
- `package.json`, `tsconfig.json`
- `src/messages.ts`, `src/defineAgent.ts`, `src/providers.ts`, `src/handoff.ts` (+ `*.test.ts`) — moved from `apps/inbox/core/`
- `src/index.ts` — barrel

**New (`packages/providers/` — isomorphic):**
- `package.json`, `tsconfig.json`
- `src/claude-stream.ts`, `src/claude-cli-provider.ts`, `src/mock-provider.ts` (+ `*.test.ts`) — moved from `apps/inbox/core/`
- `src/index.ts` — barrel

**New (`packages/integrations/` — node-only):**
- `package.json`, `tsconfig.json`
- `src/optional-peer.mjs` (+ `optional-peer.test.ts`) — the fail-fast helper (new)
- `src/gmail-basic/index.mjs` — MCP server, moved+refactored from `apps/inbox/mcp/gmail-tools.mjs`
- `src/gmail-basic/format.mjs` (+ `format.test.ts`) — moved from `apps/inbox/mcp/gmail-format.mjs`

**Modified (`apps/inbox/`):**
- `package.json` — drop dev tooling moved to root; add `@platform/*` deps; keep `googleapis` as a real dep
- `tsconfig.json`, `vite.config.ts` — adjust includes/paths
- `agents/inbox.agent.ts`, `agents/qualifier.prompts.ts`, `agents/reply.prompts.ts` — relocated from `core/`
- `server/index.ts`, `server/providers.ts`, `server/build-agent.ts`, `server/claude-spawn.ts` — import rewrites
- `client/src/actions.tsx`, `client/src/App.tsx`, `client/src/InboxView.tsx`, `client/src/useAgentStatus.ts`, `client/src/components/AgentModal.tsx` — import rewrites
- `mcp/inbox-tools.mjs` — stays (app's UI-contract tools)
- Removed: `apps/inbox/core/` (emptied), `apps/inbox/mcp/gmail-tools.mjs`, `apps/inbox/mcp/gmail-format.mjs`

---

## Task 1: Root workspace scaffold + migrate to yarn

**Files:**
- Create: `package.json` (repo root `/Users/yaroshuk/Development/AiWorkflow/package.json`)
- Move: `apps/inbox/vitest.config.ts`, `apps/inbox/eslint.config.js` → root
- Delete: `apps/inbox/package-lock.json`
- Create: `yarn.lock` (generated)

- [ ] **Step 1: Create the root `package.json`**

Create `/Users/yaroshuk/Development/AiWorkflow/package.json`:

```json
{
  "name": "aiworkflow-monorepo",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "workspaces": [
    "packages/*",
    "apps/*"
  ],
  "scripts": {
    "dev": "yarn workspace inbox dev",
    "dev:server": "yarn workspace inbox dev:server",
    "dev:client": "yarn workspace inbox dev:client",
    "build": "yarn workspace inbox build",
    "typecheck": "tsc --build",
    "test": "vitest run",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@types/node": "^25.9.2",
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.2",
    "concurrently": "^10.0.3",
    "eslint": "^10.4.1",
    "eslint-config-prettier": "^9.1.2",
    "eslint-plugin-react-hooks": "^7.1.1",
    "happy-dom": "^20.10.1",
    "prettier": "^3.8.3",
    "tsx": "^4.22.4",
    "typescript": "^6.0.3",
    "typescript-eslint": "^8.60.1",
    "vite": "^8.0.16",
    "vitest": "^4.1.8"
  }
}
```

Rationale: shared dev tooling lives at the root so every workspace uses one toolchain. Runtime deps stay in the workspaces that use them. The `@rolldown/binding-darwin-arm64` pin stays in `apps/inbox` (it's a Vite/build concern, app-only).

- [ ] **Step 2: Move shared config files to the root**

```bash
cd /Users/yaroshuk/Development/AiWorkflow
git mv apps/inbox/vitest.config.ts vitest.config.ts
git mv apps/inbox/eslint.config.js eslint.config.js
rm -f apps/inbox/package-lock.json
```

Root `.prettierrc` and `.prettierignore` already exist — keep the root copies and delete the app copies:

```bash
git rm apps/inbox/.prettierrc apps/inbox/.prettierignore
```

- [ ] **Step 3: Update the moved `vitest.config.ts` globs**

The setup file path and include globs now point at workspace-relative paths. Replace the `test` block in root `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./apps/inbox/client/src/test/setup.ts'],
    include: [
      'apps/inbox/client/src/**/*.test.{ts,tsx}',
      'apps/inbox/**/*.test.{ts,tsx}',
      'packages/*/src/**/*.test.{ts,tsx}',
    ],
    css: true,
    server: {
      deps: {
        inline: [/@copilotkit\//],
      },
    },
  },
})
```

- [ ] **Step 4: Trim `apps/inbox/package.json` dev deps + name**

Edit `apps/inbox/package.json`: keep `name: "inbox"`, keep `scripts`, keep runtime `dependencies`, and REMOVE the `devDependencies` block entirely EXCEPT `@rolldown/binding-darwin-arm64` (app/Vite-only). Result `apps/inbox/package.json`:

```json
{
  "name": "inbox",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "concurrently -n server,client -c blue,green \"npm:dev:server\" \"npm:dev:client\"",
    "dev:server": "tsx watch server/index.ts",
    "dev:client": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "dependencies": {
    "@ag-ui/client": "^0.0.55",
    "@copilotkit/react-core": "^1.59.5",
    "@copilotkit/runtime": "^1.59.5",
    "@hono/node-server": "^2.0.4",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "googleapis": "^173.0.0",
    "hono": "^4.12.23",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@rolldown/binding-darwin-arm64": "^1.0.3"
  }
}
```

(The `@platform/*` deps are added in later tasks as each package is created.)

- [ ] **Step 5: Install with yarn**

```bash
cd /Users/yaroshuk/Development/AiWorkflow
rm -rf apps/inbox/node_modules node_modules
yarn install
```

Expected: `yarn.lock` created at root; a single hoisted `node_modules`. No package errors.

- [ ] **Step 6: Verify the app still works end to end (nothing extracted yet)**

```bash
cd /Users/yaroshuk/Development/AiWorkflow
yarn test
yarn typecheck
yarn lint
```

Expected: 77 tests pass; tsc clean; lint green. (`apps/inbox` is now just wrapped in the workspace.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: yarn-classic workspace root; move shared tooling out of apps/inbox

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Create `tsconfig.base.json` + solution `tsconfig.json`

**Files:**
- Create: `tsconfig.base.json`
- Create: `tsconfig.json` (root solution)
- Modify: `apps/inbox/tsconfig.json`

- [ ] **Step 1: Create `tsconfig.base.json`**

Create `/Users/yaroshuk/Development/AiWorkflow/tsconfig.base.json` (shared options, no `include`):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "composite": true,
    "declaration": true,
    "emitDeclarationOnly": true,
    "outDir": "dist-types",
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  }
}
```

`composite: true` + `emitDeclarationOnly` lets `tsc --build` typecheck packages as project references without emitting JS (we consume source directly).

- [ ] **Step 2: Create the root solution `tsconfig.json`**

Create `/Users/yaroshuk/Development/AiWorkflow/tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./packages/core" },
    { "path": "./packages/providers" },
    { "path": "./packages/integrations" },
    { "path": "./apps/inbox" }
  ]
}
```

(References to `packages/*` are added in their tasks; if a referenced path does not exist yet when you run `tsc --build`, comment it out until its task creates it. Re-add as you go.)

- [ ] **Step 3: Point `apps/inbox/tsconfig.json` at the base**

Replace `apps/inbox/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "types": ["node"],
    "noEmit": false
  },
  "include": ["client/src", "server", "core", "mcp"],
  "references": [
    { "path": "../../packages/core" },
    { "path": "../../packages/providers" },
    { "path": "../../packages/integrations" }
  ]
}
```

(Note: `include` lists `core` for now — the app's agents still live there until Task 5
relocates them to `apps/inbox/agents/`, at which point Task 5 Step 3 switches `core` → `agents`.
If a referenced package path does not exist yet when you run `tsc --build`, comment that
reference out until its task creates it.)

- [ ] **Step 4: Verify + commit**

```bash
cd /Users/yaroshuk/Development/AiWorkflow
# temporarily edit root tsconfig.json references to only include ./apps/inbox until packages exist
yarn typecheck
```

Expected: tsc clean (only `apps/inbox` referenced for now).

```bash
git add -A
git commit -m "chore: shared tsconfig.base + solution tsconfig for the workspace

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Extract `@platform/core`

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`
- Move: `apps/inbox/core/{messages,defineAgent,providers,handoff}.ts` + their `.test.ts` → `packages/core/src/`
- Modify: server + client + agent imports of those four modules

- [ ] **Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@platform/core",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@ag-ui/client": "^0.0.55",
    "zod": "^3.25.76"
  }
}
```

- [ ] **Step 2: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Move the four contract modules + tests**

```bash
cd /Users/yaroshuk/Development/AiWorkflow
mkdir -p packages/core/src
git mv apps/inbox/core/messages.ts        packages/core/src/messages.ts
git mv apps/inbox/core/messages.test.ts   packages/core/src/messages.test.ts
git mv apps/inbox/core/defineAgent.ts     packages/core/src/defineAgent.ts
git mv apps/inbox/core/defineAgent.test.ts packages/core/src/defineAgent.test.ts
git mv apps/inbox/core/providers.ts       packages/core/src/providers.ts
git mv apps/inbox/core/providers.test.ts  packages/core/src/providers.test.ts
git mv apps/inbox/core/handoff.ts         packages/core/src/handoff.ts
git mv apps/inbox/core/handoff.test.ts    packages/core/src/handoff.test.ts
```

Internal cross-imports among these four already use `./...js` and stay valid (e.g. `handoff.ts` imports `./messages.js`). No edits needed inside the moved files.

- [ ] **Step 4: Create the barrel `packages/core/src/index.ts`**

```ts
export * from './messages.js'
export * from './defineAgent.js'
export * from './providers.js'
export * from './handoff.js'
```

- [ ] **Step 5: Add the dep to `apps/inbox/package.json`**

Add to `apps/inbox/package.json` `dependencies`:

```json
"@platform/core": "*"
```

- [ ] **Step 6: Rewrite app imports of the four modules to `@platform/core`**

Apply these exact edits:

`apps/inbox/server/build-agent.ts`:
```ts
// was:
// import type { AgentDefinition } from '../core/defineAgent.js'
// import type { ProviderRegistry, PromptStrategy } from '../core/providers.js'
import type { AgentDefinition, ProviderRegistry, PromptStrategy } from '@platform/core'
```

`apps/inbox/server/providers.ts` — change only the contract import (provider impls handled in Task 5):
```ts
// was: import { defineProviders, type ProviderRegistry } from '../core/providers.js'
import { defineProviders, type ProviderRegistry } from '@platform/core'
```

`apps/inbox/core/inbox.agent.ts`:
```ts
// was: import { defineAgent } from './defineAgent.js'
import { defineAgent } from '@platform/core'
```

`apps/inbox/core/agents/qualifier.prompts.ts` and `apps/inbox/core/agents/reply.prompts.ts`:
```ts
// was: import type { PromptStrategy } from '../providers.js'
import type { PromptStrategy } from '@platform/core'
```

`apps/inbox/client/src/useAgentStatus.ts`:
```ts
// was: import { hasPendingApproval, type Message } from '../../core/messages'
import { hasPendingApproval, type Message } from '@platform/core'
```

`apps/inbox/client/src/components/AgentModal.tsx` (multi-line import from `../../../core/messages`): change the module specifier to `@platform/core`, keep the named imports.

`apps/inbox/client/src/InboxView.tsx`:
```ts
// was: import { encodeHandoff, type HandoffPayload } from '../../core/handoff'
// was: import type { Message } from '../../core/messages'
import { encodeHandoff, type HandoffPayload, type Message } from '@platform/core'
```

`apps/inbox/client/src/actions.tsx`:
```ts
// was: import type { HandoffPayload } from '../../core/handoff'
import type { HandoffPayload } from '@platform/core'
```

(`actions.tsx`, `App.tsx`, `InboxView.tsx` also import `qualifierAgent`/`replyAgent` from `../../core/inbox.agent` — leave those as-is for now; the relocation is Task 4.)

- [ ] **Step 7: Re-enable the core reference in the root solution tsconfig**

Uncomment `{ "path": "./packages/core" }` in `/Users/yaroshuk/Development/AiWorkflow/tsconfig.json`.

- [ ] **Step 8: Verify**

```bash
cd /Users/yaroshuk/Development/AiWorkflow
yarn install        # link @platform/core into node_modules
yarn test
yarn typecheck
yarn lint
```

Expected: 77 tests pass (core tests now run from `packages/core/src`); tsc clean; lint green.

- [ ] **Step 9: Build the client (earliest Vite + workspace-TS check)**

```bash
cd /Users/yaroshuk/Development/AiWorkflow
yarn build
```

Expected: Vite build succeeds. If Vite fails to resolve `@platform/core` raw TS, add to `apps/inbox/vite.config.ts`:
```ts
export default defineConfig({
  plugins: [react()],
  root: '.',
  optimizeDeps: { exclude: ['@platform/core'] },
  server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } },
})
```
Re-run `yarn build` until green.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: extract @platform/core (messages, defineAgent, providers, handoff)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Extract `@platform/providers`

**Files:**
- Create: `packages/providers/package.json`, `packages/providers/tsconfig.json`, `packages/providers/src/index.ts`
- Move: `apps/inbox/core/{claude-stream,claude-cli-provider,mock-provider}.ts` (+ `.test.ts`) → `packages/providers/src/`
- Modify: `server/providers.ts`, `server/claude-spawn.ts` imports of provider impls

> **Why providers before the agent relocation:** the provider files still live in
> `apps/inbox/core/` alongside `inbox.agent.ts`/`agents/`. They must be moved OUT before
> Task 5 removes the now-empty `core/`. Order is: Task 3 (contract files leave `core/`) →
> Task 4 (provider files leave `core/`) → Task 5 (agents leave `core/`, then `rmdir core/`).

- [ ] **Step 1: Create `packages/providers/package.json`**

```json
{
  "name": "@platform/providers",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@ag-ui/client": "^0.0.55",
    "@platform/core": "*"
  }
}
```

- [ ] **Step 2: Create `packages/providers/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [{ "path": "../core" }]
}
```

- [ ] **Step 3: Move the provider files** (out of `apps/inbox/core/`, which still exists)

```bash
cd /Users/yaroshuk/Development/AiWorkflow
mkdir -p packages/providers/src
git mv apps/inbox/core/claude-stream.ts           packages/providers/src/claude-stream.ts
git mv apps/inbox/core/claude-stream.test.ts       packages/providers/src/claude-stream.test.ts
git mv apps/inbox/core/claude-cli-provider.ts      packages/providers/src/claude-cli-provider.ts
git mv apps/inbox/core/claude-cli-provider.test.ts packages/providers/src/claude-cli-provider.test.ts
git mv apps/inbox/core/mock-provider.ts            packages/providers/src/mock-provider.ts
git mv apps/inbox/core/mock-provider.test.ts       packages/providers/src/mock-provider.test.ts
```

- [ ] **Step 4: Rewrite the moved files' contract imports to `@platform/core`**

`packages/providers/src/claude-cli-provider.ts`:
```ts
// was:
// import type { Provider, PromptStrategy } from './providers.js'
// import { approvalResolved, lastApprovalArgs, type Message } from './messages.js'
import type { Provider, PromptStrategy } from '@platform/core'
import { approvalResolved, lastApprovalArgs, type Message } from '@platform/core'
// keep: import { mapClaudeStream } from './claude-stream.js'
```

`packages/providers/src/mock-provider.ts`:
```ts
// was:
// import type { Provider } from './providers.js'
// import { approvalResolved, type Message } from './messages.js'
import type { Provider } from '@platform/core'
import { approvalResolved, type Message } from '@platform/core'
```

Check the `.test.ts` files for `./providers.js` / `./messages.js` imports and rewrite those to `@platform/core` as well (e.g. `claude-cli-provider.test.ts`, `mock-provider.test.ts`).

- [ ] **Step 5: Create the barrel `packages/providers/src/index.ts`**

```ts
export * from './claude-stream.js'
export * from './claude-cli-provider.js'
export * from './mock-provider.js'
```

This exports the factories `createClaudeCliProvider`, `createMockInboxProvider`, the `ClaudeSpawn` type, and `mapClaudeStream`. (The spec's `claudeCli`/`mock` shorthand maps to these factories — `spawn` is injected by the app, so we export factories, not pre-built providers.)

- [ ] **Step 6: Rewrite app imports of provider impls**

`apps/inbox/server/providers.ts`:
```ts
// was:
// import { createMockInboxProvider } from '../core/mock-provider.js'
// import { createClaudeCliProvider } from '../core/claude-cli-provider.js'
import { createMockInboxProvider, createClaudeCliProvider } from '@platform/providers'
// keep: import { claudeSpawn } from './claude-spawn.js'
// (defineProviders/ProviderRegistry already from '@platform/core' since Task 3)
```

`apps/inbox/server/claude-spawn.ts`:
```ts
// was: import type { ClaudeSpawn } from '../core/claude-cli-provider.js'
import type { ClaudeSpawn } from '@platform/providers'
```

- [ ] **Step 7: Add the dep + re-enable the reference**

Add to `apps/inbox/package.json` `dependencies`: `"@platform/providers": "*"`.
Uncomment `{ "path": "./packages/providers" }` in the root `tsconfig.json`.

- [ ] **Step 8: Verify + commit**

```bash
cd /Users/yaroshuk/Development/AiWorkflow
yarn install
yarn test && yarn typecheck && yarn lint && yarn build
```

Expected: all green (provider tests now run from `packages/providers/src`).

```bash
git add -A
git commit -m "refactor: extract @platform/providers (claude-cli + mock; spawn injected)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Relocate app agents out of `core/` + remove the empty `core/`

**Files:**
- Move: `apps/inbox/core/inbox.agent.ts` (+ `.test.ts`) → `apps/inbox/agents/inbox.agent.ts`
- Move: `apps/inbox/core/agents/{qualifier,reply}.prompts.ts` (+ `.test.ts`) → `apps/inbox/agents/`
- Modify: server + client imports of `inbox.agent`; remove the now-empty `apps/inbox/core/`

> By this point `core/` holds ONLY `inbox.agent.ts` (+ test) and `agents/` — the contract
> files left in Task 3, the provider files in Task 4. So the `rmdir` succeeds.

- [ ] **Step 1: Move the agent + prompt files**

```bash
cd /Users/yaroshuk/Development/AiWorkflow
mkdir -p apps/inbox/agents
git mv apps/inbox/core/inbox.agent.ts          apps/inbox/agents/inbox.agent.ts
git mv apps/inbox/core/inbox.agent.test.ts     apps/inbox/agents/inbox.agent.test.ts
git mv apps/inbox/core/agents/qualifier.prompts.ts      apps/inbox/agents/qualifier.prompts.ts
git mv apps/inbox/core/agents/qualifier.prompts.test.ts apps/inbox/agents/qualifier.prompts.test.ts
git mv apps/inbox/core/agents/reply.prompts.ts          apps/inbox/agents/reply.prompts.ts
git mv apps/inbox/core/agents/reply.prompts.test.ts     apps/inbox/agents/reply.prompts.test.ts
rmdir apps/inbox/core/agents apps/inbox/core
```

(The prompt files' internal import of `../providers.js` was already changed to `@platform/core` in Task 3 Step 6, so they need no further edits.)

- [ ] **Step 2: Rewrite imports of `inbox.agent`**

`apps/inbox/server/index.ts`:
```ts
// was:
// import { qualifierAgent, replyAgent, agents } from '../core/inbox.agent.js'
// import { createQualifierPrompts } from '../core/agents/qualifier.prompts.js'
// import { createReplyPrompts } from '../core/agents/reply.prompts.js'
import { qualifierAgent, replyAgent, agents } from '../agents/inbox.agent.js'
import { createQualifierPrompts } from '../agents/qualifier.prompts.js'
import { createReplyPrompts } from '../agents/reply.prompts.js'
```

`apps/inbox/client/src/actions.tsx`:
```ts
// was: import { qualifierAgent, replyAgent } from '../../core/inbox.agent'
import { qualifierAgent, replyAgent } from '../../agents/inbox.agent'
```

`apps/inbox/client/src/App.tsx`:
```ts
// was: import { qualifierAgent } from '../../core/inbox.agent'
import { qualifierAgent } from '../../agents/inbox.agent'
```

`apps/inbox/client/src/InboxView.tsx`:
```ts
// was: import { qualifierAgent, replyAgent } from '../../core/inbox.agent'
import { qualifierAgent, replyAgent } from '../../agents/inbox.agent'
```

- [ ] **Step 3: Update `apps/inbox/tsconfig.json` include**

Ensure `"include": ["client/src", "server", "agents", "mcp"]` (the `core` → `agents` switch
deferred from Task 2 Step 3 lands here).

- [ ] **Step 4: Verify + commit**

```bash
cd /Users/yaroshuk/Development/AiWorkflow
yarn test && yarn typecheck && yarn lint && yarn build
```

Expected: all green; `apps/inbox/core/` no longer exists.

```bash
git add -A
git commit -m "refactor: relocate concrete agents/prompts to apps/inbox/agents; drop core/

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Extract `@platform/integrations` with the optional-peer fail-fast helper

**Files:**
- Create: `packages/integrations/package.json`, `packages/integrations/tsconfig.json`
- Create: `packages/integrations/src/optional-peer.mjs` + `packages/integrations/src/optional-peer.test.ts`
- Move: `apps/inbox/mcp/gmail-format.mjs` → `packages/integrations/src/gmail-basic/format.mjs` (+ its test)
- Move+refactor: `apps/inbox/mcp/gmail-tools.mjs` → `packages/integrations/src/gmail-basic/index.mjs`

- [ ] **Step 1: Create `packages/integrations/package.json`**

```json
{
  "name": "@platform/integrations",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./gmail-basic": "./src/gmail-basic/index.mjs",
    "./gmail-basic/format": "./src/gmail-basic/format.mjs"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^3.25.76"
  },
  "peerDependencies": {
    "googleapis": "^173.0.0"
  },
  "peerDependenciesMeta": {
    "googleapis": { "optional": true }
  }
}
```

- [ ] **Step 2: Create `packages/integrations/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "allowJs": true,
    "checkJs": false,
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write the failing test for the optional-peer helper**

Create `packages/integrations/src/optional-peer.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { optionalPeerError } from './optional-peer.mjs'

describe('optionalPeerError', () => {
  it('returns an actionable Error when the module is not found', () => {
    const err = Object.assign(new Error("Cannot find package 'googleapis'"), {
      code: 'ERR_MODULE_NOT_FOUND',
    })
    const mapped = optionalPeerError(err, { name: 'googleapis', install: 'yarn add googleapis' })
    expect(mapped).toBeInstanceOf(Error)
    expect(mapped?.message).toContain("optional peer 'googleapis'")
    expect(mapped?.message).toContain('yarn add googleapis')
  })

  it('returns null for unrelated errors (caller rethrows the original)', () => {
    const err = Object.assign(new Error('boom'), { code: 'SOME_OTHER' })
    expect(optionalPeerError(err, { name: 'googleapis', install: 'yarn add googleapis' })).toBeNull()
  })
})
```

- [ ] **Step 4: Run it to verify it fails**

```bash
cd /Users/yaroshuk/Development/AiWorkflow
yarn vitest run packages/integrations/src/optional-peer.test.ts
```

Expected: FAIL — `optional-peer.mjs` / `optionalPeerError` does not exist.

- [ ] **Step 5: Implement `packages/integrations/src/optional-peer.mjs`**

```js
// Maps a failed dynamic import of an OPTIONAL peer dependency into an actionable
// error. Returns the friendly Error when the module was simply not installed,
// or null for any other failure (so the caller rethrows the original).
export function optionalPeerError(err, { name, install }) {
  if (err?.code === 'ERR_MODULE_NOT_FOUND') {
    return new Error(
      `@platform/integrations requires the optional peer '${name}'. Install it in your app:  ${install}`
    )
  }
  return null
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
yarn vitest run packages/integrations/src/optional-peer.test.ts
```

Expected: PASS (both cases).

- [ ] **Step 7: Move the gmail files**

```bash
cd /Users/yaroshuk/Development/AiWorkflow
mkdir -p packages/integrations/src/gmail-basic
git mv apps/inbox/mcp/gmail-format.mjs      packages/integrations/src/gmail-basic/format.mjs
git mv apps/inbox/mcp/gmail-format.test.ts  packages/integrations/src/gmail-basic/format.test.ts
git mv apps/inbox/mcp/gmail-tools.mjs       packages/integrations/src/gmail-basic/index.mjs
```

(`format.test.ts` imports `./gmail-format.mjs` — update to `./format.mjs` in the next step.)

- [ ] **Step 8: Fix the format test import**

`packages/integrations/src/gmail-basic/format.test.ts`:
```ts
// was: import { parseLatestMessage, buildReplyRaw } from './gmail-format.mjs'
import { parseLatestMessage, buildReplyRaw } from './format.mjs'
```

- [ ] **Step 9: Refactor `index.mjs` — lazy googleapis + fail-fast**

In `packages/integrations/src/gmail-basic/index.mjs`:

Remove the top-level `import { google } from 'googleapis'`. Add near the other imports:
```js
import { optionalPeerError } from '../optional-peer.mjs'
```
Update the relative format import (it currently imports from `./gmail-format.mjs`):
```js
// was: import { parseLatestMessage, buildReplyRaw } from './gmail-format.mjs'
import { parseLatestMessage, buildReplyRaw } from './format.mjs'
```
Add a lazy loader and make `getGmail` async:
```js
async function loadGoogleapis() {
  try {
    return (await import('googleapis')).google
  } catch (err) {
    const mapped = optionalPeerError(err, { name: 'googleapis', install: 'yarn add googleapis' })
    if (mapped) throw mapped
    throw err
  }
}

let _gmail
async function getGmail() {
  if (_gmail) return _gmail
  const google = await loadGoogleapis()
  const keys = JSON.parse(readFileSync(keysPath, 'utf8'))
  const clientData = keys.installed || keys.web
  if (!clientData) throw new Error('gcp-oauth.keys.json has neither "installed" nor "web" client config')
  const { client_id, client_secret, redirect_uris } = clientData
  const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris?.[0] || 'http://localhost:3000/oauth2callback')
  const creds = JSON.parse(readFileSync(credsPath, 'utf8'))
  auth.setCredentials(creds)
  _gmail = google.gmail({ version: 'v1', auth })
  return _gmail
}
```
Both tool handlers already `await getGmail()` inside a `try/catch` that wraps the throw as `{ error: errText(err) }`, so the fail-fast message surfaces as a tool error — no handler change needed. Verify the two `getGmail()` call sites are awaited (they already are).

- [ ] **Step 10: Add the dep + re-enable the reference**

Add to `apps/inbox/package.json` `dependencies`: `"@platform/integrations": "*"` (and keep `googleapis` — the app uses the gmail entrypoint, so it installs the optional peer).
Uncomment `{ "path": "./packages/integrations" }` in the root `tsconfig.json`.

- [ ] **Step 11: Point `claude-spawn.ts` at the package entrypoint**

`apps/inbox/server/claude-spawn.ts` currently resolves the gmail MCP via a relative URL. Replace the `GMAIL_SERVER` resolution. At the top, add:
```ts
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
```
Replace:
```ts
// was: const GMAIL_SERVER = fileURLToPath(new URL('../mcp/gmail-tools.mjs', import.meta.url))
const GMAIL_SERVER = require.resolve('@platform/integrations/gmail-basic')
```
Leave `MCP_SERVER` (the app's `inbox-tools.mjs`) unchanged.

- [ ] **Step 12: Verify**

```bash
cd /Users/yaroshuk/Development/AiWorkflow
yarn install
yarn test && yarn typecheck && yarn lint && yarn build
```

Expected: all green; `optional-peer` + `format` tests run from `packages/integrations/src` (format tested WITHOUT googleapis at runtime — it never imports it).

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "refactor: extract @platform/integrations with ./gmail-basic (googleapis optional peer + fail-fast)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Full verification + browser E2E gate

**Files:** none (verification only)

- [ ] **Step 1: Clean full check**

```bash
cd /Users/yaroshuk/Development/AiWorkflow
yarn install
yarn test
yarn typecheck
yarn lint
yarn format:check
yarn build
```

Expected: 77 unit tests pass; tsc clean; lint green; prettier clean; Vite build succeeds.

- [ ] **Step 2: Run the app**

```bash
cd /Users/yaroshuk/Development/AiWorkflow
yarn dev
```

Expected: server on :4000, client on :5173, no startup errors. Confirm `curl -s -X POST localhost:4000/api/copilotkit -d '{"method":"info"}'` returns 200 with both agents (`qualifier`, `reply`).

- [ ] **Step 3: Browser E2E on the live Gmail account (the gate)**

Drive the full pipeline in the browser (per CLAUDE.md — only the browser catches the CopilotKit agent-binding class of bug):
1. Open `http://localhost:5173`. Confirm both cards render (LEAD QUALIFIER + REPLY AGENT), no `Agent 'default' not found` crash.
2. START the qualifier → it reads the latest real inbox email → VerdictCard renders with category/priority/reason.
3. Click **Draft reply** on the verdict → reply agent runs seeded by the handoff (no inbox re-read) → drafts a contextual reply → ApprovalDialog appears (card shows "Awaiting approval").
4. Approve → resume → a real Gmail draft is created (thread id + draft id returned).

Expected: identical behavior to pre-split (`master`). If `googleapis` resolution or the MCP path regressed, the qualifier's `get_latest_email` would error in-thread — verify it does NOT.

- [ ] **Step 4: Commit any fixups found during E2E** (if needed)

```bash
git add -A
git commit -m "fix: <describe the E2E fixup>

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Update docs

**Files:**
- Modify: `CLAUDE.md`, `docs/ARCHITECTURE.md`

- [ ] **Step 1: Update `CLAUDE.md`**

- Change the "Run from `apps/inbox/`" command block to root yarn commands: `yarn dev`, `yarn test`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn format` (run from repo root).
- Add a "Packages" section describing the new layout (`packages/core`, `packages/providers`, `packages/integrations`, `apps/inbox`) and the dependency direction (arrows → core).
- Add gotchas: (a) `@platform/*` is a placeholder scope — rename before first npm publish; (b) yarn classic workspace, internal deps via `"*"`; (c) packages are consumed as raw TS source (no build) — Vite excludes `@platform/core` from pre-bundle if needed; (d) `googleapis` is an OPTIONAL peer of `@platform/integrations` — the app installs it; (e) the gmail MCP path is resolved via `require.resolve('@platform/integrations/gmail-basic')`.
- Update the Handoff section: mark "the library (`@platform/*` split)" as STARTED — core/providers/integrations extracted; react/server still deferred.

- [ ] **Step 2: Update `docs/ARCHITECTURE.md`**

- In §9 Roadmap and §11, mark the `@platform/*` package split as ✅ BUILT for core/providers/integrations (react/server still 💤).
- Note the packaging strategy decision (one batteries package per axis + subpath entrypoints + optional peers; promote to standalone only on dependency-weight divergence).

- [ ] **Step 3: Commit**

```bash
cd /Users/yaroshuk/Development/AiWorkflow
git add CLAUDE.md docs/ARCHITECTURE.md
git commit -m "docs: @platform/* split built (core+providers+integrations); yarn workspace

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the executor

- **Task order empties `core/` safely:** Task 3 moves the contract files out of `core/`, Task 4 moves the provider files out, Task 5 moves the agents out and only then `rmdir apps/inbox/core`. Do not run Task 5's `rmdir` before Tasks 3 and 4 have moved their files. Execute strictly Task 1 → 8 in order.
- **`@platform/*` is a placeholder** — do not invent a real scope name; that is a separate branding decision.
- After every task: `yarn test && yarn typecheck && yarn lint` must be green before committing. The browser E2E (Task 7 Step 3) is the final gate and is non-negotiable.
- If Vite cannot resolve raw-TS workspace packages, the fix is `optimizeDeps.exclude` (shown in Task 3 Step 9), not a build step.
