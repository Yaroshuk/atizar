# WS7 — App → Library Boundary Migration Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Move the reusable Node/runtime machinery currently stuck in the demo app (`apps/inbox/server/`) into `@atizar/server` / `@atizar/providers` (and one pure helper into `@atizar/core`), so userland imports only the public SDK and the framework owns the reusable parts.

**Architecture:** Each move re-homes one or two symbols into a package barrel, moves their tests under `packages/<pkg>/src/`, and re-points the app's import sites — leaves first (pure folds, free-standing helpers) and the most-invasive `createServer` factory last. The framework/userland physical boundary (I5) is strengthened: nothing Node-bound or engine-bound enters `@atizar/core` (I3) — only the pure `aggregateHealth` fold is core-eligible; the rest goes to `@atizar/server` (Node home) and `@atizar/providers` (provider/runtime home, I15 boot-time classification becomes framework-physical). Concrete app paths, MCP server locations, the Gmail tool map, env policy, and the demo workflow filter stay in the app as injected factory arguments.

**Tech Stack:** Yarn-classic 1.22 workspace; TypeScript (`tsc --build` composite project references); vitest (glob discovery `packages/*/src/**/*.test.{ts,tsx}` + `apps/inbox/**/*.test.{ts,tsx,mjs}`); ESLint flat config + Prettier; Hono server; `@mastra/core` + `@mastra/pg` + `@ai-sdk/anthropic` runtime (mastra provider). `@atizar/core`, `@atizar/providers`, `@atizar/server` have **NO build step** — their `package.json` `exports` point directly at `./src/index.ts`; only `@atizar/react` builds via Vite. The app (`apps/inbox/tsconfig.json` has `references: []`) resolves `@atizar/*` through the base `customConditions: ["development"]` → `./src/index.ts`, so a fresh barrel export is visible to the app **immediately** with no project-reference edit.

> **GREEN GATE (every task — no `yarn build`, no react change):**
> `yarn typecheck && yarn test && yarn lint && yarn format:check`
> run from the repo root. WS7 touches no `@atizar/react` source, so the package build step does not apply.

> **GUARD-RAILS (binding — spec §0):** I3 — nothing Node/engine-bound moves into `@atizar/core` (only `aggregateHealth`, a pure fold). I5/I15 — the Node home is `@atizar/server`, the provider/runtime home is `@atizar/providers`; moving machinery there *strengthens* the physical boundary. Do not switch git branches to inspect history (`git show <sha>:path` / `git diff` only); verify `git rev-parse --abbrev-ref HEAD` before finishing.

> **TEST PLACEMENT (binding):** vitest discovers package tests ONLY under `packages/<pkg>/src/**/*.test.{ts,tsx}`. A moved test MUST land there to run — placing it elsewhere makes it silently un-run. Each move deletes the app-side test copy in the SAME commit as it adds the package-side copy.

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `packages/core/src/integration.ts` | Modify | Add `aggregateHealth(checks)` pure fold beside `HealthCheck`/`isOk` (Task 1). |
| `packages/core/src/integration.test.ts` | Create | Unit test for `aggregateHealth` (Task 1). |
| `apps/inbox/server/health.ts` | Modify → Delete | Re-point `aggregateHealth` import to `@atizar/core` (Task 1); deleted whole at Task 4. |
| `apps/inbox/server/health.test.ts` | Modify → Delete | `aggregateHealth` test points at core (Task 1); deleted at Task 4. |
| `packages/server/src/recordReplay.ts` | Create | `withRecordReplay`, `CassetteStore`, `recordReplayMode`, `encodeLine`/`parseLine`/`eventsForStep`/`dropStep`, `scanCassette`+`Finding`, `RecordReplayMode` (Task 2). |
| `packages/server/src/recordReplay.test.ts` | Create | Moved from `apps/inbox/server/record-replay.test.ts` (Task 2). |
| `packages/server/src/recordReplay.demo.test.ts` | Create | Moved from `apps/inbox/server/record-replay.demo.test.ts` (Task 2). |
| `apps/inbox/server/record-replay.ts` | Modify | Reduced to `cassettesDir()`/`demoCassettesDir()` only, re-exporting moved symbols from `@atizar/server` (Task 2). |
| `apps/inbox/server/record-replay.test.ts` | Delete | Moved to package (Task 2). |
| `apps/inbox/server/record-replay.demo.test.ts` | Delete | Moved to package (Task 2). |
| `packages/server/src/agentChecks.ts` | Create | `assertAgentClassification` + `bareName` (I15 framework-physical) (Task 3). |
| `packages/server/src/agentChecks.test.ts` | Create | Moved from `apps/inbox/server/agent-checks.test.ts` (Task 3). |
| `apps/inbox/server/agent-checks.ts` | Delete | Re-homed to `@atizar/server` (Task 3). |
| `apps/inbox/server/agent-checks.test.ts` | Delete | Moved to package (Task 3). |
| `apps/inbox/server/index.ts` | Modify | Re-point `assertAgentClassification` (Task 3), `aggregateHealth`/`providerHealth` (Task 4), record/replay wrap (Task 8), then replaced by `createServer` (Task 9). |
| `packages/server/src/connectRoutes.ts` | Modify | Add `deriveConnectionList(descriptors)` beside `ConnectionDescriptor` (Task 4). |
| `packages/server/src/connectRoutes.test.ts` | Create | Test for `deriveConnectionList` (Task 4). |
| `packages/server/src/providerHealth.ts` | Create | `providerHealth(provider)` (execSync binary probe) (Task 4). |
| `packages/server/src/providerHealth.test.ts` | Create | Moved provider-health portion of `health.test.ts` (Task 4). |
| `apps/inbox/server/connections.ts` | Modify | Re-export `deriveConnectionList` from `@atizar/server`; keep Gmail `scopesFor`/`connectionList` (Task 4). |
| `apps/inbox/server/connections.test.ts` | Delete | `deriveConnectionList` test moves to package (Task 4). |
| `packages/server/src/parseEnv.ts` | Create | `parseEnvFile` (Task 5, OPTIONAL). |
| `packages/server/src/parseEnv.test.ts` | Create | Moved from `apps/inbox/server/parse-env.test.ts` (Task 5). |
| `packages/server/src/loadDevEnv.ts` | Create | `loadDevEnv()` (find + parse + set unset vars) (Task 5). |
| `apps/inbox/server/parse-env.ts` | Delete | Re-homed (Task 5). |
| `apps/inbox/server/parse-env.test.ts` | Delete | Moved to package (Task 5). |
| `apps/inbox/server/load-dev-env.ts` | Modify | Reduced to a 1-line side-effect shim calling `loadDevEnv()` (Task 5). |
| `packages/server/src/makeClaudeSpawn.ts` | Create | `makeClaudeSpawn({mcpServers,builtins,timeoutMs,prepareEnv,...})` (Task 6). |
| `packages/server/src/makeClaudeSpawn.test.ts` | Create | Unit test for the factory wiring (Task 6). |
| `apps/inbox/server/claude-spawn.ts` | Modify | Reduced to the concrete factory call (paths + BUILTINS + env policy stay) (Task 6). |
| `packages/providers/src/mastraRunner.ts` | Create | `makeMastraRunner(cfg)` with parameterized `tools` map (Task 7). |
| `packages/providers/src/mastraRunner.test.ts` | Create | Moved from `apps/inbox/server/mastra/runner.test.ts` (Task 7). |
| `packages/providers/package.json` | Modify | Add `@mastra/core`, `@mastra/pg`, `@ai-sdk/anthropic`, `zod` deps (Task 7). |
| `apps/inbox/server/mastra/runner.ts` | Delete | Re-homed to `@atizar/providers` (Task 7). |
| `apps/inbox/server/mastra/runner.test.ts` | Delete | Moved to package (Task 7). |
| `apps/inbox/server/providers.ts` | Modify | Build `ALL_TOOLS` from `mastra/tools.ts` and inject it into `makeMastraRunner` (Task 7). |
| `packages/server/src/buildAgent.ts` | Create | `buildAgentProvider(...)` with injected `wrap?` (Task 8). |
| `packages/server/src/buildAgent.test.ts` | Create | Unit test for resolve→build→optional-wrap (Task 8). |
| `apps/inbox/server/build-agent.ts` | Modify | Reduced to the app wrapper that injects the dev `wrap` (Task 8). |
| `apps/inbox/eval/runner.ts` | (unchanged) | Verified compatible — it calls the app `buildProvider`, whose signature is preserved (Task 8). |
| `packages/server/src/createServer.ts` | Create | `createServer({workflowServers, providerRegistry, buildProvider, connections, scopesFor, enabledWorkflows, start?})` factory (Task 9). |
| `packages/server/src/createServer.test.ts` | Create | Unit test (handoff-check + register-loop + demo-filter, `start:false`) (Task 9). |
| `apps/inbox/server/index.ts` | Modify (Task 9) | Reduced to the app shell: concrete imports + demo filter + `createServer({ start: true })`. |
| `packages/server/src/index.ts` | Modify | Barrel: export every moved server symbol (Tasks 2,3,4,5,6,8,9). |
| `packages/providers/src/index.ts` | Modify | Barrel: `export * from './mastraRunner.js'` (Task 7). |
| `apps/inbox/server/pipeline/` | Delete | Stale empty (git-untracked) leftover dir (Task 10). |

---

### Task 1: `aggregateHealth` → `@atizar/core`

**Files:**
- `packages/core/src/integration.ts` (add fn after `isOk`, lines 21-23)
- `packages/core/src/integration.test.ts` (create)
- `apps/inbox/server/health.ts` (lines 1-12: drop the local `aggregateHealth`, re-export from `@atizar/core`)
- `apps/inbox/server/health.test.ts` (lines 1-12: import `aggregateHealth` from `@atizar/core`)

- [ ] Step 1: Write the failing test. Create `packages/core/src/integration.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { aggregateHealth, type HealthCheck } from './integration.js'

  describe('aggregateHealth', () => {
    it('is ok when all checks are ok', () => {
      expect(aggregateHealth([{ ok: true }, { ok: true, detail: 'x' }])).toEqual({ ok: true })
    })
    it('returns the first failure', () => {
      const fail: HealthCheck = { ok: false, error: 'no creds', hint: 'see skill' }
      expect(aggregateHealth([{ ok: true }, fail])).toEqual(fail)
    })
    it('an empty array has no failing checks → ok', () => {
      expect(aggregateHealth([])).toEqual({ ok: true })
    })
  })
  ```
- [ ] Step 2: Run `yarn vitest run packages/core/src/integration.test.ts -c vitest.config.ts` from the repo root. Expected FAIL: `aggregateHealth` is not exported from `./integration.js` (`SyntaxError: ... does not provide an export named 'aggregateHealth'`).
- [ ] Step 3: Minimal impl. In `packages/core/src/integration.ts`, add after the `isOk` function (after line 23):
  ```ts

  // Aggregate a set of credential/provider checks for ONE agent into a single HealthCheck:
  // the first failing check (so an agent with any unhealthy dependency is unhealthy), else ok.
  // An empty array has no failing checks and returns ok:true (no checks = no constraints).
  // Pure: no fs, no Node, no engine import (invariant I3 — this lives in @atizar/core).
  export function aggregateHealth(checks: HealthCheck[]): HealthCheck {
    for (const c of checks) {
      if (!c.ok) return c
    }
    return { ok: true }
  }
  ```
  (`packages/core/src/index.ts` already does `export * from './integration.js'`, so the new symbol is public with no barrel edit.)
- [ ] Step 4: Run `yarn vitest run packages/core/src/integration.test.ts -c vitest.config.ts`. Expected PASS: 3 passed.
- [ ] Step 5: Re-point the app. Edit `apps/inbox/server/health.ts` — remove the local `aggregateHealth` (lines 7-12) and re-export it from core so `index.ts` (which imports `{ aggregateHealth, providerHealth }` from `./health.js`) keeps working unchanged. The file becomes:
  ```ts
  import { execSync } from 'node:child_process'
  import type { HealthCheck } from '@atizar/core'

  // aggregateHealth now lives in @atizar/core (pure fold, Node-free — I3). Re-exported here so
  // existing import sites stay stable until health.ts is fully retired at WS7 move 4.
  export { aggregateHealth } from '@atizar/core'

  // A provider's own readiness: claude-cli needs the `claude` binary on PATH; mastra needs
  // ANTHROPIC_API_KEY; mock is always ok. Never throws (a failing probe returns ok:false).
  export function providerHealth(provider: string): HealthCheck {
    if (provider === 'mock') return { ok: true }
    if (provider === 'mastra') {
      return process.env.ANTHROPIC_API_KEY
        ? { ok: true }
        : {
            ok: false,
            error: 'ANTHROPIC_API_KEY not set',
            hint: 'export ANTHROPIC_API_KEY (see HANDOFF provider knobs)',
          }
    }
    if (provider === 'claude-cli') {
      try {
        // `command -v claude` exits non-zero (throws) if the binary is not on PATH.
        execSync('command -v claude', { stdio: 'ignore' })
        return { ok: true }
      } catch {
        return {
          ok: false,
          error: 'claude binary not found on PATH',
          hint: 'install the Claude Code CLI (see HANDOFF provider knobs)',
        }
      }
    }
    // Unknown provider: validated by registry.resolve() at wiring time, so this is unreachable in
    // production. Treat as ok rather than surfacing a confusing false-negative.
    return { ok: true }
  }
  ```
  Edit `apps/inbox/server/health.test.ts` lines 1-2 so the `aggregateHealth` test imports from `@atizar/core` (the `providerHealth` test keeps importing `./health.js`):
  ```ts
  import { describe, it, expect } from 'vitest'
  import { aggregateHealth } from '@atizar/core'
  import { providerHealth } from './health.js'
  ```
  (Leave the `describe('aggregateHealth', …)` and `describe('providerHealth', …)` bodies below this header unchanged.)
- [ ] Step 6: GREEN GATE — `yarn typecheck && yarn test && yarn lint && yarn format:check` from the repo root. Expected: all green (the core test runs from `packages/core/src/`; the app `health.test.ts` still passes against the re-export).
- [ ] Step 7: Commit.
  ```
  git add packages/core/src/integration.ts packages/core/src/integration.test.ts apps/inbox/server/health.ts apps/inbox/server/health.test.ts
  git commit -m "refactor(core): move aggregateHealth pure fold into @atizar/core

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 2: `record-replay.ts` → `@atizar/server` (keep dir helpers in app)

**Files:**
- `packages/server/src/recordReplay.ts` (create — everything from `apps/inbox/server/record-replay.ts` EXCEPT `cassettesDir`/`demoCassettesDir`)
- `packages/server/src/recordReplay.test.ts` (create — from `apps/inbox/server/record-replay.test.ts:1-318`)
- `packages/server/src/recordReplay.demo.test.ts` (create — from `apps/inbox/server/record-replay.demo.test.ts:1-43`)
- `packages/server/src/index.ts` (add barrel export, after line 24)
- `apps/inbox/server/record-replay.ts` (reduce to dir helpers + re-export)
- `apps/inbox/server/record-replay.test.ts`, `apps/inbox/server/record-replay.demo.test.ts` (delete)
- `apps/inbox/server/build-agent.ts:2`, `apps/inbox/server/scan-demo-cassettes.ts:3` (import unchanged — resolves via the re-export)

- [ ] Step 1: Write the failing test (move it). Create `packages/server/src/recordReplay.test.ts` with the FULL contents of `apps/inbox/server/record-replay.test.ts` (lines 1-318), changing ONLY the import path on line 16 from `'./record-replay.js'` to `'./recordReplay.js'`. Create `packages/server/src/recordReplay.demo.test.ts` with the FULL contents of `apps/inbox/server/record-replay.demo.test.ts` (lines 1-43), changing ONLY line 2 from `'./record-replay.js'` to `'./recordReplay.js'`.
- [ ] Step 2: Run `yarn vitest run packages/server/src/recordReplay.test.ts packages/server/src/recordReplay.demo.test.ts -c vitest.config.ts` from the repo root. Expected FAIL: `Cannot find module './recordReplay.js'` (the impl does not exist yet).
- [ ] Step 3: Minimal impl. Create `packages/server/src/recordReplay.ts` with the FULL contents of `apps/inbox/server/record-replay.ts` EXCEPT `cassettesDir()` (lines 151-155), `demoCassettesDir()` (lines 157-160), and the now-unused `fileURLToPath` import. The new file's imports drop `fileURLToPath`:
  ```ts
  import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
  import { join } from 'node:path'
  import type { BaseEvent, RunAgentInput } from '@ag-ui/client'
  import {
    resolvedApprovalCount,
    type Provider,
    type Message,
    type ResumeHandle,
    type GateResolution,
  } from '@atizar/core'
  ```
  …followed verbatim by `encodeLine`, `parseLine`, `eventsForStep`, `dropStep`, the `Finding` interface, `PATTERNS`, `scanCassette`, `readFileOrNull`, the `CassetteStore` class, `export type RecordReplayMode = 'replay' | 'record' | 'demo'`, `recordReplayMode()`, and `withRecordReplay()` — i.e. lines 17-149 and 162-228 of the original, unchanged. Add the barrel export to `packages/server/src/index.ts` after line 24:
  ```ts
  export {
    withRecordReplay,
    CassetteStore,
    recordReplayMode,
    encodeLine,
    parseLine,
    eventsForStep,
    dropStep,
    scanCassette,
  } from './recordReplay.js'
  export type { Finding, RecordReplayMode } from './recordReplay.js'
  ```
- [ ] Step 4: Run `yarn vitest run packages/server/src/recordReplay.test.ts packages/server/src/recordReplay.demo.test.ts -c vitest.config.ts`. Expected PASS: the `cassette line helpers`, `scanCassette`, `CassetteStore`, `withRecordReplay`, `withRecordReplay resume()`, and `demo strict replay` suites all pass.
- [ ] Step 5: Re-point the app + delete the moved app tests. Replace `apps/inbox/server/record-replay.ts` entirely with the dir helpers + a re-export of the moved symbols (so existing `from './record-replay.js'` import sites keep resolving):
  ```ts
  import { fileURLToPath } from 'node:url'

  // The reusable record/replay engine now lives in @atizar/server (WS7 move 2). Re-exported here
  // so app-internal import sites stay stable; only the app-specific cassette DIRECTORIES stay local.
  export {
    withRecordReplay,
    CassetteStore,
    recordReplayMode,
    encodeLine,
    parseLine,
    eventsForStep,
    dropStep,
    scanCassette,
    type Finding,
    type RecordReplayMode,
  } from '@atizar/server'

  // apps/inbox/.cassettes/ — resolved relative to this module (server/), so it does
  // not depend on the process cwd.
  export function cassettesDir(): string {
    return fileURLToPath(new URL('../.cassettes/', import.meta.url))
  }

  // apps/inbox/demo-cassettes/ — committed SYNTHETIC cassettes for DEMO=1 (never real data).
  export function demoCassettesDir(): string {
    return fileURLToPath(new URL('../demo-cassettes/', import.meta.url))
  }
  ```
  Delete the moved app tests:
  ```
  git rm apps/inbox/server/record-replay.test.ts apps/inbox/server/record-replay.demo.test.ts
  ```
  `apps/inbox/server/build-agent.ts:2` (imports `withRecordReplay, recordReplayMode, cassettesDir, demoCassettesDir`) and `apps/inbox/server/scan-demo-cassettes.ts:3` (imports `scanCassette`) keep `from './record-replay.js'` — all four resolve against the re-export or the kept-local dir helpers, so NO change is needed at those sites.
- [ ] Step 6: GREEN GATE — `yarn typecheck && yarn test && yarn lint && yarn format:check` from the repo root. Expected: all green; the package tests run under `packages/server/src/`, the app keeps importing through the re-export.
- [ ] Step 7: Commit.
  ```
  git add packages/server/src/recordReplay.ts packages/server/src/recordReplay.test.ts packages/server/src/recordReplay.demo.test.ts packages/server/src/index.ts apps/inbox/server/record-replay.ts apps/inbox/server/record-replay.test.ts apps/inbox/server/record-replay.demo.test.ts
  git commit -m "refactor(server): move record/replay engine into @atizar/server (app keeps cassette dirs)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 3: `agent-checks.ts` → `@atizar/server`

**Files:**
- `packages/server/src/agentChecks.ts` (create — from `apps/inbox/server/agent-checks.ts:1-43`)
- `packages/server/src/agentChecks.test.ts` (create — from `apps/inbox/server/agent-checks.test.ts:1-88`)
- `packages/server/src/index.ts` (add barrel export)
- `apps/inbox/server/index.ts:21` (re-point import)
- `apps/inbox/server/agent-checks.ts`, `apps/inbox/server/agent-checks.test.ts` (delete)

- [ ] Step 1: Write the failing test (move it). Create `packages/server/src/agentChecks.test.ts` with the FULL contents of `apps/inbox/server/agent-checks.test.ts` (lines 1-88), changing ONLY line 3 from `'./agent-checks.js'` to `'./agentChecks.js'`. (Line 2 `import { defineAgent } from '@atizar/core'` stays — `@atizar/core` is a dependency of `@atizar/server`.)
- [ ] Step 2: Run `yarn vitest run packages/server/src/agentChecks.test.ts -c vitest.config.ts` from the repo root. Expected FAIL: `Cannot find module './agentChecks.js'`.
- [ ] Step 3: Minimal impl. Create `packages/server/src/agentChecks.ts` with the FULL contents of `apps/inbox/server/agent-checks.ts` (lines 1-43), unchanged (it imports only `type { AgentDefinition, EffectFn }` from `@atizar/core`, which `@atizar/server` already depends on; `bareName` is its private helper). Add the barrel export to `packages/server/src/index.ts`:
  ```ts
  export { assertAgentClassification } from './agentChecks.js'
  ```
- [ ] Step 4: Run `yarn vitest run packages/server/src/agentChecks.test.ts -c vitest.config.ts`. Expected PASS: 6 passed (`passes when every allow-listed tool…`, `passes when a dispatch tool…`, and four `throws when…` cases).
- [ ] Step 5: Re-point the app + delete. Edit `apps/inbox/server/index.ts` line 21 from `import { assertAgentClassification } from './agent-checks.js'` to import it from `@atizar/server` — either fold it into the existing `@atizar/server` import block (lines 8-20) or keep it on its own line `import { assertAgentClassification } from '@atizar/server'`. Then delete:
  ```
  git rm apps/inbox/server/agent-checks.ts apps/inbox/server/agent-checks.test.ts
  ```
- [ ] Step 6: GREEN GATE — `yarn typecheck && yarn test && yarn lint && yarn format:check` from the repo root. Expected: all green.
- [ ] Step 7: Commit.
  ```
  git add packages/server/src/agentChecks.ts packages/server/src/agentChecks.test.ts packages/server/src/index.ts apps/inbox/server/index.ts apps/inbox/server/agent-checks.ts apps/inbox/server/agent-checks.test.ts
  git commit -m "refactor(server): move assertAgentClassification (boot-time I15 check) into @atizar/server

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 4: `deriveConnectionList` + `providerHealth` → `@atizar/server`; delete `health.ts`

**Files:**
- `packages/server/src/connectRoutes.ts` (add `import type { WorkflowDescriptor }` at top + `deriveConnectionList` after `ConnectionDescriptor`, line 17)
- `packages/server/src/connectRoutes.test.ts` (create — from `apps/inbox/server/connections.test.ts:1-37`)
- `packages/server/src/providerHealth.ts` (create — `providerHealth` from `apps/inbox/server/health.ts:14-43`)
- `packages/server/src/providerHealth.test.ts` (create — the `providerHealth` block of `apps/inbox/server/health.test.ts:14-26`)
- `packages/server/src/index.ts` (barrel: `deriveConnectionList`, `providerHealth`)
- `apps/inbox/server/connections.ts` (re-export `deriveConnectionList`; keep `scopesFor`/`connectionList`)
- `apps/inbox/server/index.ts` (re-point `aggregateHealth` to `@atizar/core`, `providerHealth` to `@atizar/server`; drop line 23)
- `apps/inbox/server/health.ts`, `apps/inbox/server/health.test.ts`, `apps/inbox/server/connections.test.ts` (delete)

- [ ] Step 1: Write the failing tests (move them).
  Create `packages/server/src/connectRoutes.test.ts`:
  ```ts
  import { describe, expect, test } from 'vitest'
  import { deriveConnectionList } from './connectRoutes.js'
  import type { WorkflowDescriptor } from '@atizar/core'

  const wf = (id: string, connections?: WorkflowDescriptor['connections']): WorkflowDescriptor => ({
    id,
    label: id,
    iconName: 'inbox',
    agents: [],
    entryAgentId: 'x',
    inputs: [],
    connections,
  })
  describe('deriveConnectionList', () => {
    test('unions + defaults connection to "default"', () => {
      expect(
        deriveConnectionList([
          wf('a', [{ integration: 'gmail', provider: 'google' }]),
          wf('b', [{ integration: 'gmail', provider: 'google' }]),
        ])
      ).toEqual([{ integration: 'gmail', connection: 'default', provider: 'google' }])
    })
    test('dedupes by (integration, connection), keeps distinct connections', () => {
      expect(
        deriveConnectionList([
          wf('a', [{ integration: 'gmail', provider: 'google' }]),
          wf('b', [{ integration: 'gmail', connection: 'work', provider: 'google' }]),
        ])
      ).toEqual([
        { integration: 'gmail', connection: 'default', provider: 'google' },
        { integration: 'gmail', connection: 'work', provider: 'google' },
      ])
    })
    test('no connections contribute nothing', () => {
      expect(deriveConnectionList([wf('a'), wf('b', [])])).toEqual([])
    })
  })
  ```
  Create `packages/server/src/providerHealth.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { providerHealth } from './providerHealth.js'

  describe('providerHealth', () => {
    it('mock is always ok', () => expect(providerHealth('mock')).toEqual({ ok: true }))
    it('mastra needs ANTHROPIC_API_KEY', () => {
      const saved = process.env.ANTHROPIC_API_KEY
      delete process.env.ANTHROPIC_API_KEY
      try {
        expect(providerHealth('mastra').ok).toBe(false)
      } finally {
        if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved
        else delete process.env.ANTHROPIC_API_KEY
      }
    })
  })
  ```
- [ ] Step 2: Run `yarn vitest run packages/server/src/connectRoutes.test.ts packages/server/src/providerHealth.test.ts -c vitest.config.ts` from the repo root. Expected FAIL: `deriveConnectionList` not exported from `./connectRoutes.js`; `Cannot find module './providerHealth.js'`.
- [ ] Step 3: Minimal impl.
  In `packages/server/src/connectRoutes.ts`, add `import type { WorkflowDescriptor } from '@atizar/core'` near the top (after line 1's `import { Hono } from 'hono'`), then add after the `ConnectionDescriptor` interface (after line 17):
  ```ts

  // Derive the live connection list by unioning every loaded workflow's declared connections,
  // defaulting `connection` to 'default' and deduping by (integration, connection). A stale or extra
  // chip becomes impossible — the list is exactly what the loaded workflows ask for.
  export function deriveConnectionList(descriptors: WorkflowDescriptor[]): ConnectionDescriptor[] {
    const byKey = new Map<string, ConnectionDescriptor>()
    for (const d of descriptors) {
      for (const c of d.connections ?? []) {
        const connection = c.connection ?? 'default'
        const key = `${c.integration}:${connection}`
        if (!byKey.has(key))
          byKey.set(key, { integration: c.integration, connection, provider: c.provider })
      }
    }
    return [...byKey.values()]
  }
  ```
  Create `packages/server/src/providerHealth.ts`:
  ```ts
  import { execSync } from 'node:child_process'
  import type { HealthCheck } from '@atizar/core'

  // A provider's own readiness: claude-cli needs the `claude` binary on PATH; mastra needs
  // ANTHROPIC_API_KEY; mock is always ok. Never throws (a failing probe returns ok:false).
  export function providerHealth(provider: string): HealthCheck {
    if (provider === 'mock') return { ok: true }
    if (provider === 'mastra') {
      return process.env.ANTHROPIC_API_KEY
        ? { ok: true }
        : {
            ok: false,
            error: 'ANTHROPIC_API_KEY not set',
            hint: 'export ANTHROPIC_API_KEY (see HANDOFF provider knobs)',
          }
    }
    if (provider === 'claude-cli') {
      try {
        // `command -v claude` exits non-zero (throws) if the binary is not on PATH.
        execSync('command -v claude', { stdio: 'ignore' })
        return { ok: true }
      } catch {
        return {
          ok: false,
          error: 'claude binary not found on PATH',
          hint: 'install the Claude Code CLI (see HANDOFF provider knobs)',
        }
      }
    }
    // Unknown provider: validated by registry.resolve() at wiring time, so this is unreachable in
    // production. Treat as ok rather than surfacing a confusing false-negative.
    return { ok: true }
  }
  ```
  Add the barrel exports to `packages/server/src/index.ts`:
  ```ts
  export { deriveConnectionList } from './connectRoutes.js'
  export { providerHealth } from './providerHealth.js'
  ```
- [ ] Step 4: Run `yarn vitest run packages/server/src/connectRoutes.test.ts packages/server/src/providerHealth.test.ts -c vitest.config.ts`. Expected PASS: 3 + 2 passed.
- [ ] Step 5: Re-point the app + delete `health.ts`.
  Replace `apps/inbox/server/connections.ts` so it re-exports `deriveConnectionList` from `@atizar/server` and keeps the Gmail scopes + the derived `connectionList`:
  ```ts
  // App-side declaration of which (integration, connection, provider) the loaded workflows require,
  // and the OAuth scopes each integration needs. Scopes are DERIVED from each integration's own
  // `auth` declaration (auth.scopes) — no hand-written duplicate (auth sub-stage 5).
  import { deriveConnectionList } from '@atizar/server'
  import type { ConnectionDescriptor } from '@atizar/server'
  import { auth as gmailAuth } from '@atizar/integrations/gmail/auth'
  import { workflowDescriptors } from '../workflows/index.js'

  // The AuthSpec union's open catch-all variant ({ kind: string; [k]: unknown }) widens `scopes` to
  // unknown even under the oauth2 narrowing, so read it through the oauth2 shape explicitly.
  const gmailScopes = (gmailAuth as { scopes?: string[] }).scopes ?? []
  const SCOPES: Record<string, string[]> = {
    gmail: gmailScopes,
  }

  export const scopesFor = (integration: string): string[] => SCOPES[integration] ?? []

  // deriveConnectionList now lives in @atizar/server (WS7 move 4); re-export so any app import site
  // stays stable. The concrete derived list is composed here from the loaded workflows.
  export { deriveConnectionList }

  export const connectionList: ConnectionDescriptor[] = deriveConnectionList(workflowDescriptors)
  ```
  In `apps/inbox/server/index.ts`: change line 4 from `import { instanceId, composeInstructions, type HealthCheck } from '@atizar/core'` to add `aggregateHealth`: `import { instanceId, composeInstructions, aggregateHealth, type HealthCheck } from '@atizar/core'`; add `providerHealth` to the `@atizar/server` import block (lines 8-20); and DELETE line 23 (`import { aggregateHealth, providerHealth } from './health.js'`). Then delete:
  ```
  git rm apps/inbox/server/health.ts apps/inbox/server/health.test.ts apps/inbox/server/connections.test.ts
  ```
- [ ] Step 6: GREEN GATE — `yarn typecheck && yarn test && yarn lint && yarn format:check` from the repo root. Expected: all green (`health.ts`/`health.test.ts` gone; `aggregateHealth` from core, `providerHealth` from server; `connections.test.ts`'s coverage now lives in `connectRoutes.test.ts`).
- [ ] Step 7: Commit.
  ```
  git add packages/server/src/connectRoutes.ts packages/server/src/connectRoutes.test.ts packages/server/src/providerHealth.ts packages/server/src/providerHealth.test.ts packages/server/src/index.ts apps/inbox/server/connections.ts apps/inbox/server/index.ts apps/inbox/server/health.ts apps/inbox/server/health.test.ts apps/inbox/server/connections.test.ts
  git commit -m "refactor(server): move deriveConnectionList + providerHealth into @atizar/server; delete health.ts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 5: `parse-env.ts` + `load-dev-env.ts` body → `@atizar/server` (OPTIONAL, low priority)

**Files:**
- `packages/server/src/parseEnv.ts` (create — from `apps/inbox/server/parse-env.ts:1-28`)
- `packages/server/src/parseEnv.test.ts` (create — from `apps/inbox/server/parse-env.test.ts:1-41`)
- `packages/server/src/loadDevEnv.ts` (create — the find+parse+set logic of `apps/inbox/server/load-dev-env.ts:13-37`)
- `packages/server/src/index.ts` (barrel: `parseEnvFile`, `loadDevEnv`)
- `apps/inbox/server/load-dev-env.ts` (reduce to the 1-line side-effect shim)
- `apps/inbox/server/parse-env.ts`, `apps/inbox/server/parse-env.test.ts` (delete)

- [ ] Step 1: Write the failing test (move it). Create `packages/server/src/parseEnv.test.ts` with the FULL contents of `apps/inbox/server/parse-env.test.ts` (lines 1-41), changing ONLY line 2 from `'./parse-env.js'` to `'./parseEnv.js'`.
- [ ] Step 2: Run `yarn vitest run packages/server/src/parseEnv.test.ts -c vitest.config.ts` from the repo root. Expected FAIL: `Cannot find module './parseEnv.js'`.
- [ ] Step 3: Minimal impl. Create `packages/server/src/parseEnv.ts` with the FULL contents of `apps/inbox/server/parse-env.ts` (lines 1-28), unchanged. Create `packages/server/src/loadDevEnv.ts`:
  ```ts
  // Dev-only autoloader for `.env.local`. Call it as the FIRST line of a server entry point so it
  // runs before any module reads `process.env` at init time. Walks up from cwd to find the repo-root
  // `.env.local`, parses it, and sets each var ONLY if not already in the environment — so a var
  // passed explicitly on the CLI (`PROVIDER=mastra yarn dev`) always wins. Skipped in production
  // (`.env.local` is gitignored and never deployed; the NODE_ENV gate is the explicit guard).
  import { existsSync, readFileSync } from 'node:fs'
  import { dirname, join, parse } from 'node:path'
  import { parseEnvFile } from './parseEnv.js'

  function findEnvFile(start: string): string | null {
    let dir = start
    const { root } = parse(dir)
    for (;;) {
      const candidate = join(dir, '.env.local')
      if (existsSync(candidate)) return candidate
      if (dir === root) return null
      dir = dirname(dir)
    }
  }

  export function loadDevEnv(): void {
    if (process.env.NODE_ENV === 'production') return
    const file = findEnvFile(process.cwd())
    if (!file) return
    const parsed = parseEnvFile(readFileSync(file, 'utf8'))
    let loaded = 0
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) {
        process.env[key] = value
        loaded++
      }
    }
    if (loaded > 0) console.log(`[dev] loaded ${loaded} var(s) from ${file}`)
  }
  ```
  Add the barrel exports to `packages/server/src/index.ts`:
  ```ts
  export { parseEnvFile } from './parseEnv.js'
  export { loadDevEnv } from './loadDevEnv.js'
  ```
- [ ] Step 4: Run `yarn vitest run packages/server/src/parseEnv.test.ts -c vitest.config.ts`. Expected PASS: 6 passed.
- [ ] Step 5: Re-point the app + delete. Replace `apps/inbox/server/load-dev-env.ts` with the 1-line side-effect shim:
  ```ts
  // Dev-only `.env.local` autoloader. Imported as the FIRST line of `server/index.ts` so it runs
  // (as an import side effect) before any other module reads `process.env`. The reusable logic now
  // lives in @atizar/server (WS7 move 5); this shim keeps the import-for-side-effect contract.
  import { loadDevEnv } from '@atizar/server'

  loadDevEnv()
  ```
  Delete:
  ```
  git rm apps/inbox/server/parse-env.ts apps/inbox/server/parse-env.test.ts
  ```
  (`apps/inbox/server/index.ts:1` keeps `import './load-dev-env.js'` — the shim runs `loadDevEnv()` on import, preserving the side-effect-first ordering before any env read.)
- [ ] Step 6: GREEN GATE — `yarn typecheck && yarn test && yarn lint && yarn format:check` from the repo root. Expected: all green.
- [ ] Step 7: Commit.
  ```
  git add packages/server/src/parseEnv.ts packages/server/src/parseEnv.test.ts packages/server/src/loadDevEnv.ts packages/server/src/index.ts apps/inbox/server/load-dev-env.ts apps/inbox/server/parse-env.ts apps/inbox/server/parse-env.test.ts
  git commit -m "refactor(server): move parseEnvFile + loadDevEnv into @atizar/server (app keeps side-effect shim)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 6: `claude-spawn.ts` impl → `@atizar/server` as `makeClaudeSpawn`

**Files:**
- `packages/server/src/makeClaudeSpawn.ts` (create — generic spawn from `apps/inbox/server/claude-spawn.ts:1-137`, parameterized)
- `packages/server/src/makeClaudeSpawn.test.ts` (create)
- `packages/server/src/index.ts` (barrel: `makeClaudeSpawn`, `type ClaudeSpawnOptions`, `type McpServerSpec`)
- `apps/inbox/server/claude-spawn.ts` (reduce to the concrete factory call — paths + BUILTINS + env policy stay as args)

> **RISK HOT-SPOT.** A dropped `ATIZAR_*` env-forward breaks MCP-child credential resolution **silently** (no typecheck/unit-test failure). Browser-verify a REAL claude-cli flow in this task (see ## Browser-verify). The `prepareEnv` hook MUST forward the full `process.env` (so all `ATIZAR_*` vars flow through) and delete only `ANTHROPIC_API_KEY`. `ClaudeSpawn` (the TYPE) stays in `@atizar/providers` — it is NOT moved; `makeClaudeSpawn` imports it from there.

- [ ] Step 1: Write the failing test. Create `packages/server/src/makeClaudeSpawn.test.ts`. Drive the deterministic, Node-free wiring: point `command` at a fast-exiting binary (`/bin/true`) and capture the two temp config files via an `onConfigWritten` hook, asserting the injected MCP servers + the allow/deny lists:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { readFileSync } from 'node:fs'
  import { makeClaudeSpawn } from './makeClaudeSpawn.js'

  describe('makeClaudeSpawn', () => {
    it('writes an mcp-config with the given servers and a settings allow/deny list', async () => {
      let writtenMcp = ''
      let writtenSettings = ''
      const spawn = makeClaudeSpawn({
        command: '/bin/true',
        mcpServers: { inbox: { type: 'stdio', command: 'node', args: ['/x/inbox.mjs'] } },
        builtins: ['Bash', 'Write'],
        timeoutMs: 1000,
        prepareEnv: (base) => {
          const env = { ...base }
          delete env.SECRET_OVERRIDE
          return env
        },
        onConfigWritten: (mcpPath, settingsPath) => {
          writtenMcp = readFileSync(mcpPath, 'utf8')
          writtenSettings = readFileSync(settingsPath, 'utf8')
        },
      })
      const handle = spawn('do it', ['mcp__inbox__list_unread'])
      const mcp = JSON.parse(writtenMcp)
      expect(mcp.mcpServers.inbox).toEqual({
        type: 'stdio',
        command: 'node',
        args: ['/x/inbox.mjs'],
      })
      const settings = JSON.parse(writtenSettings)
      expect(settings.permissions.allow).toEqual(['mcp__inbox__list_unread'])
      expect(settings.permissions.deny).toEqual(['Bash', 'Write'])
      // Drain the line iterator so the temp dir is cleaned up (the run against /bin/true ends fast).
      for await (const _line of handle.lines) void _line
      handle.kill()
    })
  })
  ```
- [ ] Step 2: Run `yarn vitest run packages/server/src/makeClaudeSpawn.test.ts -c vitest.config.ts` from the repo root. Expected FAIL: `Cannot find module './makeClaudeSpawn.js'`.
- [ ] Step 3: Minimal impl. Create `packages/server/src/makeClaudeSpawn.ts` — the generic engine. App-specific values are arguments:
  ```ts
  import { spawn as nodeSpawn, type ChildProcessByStdio } from 'node:child_process'
  import type { Readable } from 'node:stream'
  import { createInterface } from 'node:readline'
  import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
  import { tmpdir } from 'node:os'
  import { join } from 'node:path'
  import type { ClaudeSpawn } from '@atizar/providers'

  // The mcp-config server entry shape `claude --mcp-config` expects (stdio servers).
  export interface McpServerSpec {
    type: 'stdio'
    command: string
    args: string[]
  }

  export interface ClaudeSpawnOptions {
    // The concrete MCP servers (paths resolved by the caller in the app).
    mcpServers: Record<string, McpServerSpec>
    // Built-in tools to deny (the model uses only the MCP tools we allow).
    builtins: string[]
    // Kill a run that outlives a human-scale interaction.
    timeoutMs: number
    // Build the child env from the parent's. The app forwards the full process env (so ATIZAR_*
    // credential vars flow to MCP children) and deletes ANTHROPIC_API_KEY (subscription auth).
    prepareEnv: (base: NodeJS.ProcessEnv) => NodeJS.ProcessEnv
    // Override the spawned binary (default 'claude'); the test points it at a fast-exiting command.
    command?: string
    // Test-only hook fired right after the two temp config files are written (before spawn).
    onConfigWritten?: (mcpConfigPath: string, settingsPath: string) => void
  }

  // Yields stdout lines, and — so the provider never silently ends on a broken run —
  // appends a synthetic `result` error line (which the parser surfaces as text) when
  // the process fails to spawn or times out.
  async function* readLines(
    child: ChildProcessByStdio<null, Readable, Readable>,
    onDone: () => void,
    timeoutMs: number
  ): AsyncGenerator<string> {
    let spawnError: Error | null = null
    let timedOut = false
    child.on('error', (err) => {
      spawnError = err
    })
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGKILL')
      } catch {
        // already gone
      }
    }, timeoutMs)
    try {
      for await (const line of createInterface({ input: child.stdout })) yield line
    } finally {
      clearTimeout(timer)
      onDone()
    }
    if (timedOut) {
      yield JSON.stringify({ type: 'result', is_error: true, result: 'claude run timed out' })
    } else if (spawnError) {
      yield JSON.stringify({
        type: 'result',
        is_error: true,
        result: (spawnError as Error).message,
      })
    }
  }

  // Builds a ClaudeSpawn: writes a temp mcp-config + permission settings, runs `claude` in
  // stream-json mode, exposes stdout as an async line iterator. The caller injects the concrete
  // MCP server paths, the builtins deny-list, the timeout, and the env policy (prepareEnv).
  export function makeClaudeSpawn(opts: ClaudeSpawnOptions): ClaudeSpawn {
    const binary = opts.command ?? 'claude'
    return (prompt, allowedTools) => {
      const dir = mkdtempSync(join(tmpdir(), 'atizar-claude-'))
      const mcpConfig = join(dir, 'mcp.json')
      const settings = join(dir, 'settings.json')
      writeFileSync(mcpConfig, JSON.stringify({ mcpServers: opts.mcpServers }))
      writeFileSync(
        settings,
        JSON.stringify({
          permissions: {
            allow: [...allowedTools],
            deny: opts.builtins,
          },
        })
      )
      opts.onConfigWritten?.(mcpConfig, settings)

      const env = opts.prepareEnv({ ...process.env })

      const child = nodeSpawn(
        binary,
        [
          // NB: do NOT pass --bare — it skips keychain reads, which breaks the
          // subscription (OAuth-in-keychain) auth and yields "Not logged in".
          '-p',
          prompt,
          '--mcp-config',
          mcpConfig,
          '--strict-mcp-config',
          '--disallowed-tools',
          ...opts.builtins,
          '--settings',
          settings,
          '--output-format',
          'stream-json',
          '--verbose',
          '--include-partial-messages',
        ],
        { env, stdio: ['ignore', 'pipe', 'pipe'] }
      )

      const cleanup = () => {
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch {
          // best effort
        }
      }

      return {
        lines: readLines(child, cleanup, opts.timeoutMs),
        kill: () => {
          try {
            child.kill('SIGKILL')
          } catch {
            // already gone
          }
        },
      }
    }
  }
  ```
  Add the barrel exports to `packages/server/src/index.ts`:
  ```ts
  export { makeClaudeSpawn } from './makeClaudeSpawn.js'
  export type { ClaudeSpawnOptions, McpServerSpec } from './makeClaudeSpawn.js'
  ```
- [ ] Step 4: Run `yarn vitest run packages/server/src/makeClaudeSpawn.test.ts -c vitest.config.ts`. Expected PASS: 1 passed (mcp-config + settings written with the injected servers and allow/deny lists).
- [ ] Step 5: Re-point the app. Replace `apps/inbox/server/claude-spawn.ts` with the concrete factory call — the MCP paths, the `BUILTINS`, the timeout, and the `ATIZAR_*`-preserving / `ANTHROPIC_API_KEY`-removing env policy stay HERE as factory args:
  ```ts
  import { fileURLToPath } from 'node:url'
  import { makeClaudeSpawn } from '@atizar/server'
  import type { ClaudeSpawn } from '@atizar/providers'

  // Absolute path to the stdio MCP server scripts.
  const MCP_SERVER = fileURLToPath(new URL('../mcp/inbox-tools.mjs', import.meta.url))
  // The gmail MCP server is a `.mts` file (it imports `@atizar/server` for resolveCredential,
  // which is `.ts` source) → spawned via the tsx loader: `node --import tsx <path>`.
  const GMAIL_SERVER = fileURLToPath(new URL('../mcp/gmail-tools.mts', import.meta.url))
  const GITHUB_SERVER = fileURLToPath(new URL('../mcp/github-tools.mjs', import.meta.url))

  // Built-in tools the model must not use — only our MCP tools are allowed.
  const BUILTINS = ['Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch']

  // A whole run shouldn't outlive a human-scale interaction; kill stuck processes.
  // Triage couriers ~13 tickets into render_triage, which is token-heavy, so give the
  // model headroom beyond the original 120s before we consider it stuck.
  const RUN_TIMEOUT_MS = 180_000

  // Concrete claude spawn for the inbox app. The generic engine lives in @atizar/server; the
  // app injects the MCP server paths, the builtins deny-list, the timeout, and the env policy.
  //
  // ENV POLICY (DO NOT WEAKEN): the child inherits the FULL process env (spread), so the
  // framework's ATIZAR_* vars — ATIZAR_SECRET_KEY / ATIZAR_DATABASE_URL / ATIZAR_CONNECTION /
  // ATIZAR_<PROVIDER>_CLIENT_* — flow through to the spawned MCP servers automatically; that is
  // REQUIRED so an MCP child can `resolveCredential` against the same encrypted store. Do NOT
  // switch to an allow-list of env keys without also forwarding the ATIZAR_* set, or credential
  // resolution in MCP children breaks SILENTLY. ANTHROPIC_API_KEY is the one deliberate removal
  // (subscription auth — see browser-verify).
  export const claudeSpawn: ClaudeSpawn = makeClaudeSpawn({
    mcpServers: {
      inbox: { type: 'stdio', command: 'node', args: [MCP_SERVER] },
      gmail: { type: 'stdio', command: 'node', args: ['--import', 'tsx', GMAIL_SERVER] },
      github: { type: 'stdio', command: 'node', args: [GITHUB_SERVER] },
    },
    builtins: BUILTINS,
    timeoutMs: RUN_TIMEOUT_MS,
    prepareEnv: (base) => {
      const env = { ...base }
      delete env.ANTHROPIC_API_KEY
      return env
    },
  })
  ```
  (`apps/inbox/server/providers.ts:7` keeps `import { claudeSpawn } from './claude-spawn.js'` — the exported `claudeSpawn` const is unchanged in name and `ClaudeSpawn` type.)
- [ ] Step 6: GREEN GATE — `yarn typecheck && yarn test && yarn lint && yarn format:check` from the repo root. Expected: all green.
- [ ] Step 7: Commit.
  ```
  git add packages/server/src/makeClaudeSpawn.ts packages/server/src/makeClaudeSpawn.test.ts packages/server/src/index.ts apps/inbox/server/claude-spawn.ts
  git commit -m "refactor(server): extract makeClaudeSpawn into @atizar/server (app keeps MCP paths + env policy)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```
- [ ] Step 8: **Browser-verify (risk hot-spot)** — run the real claude-cli flow per ## Browser-verify before moving on.

---

### Task 7: `mastra/runner.ts` → `@atizar/providers` (tool map parameterized)

**Files:**
- `packages/providers/package.json` (add deps `@mastra/core`, `@mastra/pg`, `@ai-sdk/anthropic`, `zod`)
- `packages/providers/src/mastraRunner.ts` (create — `makeMastraRunner`, `unwrapStepOutput`, `MastraRunnerConfig`, `MastraToolLike`)
- `packages/providers/src/mastraRunner.test.ts` (create — from `apps/inbox/server/mastra/runner.test.ts:1-53`)
- `packages/providers/src/index.ts` (barrel: `export * from './mastraRunner.js'`)
- `apps/inbox/server/mastra/runner.ts`, `apps/inbox/server/mastra/runner.test.ts` (delete)
- `apps/inbox/server/providers.ts` (build `ALL_TOOLS` from `./mastra/tools.js`, inject as `tools`)

> **RISK HOT-SPOT.** Shared `PostgresStore` pool + suspend/resume. Browser-verify `PROVIDER=mastra` incl. an HITL approval (see ## Browser-verify). `MastraRunner`/`MastraChunk`/`MastraRunResult` types already live in `@atizar/providers/src/mastra-types.ts` — do NOT redefine them; the runner imports them from `./mastra-types.js`. `PostgresStore` is Node-bound; that is fine in `@atizar/providers` — `mastraRunner.ts` is a Node-only module imported only by the server-side composition root, never the client (same discipline as the injected `spawn`).

- [ ] Step 1: Add the deps + write the failing test.
  In `packages/providers/package.json`, set `dependencies` (matching the app's pinned versions from `apps/inbox/package.json`: `@mastra/core ^1.41.0`, `@mastra/pg ^1.12.1`, `@ai-sdk/anthropic ^3.0.82`, `zod ^3.25.76`):
  ```json
    "dependencies": {
      "@ag-ui/client": "^0.0.55",
      "@ai-sdk/anthropic": "^3.0.82",
      "@atizar/core": "*",
      "@mastra/core": "^1.41.0",
      "@mastra/pg": "^1.12.1",
      "zod": "^3.25.76"
    }
  ```
  Run `yarn install --ignore-engines` from the repo root (Node 20.14 needs `--ignore-engines`). Create `packages/providers/src/mastraRunner.test.ts` from `apps/inbox/server/mastra/runner.test.ts`, with three changes: (a) line 2 imports `MastraChunk` from `./mastra-types.js`; (b) the unit under test imports from `./mastraRunner.js`; (c) `baseConfig` gains the now-required `tools` map. Full file:
  ```ts
  import { describe, it, expect } from 'vitest'
  import type { MastraChunk } from './mastra-types.js'
  import { unwrapStepOutput, makeMastraRunner } from './mastraRunner.js'

  const baseConfig = {
    agentId: 'wf__agent',
    instructions: 'do the thing',
    approvalNames: [] as string[],
    readTools: [] as string[],
    renderAndProposeTools: [] as string[],
    model: 'claude-sonnet-4-6',
    databaseUrl: 'postgres://unused',
    prompts: { buildFirst: () => 'PROMPT', buildResume: () => null },
    tools: {} as Record<string, unknown>,
  }

  describe('makeMastraRunner tool resolution', () => {
    it('throws a clear error when an allow-listed tool is not in the injected tools map', () => {
      // The tools map is built before any Mastra/DB construction, so this throws synchronously
      // without touching Postgres.
      expect(() => makeMastraRunner({ ...baseConfig, readTools: ['nonexistent'] })).toThrow(
        /Mastra has no tool "nonexistent"/
      )
    })
  })

  describe('unwrapStepOutput', () => {
    it('unwraps a workflow-step-output envelope to its payload.output', () => {
      const inner: MastraChunk = { type: 'text-delta', payload: { text: 'hello' } }
      const wrapped = {
        type: 'workflow-step-output',
        payload: { output: inner },
      } as unknown as MastraChunk
      expect(unwrapStepOutput(wrapped)).toBe(inner)
    })

    it('passes through non-envelope chunks unchanged', () => {
      const chunk: MastraChunk = {
        type: 'tool-call',
        payload: { toolName: 'renderLead', toolCallId: 'tc1', args: {} },
      }
      expect(unwrapStepOutput(chunk)).toBe(chunk)
    })

    it('passes through workflow-start / workflow-finish unchanged (no output field)', () => {
      const chunk = { type: 'workflow-start' } as unknown as MastraChunk
      expect(unwrapStepOutput(chunk)).toBe(chunk)
    })

    it('falls back to the raw chunk when payload.output is missing', () => {
      const chunk = { type: 'workflow-step-output', payload: {} } as unknown as MastraChunk
      expect(unwrapStepOutput(chunk)).toBe(chunk)
    })
  })
  ```
- [ ] Step 2: Run `yarn vitest run packages/providers/src/mastraRunner.test.ts -c vitest.config.ts` from the repo root. Expected FAIL: `Cannot find module './mastraRunner.js'`.
- [ ] Step 3: Minimal impl. Create `packages/providers/src/mastraRunner.ts` from `apps/inbox/server/mastra/runner.ts` with exactly TWO behavioral changes: (a) drop the hard `import { … } from './tools.js'` (original lines 10-25) and the `ALL_TOOLS` const (original lines 58-74); (b) add a `tools` field to `MastraRunnerConfig` and resolve against it. The head of the new file:
  ```ts
  import { Mastra } from '@mastra/core'
  import { Agent } from '@mastra/core/agent'
  import { createStep, createWorkflow } from '@mastra/core/workflows'
  import { PostgresStore } from '@mastra/pg'
  import { anthropic } from '@ai-sdk/anthropic'
  import { z } from 'zod'
  import { type GateResolution, type Message, type PromptStrategy } from '@atizar/core'
  import type { RunAgentInput } from '@ag-ui/client'
  import type { MastraRunner, MastraRun, MastraChunk, MastraRunResult } from './mastra-types.js'

  // A Mastra tool is opaque to the runner — the app builds the concrete map and injects it. Kept
  // structural (the runner only hands these straight to `new Agent({ tools })`) so the package has
  // no compile-time dependency on the app's tool definitions.
  export type MastraToolLike = unknown

  export interface MastraRunnerConfig {
    agentId: string
    instructions: string
    approvalNames: readonly string[] // [] for the qualifier
    readTools: readonly string[] // e.g. ['get_latest_email']
    renderAndProposeTools: readonly string[] // e.g. ['renderLead','saveDraft'] or ['renderVerdict']
    model: string // e.g. 'claude-sonnet-4-6'
    databaseUrl: string
    // The agent's prompt strategy — the SAME object claude-cli uses. The runner builds the
    // first-turn prompt from `buildFirst` so both providers share ONE prompt source (per workflow's
    // `prompts` module); there is no Mastra-specific prompt path.
    prompts: PromptStrategy
    // The concrete tool map, injected by the app (drops the old hard ./tools.js import). Keyed by
    // bare tool name; the runner picks the subset named by readTools + renderAndProposeTools.
    tools: Record<string, MastraToolLike>
  }
  ```
  …then the `sharedStore`/`getSharedStore` block (original lines 44-56) VERBATIM; then `unwrapStepOutput` + its `StepOutputChunk` interface (original lines 78-89) VERBATIM; then `MastraStreamLike`/`MastraRunLike` (original 91-103) VERBATIM; then `makeMastraRunner` (original 105-287) VERBATIM EXCEPT the tool-resolution block at the top of the function changes from `ALL_TOOLS[n as keyof typeof ALL_TOOLS]` to the injected map:
  ```ts
    const tools = Object.fromEntries(
      [...cfg.readTools, ...cfg.renderAndProposeTools].map((n) => {
        const t = cfg.tools[n]
        if (!t)
          throw new Error(`Mastra has no tool "${n}" — add it to the tools map injected by the app`)
        return [n, t]
      })
    )
  ```
  Add the barrel export to `packages/providers/src/index.ts` (after line 6):
  ```ts
  export * from './mastraRunner.js'
  ```
- [ ] Step 4: Run `yarn vitest run packages/providers/src/mastraRunner.test.ts -c vitest.config.ts`. Expected PASS: 1 (`tool resolution`) + 4 (`unwrapStepOutput`) = 5 passed.
- [ ] Step 5: Re-point the app + delete. Edit `apps/inbox/server/providers.ts`: change line 8 `import { makeMastraRunner } from './mastra/runner.js'` to `import { makeMastraRunner } from '@atizar/providers'` (or fold into the existing `@atizar/providers` import block on lines 2-6). Add the tools import + the `ALL_TOOLS` const near the top (after the existing imports, before `MASTRA_MODEL` on line 11):
  ```ts
  import {
    getLatestEmailTool,
    renderLeadTool,
    renderVerdictTool,
    saveDraftTool,
    listUnreadTool,
    getEmailTool,
    routeEmailsTool,
    renderSortTool,
    applyActionsTool,
    listMyTicketsTool,
    getTicketTool,
    renderTriageTool,
    renderTicketResultTool,
    renderReplyDraftTool,
  } from './mastra/tools.js'

  // The concrete Mastra tool map (was ALL_TOOLS in mastra/runner.ts; the runner is now generic and
  // takes this map as a parameter — WS7 move 7).
  const ALL_TOOLS = {
    get_latest_email: getLatestEmailTool,
    renderLead: renderLeadTool,
    renderVerdict: renderVerdictTool,
    saveDraft: saveDraftTool,
    list_unread: listUnreadTool,
    get_email: getEmailTool,
    route_emails: routeEmailsTool,
    renderSort: renderSortTool,
    applyActions: applyActionsTool,
    // github-triage (claude-cli only) — registered so PROVIDER=mastra boots; reads are stubs.
    list_my_tickets: listMyTicketsTool,
    get_ticket: getTicketTool,
    render_triage: renderTriageTool,
    render_ticket_result: renderTicketResultTool,
    render_reply_draft: renderReplyDraftTool,
  }
  ```
  Inside `mastraFactory`, pass `tools: ALL_TOOLS` to the existing `makeMastraRunner({ … })` call:
  ```ts
    const runner = makeMastraRunner({
      agentId: config.agentId,
      instructions: config.instructions,
      approvalNames: config.approvalNames,
      readTools,
      renderAndProposeTools,
      model: MASTRA_MODEL,
      // Reuse the pipeline's resolved DB URL (defaults to the compose creds) — a single source
      // of truth, so PROVIDER=mastra needs no extra env beyond ANTHROPIC_API_KEY.
      databaseUrl,
      // The SAME PromptStrategy claude-cli uses — one prompt source for both providers.
      prompts: config.prompts,
      tools: ALL_TOOLS,
    })
  ```
  Delete the moved runner files:
  ```
  git rm apps/inbox/server/mastra/runner.ts apps/inbox/server/mastra/runner.test.ts
  ```
  (`apps/inbox/server/mastra/tools.ts` STAYS — it is genuinely app-specific Gmail tooling.)
- [ ] Step 6: GREEN GATE — `yarn typecheck && yarn test && yarn lint && yarn format:check` from the repo root. Expected: all green (the runner test now runs under `packages/providers/src/`; the app builds + injects the tool map).
- [ ] Step 7: Commit.
  ```
  git add packages/providers/package.json packages/providers/src/mastraRunner.ts packages/providers/src/mastraRunner.test.ts packages/providers/src/index.ts apps/inbox/server/providers.ts apps/inbox/server/mastra/runner.ts apps/inbox/server/mastra/runner.test.ts yarn.lock
  git commit -m "refactor(providers): move makeMastraRunner into @atizar/providers with parameterized tool map

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```
- [ ] Step 8: **Browser-verify (risk hot-spot)** — run `PROVIDER=mastra` including an HITL approval per ## Browser-verify before moving on.

---

### Task 8: `build-agent.ts` → `@atizar/server` with injected `wrap`

**Files:**
- `packages/server/src/buildAgent.ts` (create — `buildAgentProvider(...)` with injected `wrap?`)
- `packages/server/src/buildAgent.test.ts` (create)
- `packages/server/src/index.ts` (barrel: `buildAgentProvider`, `type BuildAgentWrap`, `type BuildAgentArgs`)
- `apps/inbox/server/build-agent.ts` (reduce to the app wrapper that constructs `buildProvider` + injects the dev `wrap`)
- `apps/inbox/eval/runner.ts` (unchanged — it imports the app `buildProvider`, signature preserved)

> Depends on Task 2 (record/replay moved to `@atizar/server`). The record/replay decorator is **injected** (a `wrap?` callback), NOT a hard import — so `@atizar/server`'s `buildAgentProvider` stays free of the app's cassette-dir knowledge. The app's `buildProvider` (kept name + signature: `(def, prompts, registry, allowedTools, instanceKey, composedInstructions?)`) is the SAME function both `index.ts` and `eval/runner.ts` call, so neither caller changes.

- [ ] Step 1: Write the failing test. Create `packages/server/src/buildAgent.test.ts` — assert (a) the resolved provider is returned when no `wrap` is given, and (b) `wrap` is applied (and gets the right context) when provided:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { defineAgent, defineProviders } from '@atizar/core'
  import type { Provider } from '@atizar/core'
  import { buildAgentProvider } from './buildAgent.js'

  const def = defineAgent({
    id: 'reply',
    name: 'REPLY',
    provider: 'mock',
    instructions: 'x',
    tools: ['saveDraft'],
    approvals: ['saveDraft'],
    renders: { saveDraft: 'ApprovalDialog' },
  })

  // eslint-disable-next-line require-yield
  const baseProvider: Provider = { async *run() {} }
  const registry = defineProviders({ mock: () => baseProvider })

  describe('buildAgentProvider', () => {
    it('returns the resolved provider unchanged when no wrap is given', () => {
      const p = buildAgentProvider({
        def,
        prompts: { buildFirst: () => 'p', buildResume: () => null },
        registry,
        allowedTools: ['saveDraft'],
        instanceKey: 'wf__reply',
      })
      expect(p).toBe(baseProvider)
    })

    it('applies the injected wrap (receives provider + instanceKey + approvalNames)', () => {
      // eslint-disable-next-line require-yield
      const wrapped: Provider = { async *run() {} }
      let seenKey = ''
      const p = buildAgentProvider({
        def,
        prompts: { buildFirst: () => 'p', buildResume: () => null },
        registry,
        allowedTools: ['saveDraft'],
        instanceKey: 'wf__reply',
        wrap: (provider, ctx) => {
          seenKey = ctx.instanceKey
          expect(provider).toBe(baseProvider)
          expect(ctx.approvalNames).toEqual(['saveDraft'])
          return wrapped
        },
      })
      expect(p).toBe(wrapped)
      expect(seenKey).toBe('wf__reply')
    })
  })
  ```
- [ ] Step 2: Run `yarn vitest run packages/server/src/buildAgent.test.ts -c vitest.config.ts` from the repo root. Expected FAIL: `Cannot find module './buildAgent.js'`.
- [ ] Step 3: Minimal impl. Create `packages/server/src/buildAgent.ts`:
  ```ts
  import type { AgentDefinition, ProviderRegistry, PromptStrategy, Provider } from '@atizar/core'

  // The dev record/replay decorator (or any provider wrapper) is INJECTED — the framework helper
  // never hard-imports it, so cassette-dir knowledge stays in the app. The wrap receives the
  // resolved provider plus the context it needs to key a cassette (instanceKey + approvalNames).
  export type BuildAgentWrap = (
    provider: Provider,
    ctx: { instanceKey: string; approvalNames: readonly string[] }
  ) => Provider

  export interface BuildAgentArgs {
    def: AgentDefinition
    prompts: PromptStrategy
    registry: ProviderRegistry
    allowedTools: readonly string[]
    instanceKey: string
    // The fully composed instructions (workflow prompt + agent instructions); falls back to
    // def.instructions when absent.
    composedInstructions?: string
    // Optional decorator (dev record/replay). Unset ⇒ the resolved provider is returned unchanged.
    wrap?: BuildAgentWrap
  }

  // Resolves the provider FACTORY for an agent passport and constructs the provider from the
  // passport (approvals/tools) + this agent's prompt strategy, then applies the injected `wrap`
  // when one is given (unset ⇒ byte-identical to the resolved provider). `instanceKey` (wf__agent)
  // is the cassette key the wrap uses.
  export function buildAgentProvider(args: BuildAgentArgs): Provider {
    const { def, prompts, registry, allowedTools, instanceKey, composedInstructions, wrap } = args
    const makeProvider = registry.resolve(def.provider)
    const provider = makeProvider({
      approvalNames: def.approvals,
      surfaceTools: def.tools,
      allowedTools,
      prompts,
      instructions: composedInstructions ?? def.instructions,
      agentId: instanceKey,
    })
    return wrap ? wrap(provider, { instanceKey, approvalNames: def.approvals }) : provider
  }
  ```
  Add the barrel exports to `packages/server/src/index.ts`:
  ```ts
  export { buildAgentProvider } from './buildAgent.js'
  export type { BuildAgentWrap, BuildAgentArgs } from './buildAgent.js'
  ```
- [ ] Step 4: Run `yarn vitest run packages/server/src/buildAgent.test.ts -c vitest.config.ts`. Expected PASS: 2 passed.
- [ ] Step 5: Re-point the app. Replace `apps/inbox/server/build-agent.ts` so the app's `buildProvider` constructs the dev `wrap` (record/replay with the app's cassette dirs) and delegates to `buildAgentProvider`, keeping the SAME signature the two callers use:
  ```ts
  import type { AgentDefinition, ProviderRegistry, PromptStrategy, Provider } from '@atizar/core'
  import { buildAgentProvider, isDemo } from '@atizar/server'
  import {
    withRecordReplay,
    recordReplayMode,
    cassettesDir,
    demoCassettesDir,
  } from './record-replay.js'

  // App wrapper over @atizar/server's buildAgentProvider (WS7 move 8). It injects the dev
  // record/replay decorator built from the APP's cassette directories — DEV_RECORD_REPLAY unset ⇒
  // no wrap ⇒ byte-identical production path. Signature unchanged so index.ts + eval/runner.ts are
  // unaffected.
  export function buildProvider(
    def: AgentDefinition,
    prompts: PromptStrategy,
    registry: ProviderRegistry,
    allowedTools: readonly string[],
    instanceKey: string,
    composedInstructions?: string
  ): Provider {
    const mode = isDemo() ? 'demo' : recordReplayMode()
    return buildAgentProvider({
      def,
      prompts,
      registry,
      allowedTools,
      instanceKey,
      composedInstructions,
      wrap: mode
        ? (provider, ctx) =>
            withRecordReplay(provider, {
              key: ctx.instanceKey,
              approvalNames: ctx.approvalNames,
              dir: mode === 'demo' ? demoCassettesDir() : cassettesDir(),
              mode,
            })
        : undefined,
    })
  }
  ```
  `apps/inbox/server/index.ts:6` (`import { buildProvider } from './build-agent.js'`) and `apps/inbox/eval/runner.ts:5` (`import { buildProvider } from '../server/build-agent.js'`) keep working unchanged — verified: both call `buildProvider(def, b.prompts, providerRegistry, b.allowedTools, key, composed)`.
- [ ] Step 6: GREEN GATE — `yarn typecheck && yarn test && yarn lint && yarn format:check` from the repo root. Expected: all green.
- [ ] Step 7: Commit.
  ```
  git add packages/server/src/buildAgent.ts packages/server/src/buildAgent.test.ts packages/server/src/index.ts apps/inbox/server/build-agent.ts
  git commit -m "refactor(server): move buildAgentProvider into @atizar/server with injected record/replay wrap

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 9: `createServer` factory → `@atizar/server` (most invasive, last)

**Files:**
- `packages/server/src/createServer.ts` (create — register loop + handoff check + health cache + Hono assembly + boot, via STRUCTURAL `WorkflowServerLike`/`ServerBindingLike` types)
- `packages/server/src/createServer.test.ts` (create — `start:false` exercises handoff-check + register-loop + demo-filter)
- `packages/server/src/index.ts` (barrel: `createServer` + the `*Like` types)
- `apps/inbox/server/index.ts` (reduce to the app shell: concrete imports + demo filter + `createServer({ start: true })`)

> Depends on Tasks 2/3/4/8 (record/replay, agent-checks, deriveConnectionList+providerHealth, buildAgentProvider all in `@atizar/server`). `@atizar/server` MUST stay userland-free — so the factory takes **structural** `WorkflowServerLike`/`ServerBindingLike` types (NOT app imports of the concrete `workflowServers`). `start?: boolean` lets the unit test drive the handoff-check + register-loop + demo-filter WITHOUT `serve`/`runMigrations`/`startupSweep`. `WorkflowAgent` requires a `role` field (`defineWorkflow.ts`) — the test descriptor fixture sets `role: 'input'`.

> **RISK HOT-SPOT.** Boot path. Browser-verify boot + board + a full pipeline run (see ## Browser-verify).

- [ ] Step 1: Write the failing test. Create `packages/server/src/createServer.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { defineAgent, defineProviders, instanceId } from '@atizar/core'
  import type { Provider } from '@atizar/core'
  import { createServer } from './createServer.js'

  // eslint-disable-next-line require-yield
  const baseProvider: Provider = { async *run() {} }
  const registry = defineProviders({ mock: () => baseProvider })

  const agent = defineAgent({
    id: 'sorter',
    name: 'SORTER',
    provider: 'mock',
    instructions: 'x',
    tools: ['renderSort'],
    approvals: [],
    renders: { renderSort: 'SortCard' },
    readonly: ['renderSort'],
  })

  const descriptor = {
    id: 'email-inbox',
    label: 'Email',
    iconName: 'inbox',
    agents: [{ agent, role: 'input' as const }],
    entryAgentId: 'sorter',
    inputs: [],
  }

  const workflowServers = [
    {
      descriptor,
      bindings: () => [
        {
          agentId: 'sorter',
          allowedTools: ['renderSort'],
          prompts: { buildFirst: () => 'p', buildResume: () => null },
        },
      ],
    },
  ]

  // The app's buildProvider shape (resolve the factory + construct) — inlined for the test.
  const buildProvider: Parameters<typeof createServer>[0]['buildProvider'] = (
    def,
    prompts,
    reg,
    allowed,
    key
  ) =>
    reg.resolve(def.provider)({
      approvalNames: def.approvals,
      surfaceTools: def.tools,
      allowedTools: allowed,
      prompts,
      instructions: def.instructions,
      agentId: key,
    })

  describe('createServer (start: false)', () => {
    it('registers every enabled workflow × agent under its instance id', async () => {
      const built = await createServer({
        workflowServers,
        providerRegistry: registry,
        buildProvider,
        connections: [],
        scopesFor: () => [],
        enabledWorkflows: null,
        start: false,
      })
      expect(Object.keys(built.runtimes)).toEqual([instanceId('email-inbox', 'sorter')])
      expect(built.runtimes[instanceId('email-inbox', 'sorter')].renderToolNames).toEqual([
        'renderSort',
      ])
    })

    it('the demo filter narrows to the enabled workflow ids', async () => {
      const built = await createServer({
        workflowServers,
        providerRegistry: registry,
        buildProvider,
        connections: [],
        scopesFor: () => [],
        enabledWorkflows: ['nonexistent'],
        start: false,
      })
      expect(Object.keys(built.runtimes)).toEqual([])
    })
  })
  ```
- [ ] Step 2: Run `yarn vitest run packages/server/src/createServer.test.ts -c vitest.config.ts` from the repo root. Expected FAIL: `Cannot find module './createServer.js'`.
- [ ] Step 3: Minimal impl. Create `packages/server/src/createServer.ts` — lift the register loop + handoff check + health cache + Hono assembly + boot from `apps/inbox/server/index.ts:28-182`, parameterized by structural types so no app symbol is imported:
  ```ts
  import { serve } from '@hono/node-server'
  import { Hono } from 'hono'
  import {
    instanceId,
    composeInstructions,
    aggregateHealth,
    type AgentDefinition,
    type ProviderRegistry,
    type PromptStrategy,
    type Provider,
    type WorkflowDescriptor,
    type EffectFn,
    type HealthCheck,
  } from '@atizar/core'
  import { db } from './db/client.js'
  import { runMigrations } from './db/migrate.js'
  import { startupSweep } from './sweep.js'
  import { makePipelineService } from './pipelineService.js'
  import { createPipelineRoutes } from './routes.js'
  import { makeCredentialStore } from './credentialStore.js'
  import { createConnectRoutes, type ConnectionDescriptor } from './connectRoutes.js'
  import { createAuthMiddleware } from './auth.js'
  import { atizarEnv, isDemo } from './env.js'
  import { assertAgentClassification } from './agentChecks.js'
  import { providerHealth } from './providerHealth.js'
  import type { AgentRuntime } from './runObserver.js'

  // Structural views of the app's workflow-server registry — @atizar/server stays userland-free
  // (no import of the concrete `workflowServers`). The app passes objects matching these shapes.
  export interface ServerBindingLike {
    agentId: string
    allowedTools: string[]
    prompts: PromptStrategy
    effects?: Record<string, EffectFn>
    health?: { check: () => Promise<HealthCheck> }[]
  }
  export interface WorkflowServerLike {
    descriptor: WorkflowDescriptor
    bindings: (workflowId: string) => ServerBindingLike[]
  }

  // The app injects how a provider is built (so the dev record/replay wrap stays app-side — move 8).
  export type BuildProviderFn = (
    def: AgentDefinition,
    prompts: PromptStrategy,
    registry: ProviderRegistry,
    allowedTools: readonly string[],
    instanceKey: string,
    composedInstructions?: string
  ) => Provider

  export interface CreateServerArgs {
    workflowServers: WorkflowServerLike[]
    providerRegistry: ProviderRegistry
    buildProvider: BuildProviderFn
    connections: ConnectionDescriptor[]
    scopesFor: (integration: string) => string[]
    // null = all workflows; an array = the demo filter (only these ids enabled).
    enabledWorkflows: string[] | null
    // When false, assemble + register but do NOT serve/migrate/sweep (the unit-test path).
    start?: boolean
  }

  export interface BuiltServer {
    app: Hono
    runtimes: Record<string, AgentRuntime>
    refreshHealth: () => Promise<Record<string, HealthCheck>>
  }

  export async function createServer(args: CreateServerArgs): Promise<BuiltServer> {
    const { workflowServers, providerRegistry, buildProvider, connections, scopesFor } = args
    const activeWorkflowServers = args.enabledWorkflows
      ? workflowServers.filter((w) => args.enabledWorkflows!.includes(w.descriptor.id))
      : workflowServers

    // Wiring-time check: a passport must not hand off to an agent absent from its own workflow.
    for (const { descriptor } of activeWorkflowServers) {
      const ids = new Set(descriptor.agents.map((a) => a.agent.id))
      for (const { agent } of descriptor.agents) {
        for (const target of agent.handoffs ?? []) {
          if (!ids.has(target)) {
            throw new Error(
              `Agent "${agent.id}" in "${descriptor.id}" hands off to unknown agent "${target}"`
            )
          }
        }
      }
    }

    const runtimes: Record<string, AgentRuntime> = {}
    const healthInputs: Record<
      string,
      { provider: string; checks: (() => Promise<HealthCheck>)[] }
    > = {}

    for (const { descriptor, bindings } of activeWorkflowServers) {
      const byId = new Map(descriptor.agents.map((a) => [a.agent.id, a.agent]))
      for (const b of bindings(descriptor.id)) {
        const def = byId.get(b.agentId)
        if (!def)
          throw new Error(`server binding for unknown agent "${b.agentId}" in "${descriptor.id}"`)
        assertAgentClassification(def, { allowedTools: b.allowedTools, effects: b.effects })
        const key = instanceId(descriptor.id, b.agentId)
        const composed = composeInstructions(descriptor.prompt, def.instructions)
        const provider = buildProvider(
          def,
          b.prompts,
          providerRegistry,
          b.allowedTools,
          key,
          composed
        )
        runtimes[key] = {
          provider,
          renderToolNames: Object.keys(def.renders),
          maxInstances: def.maxInstances,
          effects: b.effects ?? {},
          dispatchToolNames: def.dispatches,
          handoffs: def.handoffs ?? [],
        }
        healthInputs[key] = {
          provider: def.provider,
          checks: (b.health ?? []).map((h) => h.check),
        }
      }
    }

    let agentHealthCache: Record<string, HealthCheck> = {}

    async function computeAgentHealth(): Promise<Record<string, HealthCheck>> {
      if (isDemo()) {
        return Object.fromEntries(Object.keys(healthInputs).map((key) => [key, { ok: true }]))
      }
      const entries = await Promise.all(
        Object.entries(healthInputs).map(async ([key, { provider, checks }]) => {
          const provCheck = providerHealth(provider)
          const bindingChecks = await Promise.all(
            checks.map((check) =>
              check().catch(
                (e): HealthCheck => ({
                  ok: false,
                  error: String(e),
                  hint: 'binding health check threw an unexpected error',
                })
              )
            )
          )
          return [key, aggregateHealth([provCheck, ...bindingChecks])] as const
        })
      )
      return Object.fromEntries(entries)
    }

    async function refreshHealth(): Promise<Record<string, HealthCheck>> {
      agentHealthCache = await computeAgentHealth()
      return agentHealthCache
    }

    const pipeline = makePipelineService({
      db,
      resolveAgent: (id) => runtimes[id],
      descriptors: activeWorkflowServers.map((w) => w.descriptor),
      getAgentHealth: () => agentHealthCache,
      refreshHealth,
    })

    const app = new Hono()
    const authToken = atizarEnv.authToken()
    app.use('*', createAuthMiddleware({ token: authToken, demo: isDemo() }))
    app.get('/api/config', (c) =>
      c.json({ demo: isDemo(), workflows: activeWorkflowServers.map((w) => w.descriptor.id) })
    )
    app.route('/', createPipelineRoutes(pipeline))
    app.route(
      '/',
      createConnectRoutes({ store: makeCredentialStore(db), scopesFor, list: connections })
    )

    if (args.start) {
      await runMigrations()
      await startupSweep(db, (item) => pipeline.reenqueue(item))
      serve({ fetch: app.fetch, port: 4000 })
      console.log('server on http://localhost:4000')
      if (!isDemo() && !authToken) {
        console.warn('[auth] disabled — set ATIZAR_AUTH_TOKEN to require a token on mutations')
      }
      try {
        const health = await refreshHealth()
        const values = Object.values(health)
        const okCount = values.filter((h) => h.ok).length
        const failCount = values.length - okCount
        const parts = [`${okCount} ok`]
        if (failCount > 0) parts.push(`${failCount} missing-creds`)
        console.log(`health: ${parts.join(', ')}`)
      } catch (e) {
        console.error('[health] boot sweep failed (non-fatal):', e)
      }
    }

    return { app, runtimes, refreshHealth }
  }
  ```
  (NOTE: `runMigrations` is exported from `./db/migrate.js` in this package; `db` from `./db/client.js`. Confirm those module paths against `packages/server/src/index.ts` — the barrel re-exports `runMigrations` from `./db/migrate.js` and `db` from `./db/client.js`.) Add the barrel exports to `packages/server/src/index.ts`:
  ```ts
  export { createServer } from './createServer.js'
  export type {
    CreateServerArgs,
    BuiltServer,
    BuildProviderFn,
    WorkflowServerLike,
    ServerBindingLike,
  } from './createServer.js'
  ```
- [ ] Step 4: Run `yarn vitest run packages/server/src/createServer.test.ts -c vitest.config.ts`. Expected PASS: 2 passed (registers under instance id; demo filter narrows to enabled ids).
- [ ] Step 5: Re-point the app. Replace `apps/inbox/server/index.ts` with the thin app shell — concrete imports + demo filter + `createServer({ start: true })`:
  ```ts
  import './load-dev-env.js' // MUST be first: loads .env.local (dev) before any env read below
  import { createServer, isDemo } from '@atizar/server'
  import { providerRegistry } from './providers.js'
  import { buildProvider } from './build-agent.js'
  import { workflowServers } from './workflows.js'
  import { scopesFor, connectionList } from './connections.js'

  // In demo mode only the flagship email-inbox workflow is enabled (zero-cred showcase); otherwise
  // all workflows are active (null = all).
  const ENABLED_WORKFLOWS: string[] | null = isDemo() ? ['email-inbox'] : null

  void createServer({
    workflowServers,
    providerRegistry,
    buildProvider,
    connections: connectionList,
    scopesFor,
    enabledWorkflows: ENABLED_WORKFLOWS,
    start: true,
  }).catch((err) => {
    console.error('[server] boot failed:', err)
    process.exit(1)
  })
  ```
  (`workflowServers` from `./workflows.js` already matches `WorkflowServerLike` structurally — each entry is `{ descriptor, bindings(workflowId) => ServerBinding[] }`; `buildProvider` from `./build-agent.js` matches `BuildProviderFn`. No app-side type churn needed.)
- [ ] Step 6: GREEN GATE — `yarn typecheck && yarn test && yarn lint && yarn format:check` from the repo root. Expected: all green.
- [ ] Step 7: Commit.
  ```
  git add packages/server/src/createServer.ts packages/server/src/createServer.test.ts packages/server/src/index.ts apps/inbox/server/index.ts
  git commit -m "refactor(server): extract createServer factory into @atizar/server; app shell becomes thin

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```
- [ ] Step 8: **Browser-verify (risk hot-spot)** — boot + board + a full pipeline run per ## Browser-verify before moving on.

---

### Task 10: Delete the empty `pipeline/` dir

**Files:**
- `apps/inbox/server/pipeline/` (delete — stale empty, git-untracked)

- [ ] Step 1: Confirm it is empty and untracked. Run `ls -la apps/inbox/server/pipeline/ && git ls-files apps/inbox/server/pipeline/` from the repo root. Expected: only `.`/`..` entries; `git ls-files` prints nothing (untracked, no tracked file inside).
- [ ] Step 2: Remove the directory. Run `rmdir apps/inbox/server/pipeline` from the repo root. Expected: no output (the empty dir is gone). (If a tracked file appeared meanwhile, STOP — re-check; the spec says nothing should be committed unless a tracked file is present.)
- [ ] Step 3: GREEN GATE — `yarn typecheck && yarn test && yarn lint && yarn format:check` from the repo root. Expected: all green (nothing referenced the dir).
- [ ] Step 4: Commit only if a tracked deletion is staged. Run `git status --porcelain apps/inbox/server/pipeline` — empty output means the dir was untracked and there is nothing to commit (record the on-disk removal in HANDOFF as a no-op cleanup). Commit only if a tracked deletion shows:
  ```
  git status --porcelain
  # if (and only if) a tracked deletion shows for pipeline/:
  git add -A apps/inbox/server/pipeline
  git commit -m "chore(inbox): remove stale empty server/pipeline directory

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Done when

Every moved symbol is imported from its package (no app-internal copy); userland imports only the public SDK (I5 intact); the empty `pipeline/` dir is gone; green gate after EACH move; browser-verify after the three risk hot-spots and the final factory.

Concrete post-state to verify:
- `apps/inbox/server/health.ts`, `agent-checks.ts`, `parse-env.ts`, `mastra/runner.ts` are **deleted**; `record-replay.ts`, `load-dev-env.ts`, `claude-spawn.ts`, `connections.ts`, `build-agent.ts`, `index.ts` are reduced to app-specific shells / re-exports.
- `@atizar/core` exports `aggregateHealth`; `@atizar/server` exports `withRecordReplay`/`CassetteStore`/`recordReplayMode`/`scanCassette`/`Finding`/`RecordReplayMode`, `assertAgentClassification`, `deriveConnectionList`, `providerHealth`, `parseEnvFile`/`loadDevEnv`, `makeClaudeSpawn`, `buildAgentProvider`, `createServer`; `@atizar/providers` exports `makeMastraRunner`.
- `apps/inbox/server/pipeline/` does not exist.
- `yarn typecheck && yarn test && yarn lint && yarn format:check` is green from the repo root.

## Browser-verify

Invoke the **`browser-verify`** skill (dev-server hygiene + Playwright-MCP recovery) before each verification. The three risk hot-spots + the factory:

1. **After Task 6 (`makeClaudeSpawn`) — real claude-cli flow.** A dropped `ATIZAR_*` env-forward breaks MCP-child credential resolution **silently** (no typecheck/unit failure). With `DEV_RECORD_REPLAY` unset (real provider) and Gmail credentials present, run `yarn dev` from the repo root, open the email-inbox workflow, press START, and confirm the agent actually reads email via the gmail MCP and surfaces a card — i.e. the MCP children resolved credentials. A frozen/empty run or a credential error in the server log = a broken env-forward (`prepareEnv` must forward the full `process.env` and delete only `ANTHROPIC_API_KEY`).
2. **After Task 7 (`makeMastraRunner`) — `PROVIDER=mastra` incl. HITL.** With `ANTHROPIC_API_KEY` set, run `PROVIDER=mastra yarn dev` from the repo root. Drive a workflow to an approval gate, confirm the run **suspends** (the shared `PostgresStore` pool + suspend), then **approve** and confirm it **resumes** and the effect runs. A "too many clients" Postgres error or a resume that never fires = a runner regression.
3. **After Task 9 (`createServer`) — boot + board + a full pipeline run.** Run `yarn dev` from the repo root; confirm the server boots on `:4000` (the `health: N ok` log line appears), the board loads at `:5173`, and a full START → card → approval → effect pipeline run completes. A boot crash, an empty board, or a stalled run = a factory wiring regression.
