# Email-inbox Stage 2 — Core + Server Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the framework capabilities the email-inbox workflow needs, server-side only (NO React this stage): F9 thin integration contract, F1 workflow-level prompt, F2 machine-dispatch tool class, F3 credential-health surface, F4 activity feed, F6 singleton START guard, and a global `POST /api/cancel-all`.

**Architecture:** All changes are additive to existing seams. New shared types go in `@atizar/core` (engine-free, React-free). Server logic goes in `@atizar/server` (the pipeline spine) + thin app wiring in `apps/inbox/server`. The data shapes the UI will later read (board `agentHealth`, activity entries) are added to `@atizar/react/src/serverTypes.ts` as plain types — but NO components are built this stage (that is Stage 4). Both providers (claude-cli + Mastra) must satisfy the extended conformance suite.

**Tech Stack:** TypeScript (strict), zod v3, drizzle (Postgres, already wired), Hono routes, vitest. yarn-classic workspace, NO build step (packages export `./src/index.ts`). Run everything from the repo root.

**Branch:** continue on `feat/gmail-viewer` (Stage 1 lives here, unmerged — the whole email-inbox track shares this branch, same as the beta steps 1–7 shared `feat/provider-contract-v2`). Verify with `git rev-parse --abbrev-ref HEAD` before starting; if not on `feat/gmail-viewer`, STOP and report.

---

## CONTEXT FOR A FRESH AGENT (read this whole section before Task 1)

You have zero prior context. Here is everything you need.

### What this repo is

An open-source framework for agent automations: code for the engineer, a polished UI for the client. The **email-inbox workflow** (spec: `docs/superpowers/specs/2026-06-11-email-inbox-workflow-design.md`) is a new flagship demo being built BEFORE the packaging tail, to stress-test the framework as a real consumer. This plan is **Stage 2** of that spec (§2 + §6 stage 2). Stage 1 (the `gmail-viewer` integration + `write-integration` skill) is already BUILT on this branch.

### The locked foundation (do NOT violate — run the `check-foundation` skill if unsure)

`docs/PHILOSOPHY.md` (three beliefs) + `docs/ARCHITECTURE.md` §0 (invariants I1–I15). The ones this stage touches:

- **I2 — machine dispatch allowed, a machine action never.** F2 lets the sorter agent dispatch CHILD work items autonomously (allowed, visible in the pipeline). It must NEVER let the model execute a Gmail mutation — those stay server-executed effects behind gates. A dispatch tool produces a work item, nothing else.
- **I3 — thin layer, no engine in `@atizar/core`.** F9 types are pure TS (no `googleapis`, no fs, no Node). The composition helper (F1) is pure.
- **I5 — framework/userland boundary is physical.** New contract types live in the public SDK (`@atizar/core`); implementations live in `@atizar/server` / `@atizar/integrations` / `apps/inbox`.
- **I15 — boot-time tool classification.** Every allow-listed tool is `readonly | approvals | renders | effects` (an unclassified tool → the framework refuses to boot, enforced by `apps/inbox/server/agent-checks.ts`). **F2 adds a FOURTH class `dispatches`** — extend the classifier so a dispatch tool is a legal classification, and an unclassified tool still refuses to boot.

### Conventions that bind every task

- **English only** — all code, comments, identifiers, docs, test names.
- **Prettier:** `semi: false`, single quotes, `trailingComma: 'es5'`, `printWidth: 100`. ESLint flat config; `any` allowed only in `**/*.test.*`, `console` only in `server/**`.
- **Never `git add -A` / `git add .`** — stage EXACT paths. The user edits docs in parallel.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- **TDD:** write the failing test, RUN it and confirm it fails for the predicted reason, implement minimally, confirm green, commit. One logical change per commit.
- **No build step:** `@atizar/*` packages point `exports` at `./src/index.ts`; `yarn typecheck` = `tsc --build` (composite refs). `.mjs` integration files have hand-written `.d.ts` (allowJs in that package only).
- **Validation sweep** (run from repo root): `yarn typecheck && yarn test && yarn lint`. `yarn format:check` is red on two pre-existing docs the user maintains (`.claude/skills/README.md`, `.claude/skills/check-foundation/SKILL.md`) — leave them; just keep YOUR files Prettier-clean (`npx prettier --check <your files>`).
- **Postgres tests** run against a SEPARATE `aiworkflow_test` DB (vitest `globalSetup`). If you add a DB-backed test, keep it there and DO NOT truncate in `beforeEach` (use unique uuids/sources + membership asserts) — truncation clobbers parallel test files and the startup sweep can re-spawn real `claude`.

### The key files and seams you will touch

**`@atizar/core`** (`packages/core/src/`, barrel `index.ts`):
- `defineAgent.ts` — `AgentDefinitionSchema` (zod). Currently classifies `readonly | approvals | renders | effects`. F2 adds `dispatches`.
- `defineWorkflow.ts` — `WorkflowDescriptor` type + `defineWorkflow()` validator. F1 adds `prompt?`.
- NEW `integration.ts` (F9) — `HealthCheck`, `ReadResult<T>`, `BatchActionResult` types. NEW `prompt.ts` (F1) — `composeInstructions()`.
- `index.ts` — re-exports everything; add the new modules.

**`@atizar/server`** (`packages/server/src/`, barrel `index.ts`):
- `runObserver.ts` — consumes a provider stream. `AgentRuntime` interface (provider, renderToolNames, maxInstances, effects). `consume()` accumulates tool-call args in `openCalls` and on `TOOL_CALL_END` fills the card if the tool is a render tool. **F2 hooks in HERE** (dispatch tool → call deliver). `RunObserverDeps` will gain a `deliver` callback.
- `pipelineService.ts` — the façade. Has `dispatch`, `deliver` (resolve Destination + dispatch child), `resolveGate`, `cancel`/`cancelWorkflow`, `getBoard`, `subscribeBoard`, `stats`, `knows`. **F3** adds health to the board; **F4** publishes activity at its seams; **F6** rejects a duplicate input-agent dispatch; **cancel-all** adds a method.
- `dispatch.ts` — the chokepoint (`dispatch()`): dedup-by-`source`, depth cap, insert `queued`, enqueue. F6's guard can live here or in the façade.
- `workerPool.ts` — per-agent cap + queue. `activeCount(agentId)` / `queuedCount(agentId)` already exist (used by F6).
- `eventBus.ts` — in-process pub/sub. Topics `board` + `workitem:<id>`. **F4** adds an `activity` topic + a ring buffer.
- `routes.ts` — Hono routes. **F3** adds `GET /api/health`; **F4** adds `GET /api/activity` + `/api/activity/stream`; **cancel-all** adds `POST /api/cancel-all`.
- `stateStore.ts` — typed CRUD over drizzle. `getBoardSnapshot()` returns `{ items, gates }`.

**`apps/inbox/server/`** (the thin demo wiring — NOT a framework package):
- `index.ts` — builds `runtimes: Record<instanceId, AgentRuntime>` from each workflow's bindings, constructs `makePipelineService`, mounts routes, boots (migrate + sweep + serve). **F1/F2/F3** wiring lands here.
- `build-agent.ts` — `buildProvider(def, prompts, registry, allowedTools, instanceKey)`: resolves the provider factory, passes `instructions: def.instructions` into the provider config, wraps in record/replay. **F1** threads the composed instructions through here.
- `providers.ts` — the provider registry (`mock`, `claude-cli`, `mastra`). `claude-cli` uses the `prompts` PromptStrategy; `mastra` uses `config.instructions` for the Mastra agent's system prompt. **F3** adds provider-level health (binary on PATH / `ANTHROPIC_API_KEY`).
- `agent-checks.ts` — `assertAgentClassification(def, { allowedTools, effects })`: throws at boot if a bare tool name is not in `readonly ∪ approvals ∪ keys(renders)`. **F2** extends it to also accept `dispatches`.
- `workflows.ts` — aggregates the workflow modules into `workflowServers: { descriptor, bindings }[]`.
- `workflows/<id>/server.ts` — per-workflow `ServerBinding[]` (prompts + allowedTools + effects). `server-binding.ts` defines the `ServerBinding` type. **F3** adds optional `health` to it.

**`@atizar/react`** (`packages/react/src/`):
- `serverTypes.ts` — hand-written mirror of the server data shapes the client reads. **F3** adds `agentHealth` to `Board`; **F4** adds an `ActivityEntry` type. NO components this stage.

### How the two providers differ (matters for F1 + F2 conformance)

- **claude-cli** (dev): a subprocess. Custom tools reach it via a stdio MCP server (`--mcp-config`); the prompt text is built by the `PromptStrategy` (`buildFirst`/`buildResume`), constructed in the workflow's `server.ts` from `instructions`.
- **Mastra** (prod): runs in our Node process; tools are native Mastra registrations; the system prompt is `config.instructions` (= `def.instructions` passed via `buildProvider`).
- A tool call (render OR dispatch) surfaces identically in the AG-UI stream as `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` for BOTH providers — that's why F2 can detect dispatch tools in `RunObserver.consume()` provider-agnostically.

### Stage-1 as-built you can rely on

`@atizar/integrations/gmail-viewer/*` exists with `listUnread`, `getEmail`, `markRead`/`trash`/`star` (in `modify.mjs`, returning `{ done, failed } | { error }`), and `checkCredentials` (in gmail-basic, re-exported by gmail-viewer, returning `{ ok: true, email } | { ok: false, error, hint }`). The read-only MCP wrapper exposes only `list_unread` + `get_email`.

---

## TASK GROUP A — F9: thin integration contract (do FIRST; F3 builds on `HealthCheck`)

### Task A1: `HealthCheck` / `ReadResult` / `BatchActionResult` types in core (TDD)

**Files:**
- Create: `packages/core/src/integration.ts`
- Test: `packages/core/src/integration.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test** (type-level + a runtime guard helper)

```ts
import { describe, it, expect } from 'vitest'
import { isOk, type HealthCheck, type ReadResult, type BatchActionResult } from './integration.js'

describe('integration contract', () => {
  it('isOk narrows a HealthCheck to the ok branch', () => {
    const ok: HealthCheck = { ok: true, detail: 'me@example.com' }
    const bad: HealthCheck = { ok: false, error: 'invalid_grant', hint: 'see SKILL.md' }
    expect(isOk(ok)).toBe(true)
    expect(isOk(bad)).toBe(false)
    if (isOk(ok)) expect(ok.detail).toBe('me@example.com')
    if (!isOk(bad)) expect(bad.hint).toMatch(/SKILL/)
  })

  it('ReadResult / BatchActionResult are usable as the documented shapes', () => {
    const r: ReadResult<{ n: number }> = { n: 1 }
    const err: ReadResult<{ n: number }> = { error: 'boom' }
    const batch: BatchActionResult = { done: ['a'], failed: [{ messageId: 'b', error: 'x' }] }
    expect('error' in r).toBe(false)
    expect('error' in err).toBe(true)
    expect(batch.done).toEqual(['a'])
  })
})
```

- [ ] **Step 2: Run it, confirm it fails** — `yarn vitest run packages/core/src/integration.test.ts` → FAIL (cannot resolve `./integration.js`).

- [ ] **Step 3: Implement `integration.ts`**

```ts
// The thin integration contract (email-inbox spec F9). TYPES ONLY — no base class, no
// defineIntegration() wrapper, no runtime registration. An integration is still a set of pure
// functions (the `write-integration` skill's shape); these types only name the recurring RESULT
// shapes so integrations and the server health/effect seams are uniform. Pure: no fs, no Node,
// no engine import (invariant I3 — this lives in @atizar/core, which the client imports).

// The result of an integration's credentials/health probe (the F3 health surface consumes it).
// `ok:false` MUST carry an actionable `hint` (where creds live + which skill explains setup).
export type HealthCheck =
  | { ok: true; detail?: string }
  | { ok: false; error: string; hint: string }

// A read function's result: the value, or a soft error (integrations never throw — they return).
export type ReadResult<T> = T | { error: string }

// A best-effort batch mutation's result: per-row outcomes collected, or a wholesale error when
// the client itself was unavailable. (gmail-viewer's modify.mjs already returns exactly this.)
export type BatchActionResult =
  | { done: string[]; failed: { messageId: string; error: string }[] }
  | { error: string }

// Narrow a HealthCheck to its ok branch.
export function isOk(h: HealthCheck): h is { ok: true; detail?: string } {
  return h.ok
}
```

- [ ] **Step 4: Add to the core barrel** — append to `packages/core/src/index.ts` (match the existing export style there; check the file first):

```ts
export * from './integration.js'
```

- [ ] **Step 5: Run the test + typecheck** — `yarn vitest run packages/core/src/integration.test.ts` (PASS) then `yarn typecheck` (green).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/integration.ts packages/core/src/integration.test.ts packages/core/src/index.ts
git commit -m "feat(core): thin integration contract types (HealthCheck/ReadResult/BatchActionResult)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task A2: retype the gmail integrations' `.d.ts` against the contract (no behavior change)

**Files:**
- Modify: `packages/integrations/src/gmail-basic/check-credentials.d.ts`
- Modify: `packages/integrations/src/gmail-viewer/check-credentials.d.ts`
- Modify: `packages/integrations/src/gmail-viewer/modify.d.ts`
- Modify: `packages/integrations/src/gmail-viewer/list-unread.d.ts`
- Modify: `packages/integrations/src/gmail-viewer/get-email.d.ts`

> Note: `@atizar/integrations` does NOT currently depend on `@atizar/core` (it has no package.json dep on it). Adding a TYPE-ONLY import is allowed (core is engine-free and a workspace package), but you MUST add `"@atizar/core": "1.0.0"` to `packages/integrations/package.json` `dependencies` so the import resolves and typecheck's project refs are correct. Verify `packages/integrations/tsconfig.json` references core (it may need a `references` entry — check `tsconfig.base.json` composite setup; if typecheck complains about a missing project reference, add `{ "path": "../core" }` to the integrations tsconfig `references`).

- [ ] **Step 1: Add the core dependency** — edit `packages/integrations/package.json`, add `"@atizar/core": "1.0.0"` to `dependencies`. Run `yarn install --ignore-engines` if resolution needs it.

- [ ] **Step 2: Retype `check-credentials.d.ts` (gmail-basic)** to use the contract:

```ts
// Type declaration for check-credentials.mjs (JS module — no TS source).
import type { HealthCheck } from '@atizar/core'
export declare function checkCredentials(deps?: {
  getGmail?: () => Promise<unknown>
}): Promise<HealthCheck>
```

> Behavior note: the runtime returns `{ ok:true, email }` / `{ ok:false, error, hint }`. The contract's ok branch is `{ ok:true; detail? }` (it has `detail`, not `email`). To stay byte-compatible WITHOUT changing runtime, the `.d.ts` type is `HealthCheck` and the extra `email` field is simply not in the declared type. **Decision: rename the runtime field `email` → `detail` to match the contract exactly** (it's an internal field; the only consumer is the health surface, built in F3 this same stage). Edit `check-credentials.mjs`: `return { ok: true, detail: profile.data.emailAddress ?? '' }`. Update its test (`check-credentials.test.ts`) `expect(res).toEqual({ ok: true, detail: 'me@example.com' })`. Keep the `hint` path unchanged.

- [ ] **Step 3: Update `check-credentials.mjs` + its test** for the `email`→`detail` rename (gmail-basic). Run `yarn vitest run packages/integrations/src/gmail-basic/check-credentials.test.ts` → PASS.

- [ ] **Step 4: Retype the gmail-viewer `.d.ts` files** to reference the contract:

`gmail-viewer/check-credentials.d.ts`:
```ts
import type { HealthCheck } from '@atizar/core'
export declare function checkCredentials(deps?: {
  getGmail?: () => Promise<unknown>
}): Promise<HealthCheck>
```

`gmail-viewer/modify.d.ts` — replace the local `BatchActionResult` definition with the imported one:
```ts
// Type declarations for modify.mjs (JS module — no TS source).
import type { BatchActionResult } from '@atizar/core'

export declare function markRead(
  args: { messageIds: string[] },
  deps?: { getGmail?: () => Promise<unknown> }
): Promise<BatchActionResult>

export declare function trash(
  args: { messageIds: string[] },
  deps?: { getGmail?: () => Promise<unknown> }
): Promise<BatchActionResult>

export declare function star(
  args: { messageIds: string[] },
  deps?: { getGmail?: () => Promise<unknown> }
): Promise<BatchActionResult>
```

`gmail-viewer/list-unread.d.ts` — keep `EmailRef` (vertical-specific, stays local), wrap the return in `ReadResult`:
```ts
// Type declaration for list-unread.mjs (JS module — no TS source).
import type { ReadResult } from '@atizar/core'

export type EmailRef = {
  messageId: string
  threadId: string
  from: string
  subject: string
  date: string
  snippet: string
}

export declare function listUnread(
  args?: { sinceHours?: number },
  deps?: { getGmail?: () => Promise<unknown> }
): Promise<ReadResult<{ emails: EmailRef[] }>>
```

`gmail-viewer/get-email.d.ts`:
```ts
// Type declaration for get-email.mjs (JS module — no TS source).
import type { ReadResult } from '@atizar/core'

export declare function getEmail(
  args: { messageId: string },
  deps?: { getGmail?: () => Promise<unknown> }
): Promise<
  ReadResult<{ messageId: string; threadId: string; from: string; subject: string; body: string }>
>
```

- [ ] **Step 5: Full sweep** — `yarn typecheck && yarn test && yarn lint`. The `ReadResult<T> = T | { error }` change must not break the existing gmail-viewer tests (they already branch on `'error' in res`). Fix any typecheck fallout in the integrations package only.

- [ ] **Step 6: Commit**

```bash
git add packages/integrations/package.json packages/integrations/src/gmail-basic/check-credentials.mjs packages/integrations/src/gmail-basic/check-credentials.d.ts packages/integrations/src/gmail-basic/check-credentials.test.ts packages/integrations/src/gmail-viewer/check-credentials.d.ts packages/integrations/src/gmail-viewer/modify.d.ts packages/integrations/src/gmail-viewer/list-unread.d.ts packages/integrations/src/gmail-viewer/get-email.d.ts
git commit -m "refactor(integrations): retype gmail .d.ts against the @atizar/core integration contract

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task A3: update the `write-integration` skill + gmail-viewer consumer skill + AGENTIC doc

**Files:**
- Modify: `.claude/skills/write-integration/SKILL.md`
- Modify: `packages/integrations/skills/gmail-viewer/SKILL.md`
- Modify: `docs/AGENTIC.md`

- [ ] **Step 1: `write-integration/SKILL.md`** — in the "integration contract (FACTS)" block, replace the prose describing the result shapes with references to the typed contract. Edit the bullets:
  - The "Never throw — return `{ error }`" bullet: append "— reads return `ReadResult<T>` (`T | { error }`) from `@atizar/core`."
  - The "Batch mutations are best-effort" bullet: append "— this shape IS the exported `BatchActionResult` type in `@atizar/core`; import it, don't redefine it."
  - The "`checkCredentials()` is mandatory" bullet: change its return shape to "returns the `HealthCheck` type from `@atizar/core` (`{ ok:true; detail? } | { ok:false; error; hint }`)."
  - Add one new bullet: "**Type the `.d.ts` against `@atizar/core`** — import `HealthCheck` / `ReadResult` / `BatchActionResult` rather than re-declaring result shapes; add `@atizar/core` to the package deps. The contract is types only — there is no `defineIntegration()` and no base class (belief #3)."

- [ ] **Step 2: `gmail-viewer/SKILL.md`** — in the Surface table, change the `checkCredentials` row's return to `HealthCheck` and the read rows to `ReadResult<…>` / mutation rows to `BatchActionResult`, and add a one-line note under the table: "Result shapes (`HealthCheck` / `ReadResult` / `BatchActionResult`) are the shared `@atizar/core` integration contract — import them, they are not gmail-specific."

- [ ] **Step 3: `docs/AGENTIC.md`** — under the integration track (near the Phase-2 `add-integration` / consumer-skill area updated in Stage 1), add a `✅` note: the thin integration contract (`HealthCheck`/`ReadResult`/`BatchActionResult`, types only in `@atizar/core`, no base class) shipped at email-inbox stage 2; the `write-integration` skill + the gmail-viewer consumer skill now reference it. Match the existing bullet style.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/write-integration/SKILL.md packages/integrations/skills/gmail-viewer/SKILL.md docs/AGENTIC.md
git commit -m "docs: reference the @atizar/core integration contract in the integration skills + AGENTIC

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK GROUP B — F1: workflow-level prompt

The composed system prompt = workflow `prompt` + blank line + agent instructions. The composition must reach BOTH providers: claude-cli (via the `PromptStrategy`, built in the workflow `server.ts` from `instructions`) AND Mastra (via `config.instructions`, passed by `buildProvider` from `def.instructions`). **Chosen design:** a pure core helper `composeInstructions()`; the app composes ONCE in `index.ts` where it has both `descriptor.prompt` and `def`, and threads the composed string into `buildProvider` (for Mastra's `config.instructions`) AND into the workflow's prompt-strategy construction. To keep ONE composition rule and avoid double-prefixing, the workflow `server.ts` bindings receive the already-composed instructions (not the raw `def.instructions`).

> Escape hatch: if while implementing you find the prompt-strategy is constructed too early to receive composed instructions cleanly, STOP and report — do not invent a second composition path. The lead-inbox descriptor has NO `prompt`, so `composeInstructions(undefined, x) === x` and there must be ZERO behavior change for the existing workflow (this is your regression guard).

### Task B1: `composeInstructions` helper + `defineWorkflow.prompt` (TDD)

**Files:**
- Create: `packages/core/src/prompt.ts`
- Test: `packages/core/src/prompt.test.ts`
- Modify: `packages/core/src/defineWorkflow.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/defineWorkflow.test.ts` (add a `prompt` round-trip assertion)

- [ ] **Step 1: Write the failing test** (`prompt.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { composeInstructions } from './prompt.js'

describe('composeInstructions', () => {
  it('prepends the workflow prompt above the agent instructions', () => {
    expect(composeInstructions('Be terse.', 'Draft a reply.')).toBe('Be terse.\n\nDraft a reply.')
  })
  it('returns the agent instructions unchanged when there is no workflow prompt', () => {
    expect(composeInstructions(undefined, 'Draft a reply.')).toBe('Draft a reply.')
    expect(composeInstructions('', 'Draft a reply.')).toBe('Draft a reply.')
    expect(composeInstructions('   ', 'Draft a reply.')).toBe('Draft a reply.')
  })
})
```

- [ ] **Step 2: Run it, confirm fail** — `yarn vitest run packages/core/src/prompt.test.ts`.

- [ ] **Step 3: Implement `prompt.ts`**

```ts
// Compose an agent's system prompt from an optional workflow-level prompt (shared context for
// every agent in the workflow — tone, rules) and the agent's own instructions. Pure. Used at the
// binding seam so BOTH providers (claude-cli prompt strategy + Mastra config.instructions) see the
// same composed text. A blank/whitespace workflow prompt is a no-op (zero behavior change for a
// workflow that declares none).
export function composeInstructions(
  workflowPrompt: string | undefined,
  agentInstructions: string
): string {
  const wf = workflowPrompt?.trim()
  return wf ? `${wf}\n\n${agentInstructions}` : agentInstructions
}
```

- [ ] **Step 4: Add `prompt?` to the descriptor** — in `defineWorkflow.ts`, add `prompt?: string` to `WorkflowDescriptor` (after `inputs` is fine). No new validation needed (it's optional free text). `defineWorkflow()` already returns `def` verbatim, so it passes through.

- [ ] **Step 5: Export the helper** — add `export * from './prompt.js'` to `packages/core/src/index.ts`.

- [ ] **Step 6: Add a descriptor round-trip test** — in `defineWorkflow.test.ts`, add a case asserting a descriptor with `prompt: 'shared context'` returns that field. Run `yarn vitest run packages/core/src/defineWorkflow.test.ts packages/core/src/prompt.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/prompt.ts packages/core/src/prompt.test.ts packages/core/src/defineWorkflow.ts packages/core/src/defineWorkflow.test.ts packages/core/src/index.ts
git commit -m "feat(core): defineWorkflow.prompt + composeInstructions helper (F1)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task B2: thread the composed prompt through `buildProvider` + the app wiring

**Files:**
- Modify: `apps/inbox/server/build-agent.ts`
- Modify: `apps/inbox/server/index.ts`
- Modify: `apps/inbox/workflows/server-binding.ts` (document that `prompts` is built from composed instructions — no type change needed, but add a note)

- [ ] **Step 1: `build-agent.ts`** — add an optional `instructionsOverride?: string` param to `buildProvider`; when present, pass it as `instructions` to the provider config instead of `def.instructions`:

```ts
export function buildProvider(
  def: AgentDefinition,
  prompts: PromptStrategy,
  registry: ProviderRegistry,
  allowedTools: readonly string[],
  instanceKey: string,
  instructionsOverride?: string
): Provider {
  const makeProvider = registry.resolve(def.provider)
  let provider = makeProvider({
    approvalNames: def.approvals,
    surfaceTools: def.tools,
    allowedTools,
    prompts,
    instructions: instructionsOverride ?? def.instructions,
    agentId: instanceKey,
  })
  // …rest unchanged (record/replay wrap)…
}
```

- [ ] **Step 2: `index.ts`** — when building each runtime, compose and thread. The descriptor carries `prompt`; the binding `b` carries the `prompts` strategy (already built in the workflow `server.ts`). Compose `def.instructions` for the Mastra path:

```ts
import { instanceId, composeInstructions } from '@atizar/core'
// …
for (const b of bindings(descriptor.id)) {
  const def = byId.get(b.agentId)
  if (!def) throw new Error(`server binding for unknown agent "${b.agentId}" in "${descriptor.id}"`)
  assertAgentClassification(def, { allowedTools: b.allowedTools, effects: b.effects })
  const key = instanceId(descriptor.id, b.agentId)
  const composed = composeInstructions(descriptor.prompt, def.instructions)
  const provider = buildProvider(def, b.prompts, providerRegistry, b.allowedTools, key, composed)
  runtimes[key] = { /* …as before… */ }
}
```

> For the claude-cli path, the `PromptStrategy` is built inside the workflow `server.ts` from raw `def.instructions`. To make F1 fully effective for claude-cli, the workflow `server.ts` must build its prompt strategies from the COMPOSED instructions too. The lead-inbox workflow has no `prompt`, so this is a no-op there and you should NOT edit lead-inbox. **You wire this properly in Stage 3 when you author the email-inbox `server.ts` with its workflow prompt** — Stage 2 only ships the mechanism + the Mastra threading + the helper. Add a code comment in `index.ts` noting that the prompt-strategy composition for claude-cli is the workflow `server.ts`'s job (it has `descriptor.prompt` available via the aggregator).

- [ ] **Step 3: Verify zero regression** — `yarn typecheck && yarn test && yarn lint`. (No `prompt` on lead-inbox → composed === raw → byte-identical.)

- [ ] **Step 4: Commit**

```bash
git add apps/inbox/server/build-agent.ts apps/inbox/server/index.ts apps/inbox/workflows/server-binding.ts
git commit -m "feat(server): thread composed workflow+agent instructions into the provider (F1)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK GROUP C — F2: `dispatches` tool class + machine dispatch

A new fourth tool classification. The sorter declares a dispatch tool (e.g. `route_emails`); the model calls it once per child; `RunObserver` detects the call, validates the target against the agent's `handoffs`, and dispatches a child via the existing `deliver` chokepoint with `origin: 'agent'`.

### Task C1: `defineAgent.dispatches` (TDD)

**Files:**
- Modify: `packages/core/src/defineAgent.ts`
- Modify: `packages/core/src/defineAgent.test.ts`

- [ ] **Step 1: Add failing tests** to `defineAgent.test.ts`:

```ts
it('accepts dispatches as a subset of tools', () => {
  const def = defineAgent({
    id: 'sorter', name: 'Sorter', provider: 'claude-cli', instructions: 'x',
    tools: ['route_emails'], approvals: [], renders: {}, dispatches: ['route_emails'],
    handoffs: ['reply'],
  })
  expect(def.dispatches).toEqual(['route_emails'])
})

it('rejects a dispatch tool not declared in tools', () => {
  expect(() =>
    defineAgent({
      id: 'sorter', name: 'Sorter', provider: 'claude-cli', instructions: 'x',
      tools: [], approvals: [], renders: {}, dispatches: ['route_emails'],
    })
  ).toThrow(/dispatch "route_emails" is not declared in tools/)
})

it('defaults dispatches to an empty array', () => {
  const def = defineAgent({
    id: 'a', name: 'A', provider: 'claude-cli', instructions: 'x',
    tools: [], approvals: [], renders: {},
  })
  expect(def.dispatches).toEqual([])
})
```

- [ ] **Step 2: Run, confirm fail** — `yarn vitest run packages/core/src/defineAgent.test.ts`.

- [ ] **Step 3: Implement** — in `AgentDefinitionSchema` add the field + validation (mirror the `effects` pattern):

```ts
// In the object schema, after `readonly`:
dispatches: z.array(z.string()).default([]),
```

```ts
// In the .superRefine, add:
for (const name of def.dispatches) {
  if (!def.tools.includes(name)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `dispatch "${name}" is not declared in tools`,
    })
  }
}
```

- [ ] **Step 4: Run the tests** → PASS. Then `yarn typecheck` (the `AgentDefinition` type gains `dispatches`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/defineAgent.ts packages/core/src/defineAgent.test.ts
git commit -m "feat(core): defineAgent.dispatches tool class (machine dispatch, F2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task C2: extend the boot-time classification kernel for `dispatches` (TDD)

**Files:**
- Modify: `apps/inbox/server/agent-checks.ts`
- Modify: `apps/inbox/server/agent-checks.test.ts`

- [ ] **Step 1: Read `agent-checks.ts`** to see how it builds the "classified" set (currently `readonly ∪ approvals ∪ keys(renders)`, and effects must equal `def.effects`). Add `def.dispatches` to the classified set so a dispatch tool is a legal classification and does NOT trip the "unclassified tool → refuse to boot" error.

- [ ] **Step 2: Add a failing test** to `agent-checks.test.ts`: an agent whose allow-list contains a bare dispatch tool name classified ONLY via `dispatches` passes `assertAgentClassification`; and (regression) a truly unclassified tool still throws.

- [ ] **Step 3: Run (fail), implement (add `...def.dispatches` to the classified set), run (pass).**

- [ ] **Step 4: Commit**

```bash
git add apps/inbox/server/agent-checks.ts apps/inbox/server/agent-checks.test.ts
git commit -m "feat(server): classification kernel accepts the dispatches class (F2/I15)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task C3: RunObserver detects a dispatch tool call → deliver a child (TDD)

**Files:**
- Modify: `packages/server/src/runObserver.ts`
- Modify: `packages/server/src/pipelineService.ts`
- Test: `packages/server/src/runObserver.dispatch.test.ts` (new)

**Design:** `AgentRuntime` gains `dispatchToolNames: string[]` and `handoffs: string[]`. `RunObserverDeps` gains `deliver(req: { origin, dest, payload, parentId }): Promise<unknown>`. In `consume()`, on `TOOL_CALL_END`, after the render-tool branch, add a dispatch branch: if `call.name ∈ runtime.dispatchToolNames`, parse `call.args` as `{ to: string } & Record<string, unknown>`; if `to ∈ runtime.handoffs`, call `deps.deliver({ origin: wi.workflowId, dest: { kind: 'agent', agentId: to }, payload: <args minus `to`>, parentId: id })`; else append a synthetic trace warning event (do NOT throw — a bad target is a model error, not a crash). The dispatch is fire-and-forget within the loop (await it so failures surface, but a deliver error must be caught and logged, never break the stream).

- [ ] **Step 1: Write the failing test** — drive `consume` indirectly via `run()` with a fake provider that emits `TOOL_CALL_START/ARGS/END` for a dispatch tool. The simplest harness mirrors the existing `runObserver` tests (check `runObserver.test.ts` for the fake-provider + in-memory store pattern already used). Assert that `deps.deliver` was called once with `{ origin: 'wf', dest: { kind: 'agent', agentId: 'reply' }, payload: { messages: [...] }, parentId: <id> }` for a valid target, and NOT called (plus a trace warning present) for an invalid target.

```ts
// Sketch — adapt to the existing runObserver test harness (fake store + bus + pool):
it('dispatches a child when the sorter calls a dispatch tool with a valid target', async () => {
  const delivered: any[] = []
  const observer = makeRunObserver({
    db, store, pool, bus,
    resolveAgent: () => ({
      provider: fakeProviderEmittingDispatchCall('route_emails', { to: 'reply', emails: [{ messageId: 'm1' }] }),
      renderToolNames: [], maxInstances: 1, effects: {},
      dispatchToolNames: ['route_emails'], handoffs: ['reply'],
    }),
    deliver: async (req) => { delivered.push(req); return { ok: true, id: 'child', deduped: false } },
  })
  await observer.run(workItemId) // workItem has workflowId 'wf'
  expect(delivered).toHaveLength(1)
  expect(delivered[0]).toMatchObject({ origin: 'wf', dest: { kind: 'agent', agentId: 'reply' }, parentId: workItemId })
  expect(delivered[0].payload).toMatchObject({ emails: [{ messageId: 'm1' }] })
})
```

- [ ] **Step 2: Run, confirm fail** (type error: `deliver` not on deps; `dispatchToolNames`/`handoffs` not on runtime).

- [ ] **Step 3: Implement** in `runObserver.ts`:
  - `AgentRuntime`: add `dispatchToolNames: string[]` and `handoffs: string[]`.
  - `RunObserverDeps`: add `deliver: (req: { origin: string; dest: { kind: 'agent'; agentId: string }; payload: Record<string, unknown>; parentId: string }) => Promise<unknown>`.
  - In `consume`'s `TOOL_CALL_END` handler, after the render branch:

```ts
if (call && runtime.dispatchToolNames.includes(call.name)) {
  try {
    const parsed = JSON.parse(call.args || '{}') as { to?: string } & Record<string, unknown>
    const to = typeof parsed.to === 'string' ? parsed.to : ''
    if (runtime.handoffs.includes(to)) {
      const { to: _omit, ...payload } = parsed
      await deps
        .deliver({ origin: wi.workflowId, dest: { kind: 'agent', agentId: to }, payload, parentId: id })
        .catch((e) => console.error('[runObserver] dispatch deliver failed', id, e))
    } else {
      // Invalid target: record a trace warning, do not crash the run.
      const warn = { type: EventType.CUSTOM, name: 'dispatch_rejected', value: { to, reason: 'not in handoffs' } } as unknown as BaseEvent
      await store.appendTrace(id, seq, warn)
      bus.publish(`workitem:${id}`, { seq, event: warn })
      seq++
    }
  } catch {
    // Malformed dispatch args — skip (the trace is still lossless).
  }
}
```

  - Note: `wi.workflowId` is on the `WorkItem` row (schema has `workflowId`). `consume` receives `wi`.

- [ ] **Step 4: Wire `deliver` in `pipelineService.ts`** — the façade already builds `deliver` logic inline in the returned object. Extract it into a local `deliverImpl(req)` defined BEFORE `makeRunObserver(...)`, pass `deliver: deliverImpl` into `makeRunObserver` deps, and have the façade's `deliver` method call `deliverImpl`. Keep behavior identical (resolveDelivery + dispatchChokepoint + publishBoard).

- [ ] **Step 5: Update the app runtime build** (`apps/inbox/server/index.ts`) — add `dispatchToolNames: def.dispatches` and `handoffs: def.handoffs ?? []` to each `runtimes[key]`.

- [ ] **Step 6: Run, confirm green** — the new test + the existing `runObserver` tests + `pipelineService` tests must all pass. `yarn typecheck && yarn test && yarn lint`.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/runObserver.ts packages/server/src/pipelineService.ts packages/server/src/runObserver.dispatch.test.ts apps/inbox/server/index.ts
git commit -m "feat(server): RunObserver dispatches a child on a dispatch tool call (F2 machine dispatch)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task C4: dispatch-tool detection in the provider conformance suite (TDD)

**Files:**
- Modify: `packages/core/src/conformance.ts`

The conformance suite asserts the provider-agnostic contract. F2 relies on a dispatch tool surfacing as a normal `TOOL_CALL_START`/`ARGS`/`END` (so `RunObserver` sees it). The existing check "only surfaced tools appear as tool calls" already covers that surfacing works; add a focused invariant so a future provider that swallowed a non-approval, non-render tool call (e.g. treated a dispatch tool specially) would fail.

- [ ] **Step 1: Add a check** to `providerConformanceChecks`: "a surfaced non-approval tool call emits START+END with matching toolCallId" — run `turn1Input`, collect events, assert every `TOOL_CALL_START` has a matching `TOOL_CALL_END` with the same `toolCallId`. (This is the property `RunObserver.consume` relies on to close `openCalls` and trigger the dispatch/render branch.)

> Note: the conformance scenarios for claude-cli + mock + Mastra are defined in their respective test files (search `runProviderConformance` / `providerConformanceChecks`). Adding a check here automatically runs against all three. If a provider's existing fixture doesn't emit a non-approval tool call, the new check is trivially satisfied (no STARTs to pair) — it does not require new fixtures. Verify all three conformance test files stay green.

- [ ] **Step 2: Run the full suite** — `yarn test` (the conformance files run as part of it). Confirm green for mock + claude-cli + Mastra.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/conformance.ts
git commit -m "test(core): conformance — surfaced tool calls pair START/END (F2 dispatch detection)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK GROUP D — F3: credential-health surface (server + data shape only; UI is Stage 4)

`ServerBinding` gains an optional `health` (named credential/provider checks). The app aggregates all agents' checks into `Record<instanceId, HealthCheck>`, exposes `GET /api/health`, includes `agentHealth` in the board snapshot, and logs health at boot. Boot NEVER fails on a failing health check (missing creds is a user state). The greyed-out badge + disabled START render in Stage 4.

### Task D1: `ServerBinding.health` + provider health helper

**Files:**
- Modify: `apps/inbox/workflows/server-binding.ts`
- Create: `apps/inbox/server/health.ts`
- Test: `apps/inbox/server/health.test.ts`

- [ ] **Step 1: Extend `ServerBinding`** — add `health?: { name: string; check: () => Promise<HealthCheck> }[]` (import `HealthCheck` from `@atizar/core`). A binding lists the credential checks its agent depends on (e.g. the reply agent depends on Gmail → `[{ name: 'gmail', check: checkCredentials }]`).

- [ ] **Step 2: Write `health.ts` with a failing test first** — a pure aggregator `aggregateHealth(checks: HealthCheck[]): HealthCheck` that returns the first `ok:false` (so an agent with any failing dependency is unhealthy) or `{ ok: true }`. Plus `providerHealth(provider: string): HealthCheck` — `claude-cli` → check the `claude` binary is on PATH (use `which`/`execSync('command -v claude')` guarded in try/catch); `mastra` → `process.env.ANTHROPIC_API_KEY ? ok : { ok:false, error:'ANTHROPIC_API_KEY not set', hint:'export ANTHROPIC_API_KEY (see HANDOFF provider knobs)' }`; `mock` → always ok.

```ts
// health.test.ts sketch
import { describe, it, expect } from 'vitest'
import { aggregateHealth, providerHealth } from './health.js'

describe('aggregateHealth', () => {
  it('is ok when all checks are ok', () => {
    expect(aggregateHealth([{ ok: true }, { ok: true, detail: 'x' }])).toEqual({ ok: true })
  })
  it('returns the first failure', () => {
    const fail = { ok: false, error: 'no creds', hint: 'see skill' } as const
    expect(aggregateHealth([{ ok: true }, fail])).toEqual(fail)
  })
})

describe('providerHealth', () => {
  it('mock is always ok', () => expect(providerHealth('mock')).toEqual({ ok: true }))
  it('mastra needs ANTHROPIC_API_KEY', () => {
    const saved = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    expect(providerHealth('mastra').ok).toBe(false)
    if (saved) process.env.ANTHROPIC_API_KEY = saved
  })
})
```

- [ ] **Step 3: Implement, run green, commit**

```bash
git add apps/inbox/workflows/server-binding.ts apps/inbox/server/health.ts apps/inbox/server/health.test.ts
git commit -m "feat(server): ServerBinding.health + health aggregation helpers (F3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task D2: aggregate per-agent health, expose it, include it in the board

**Files:**
- Modify: `apps/inbox/server/index.ts`
- Modify: `packages/server/src/pipelineService.ts`
- Modify: `packages/server/src/routes.ts`
- Modify: `packages/react/src/serverTypes.ts`
- Test: `packages/server/src/pipelineService.test.ts` (board includes agentHealth when provided)

- [ ] **Step 1: App computes the health map** — in `index.ts`, after building `runtimes`, build a function `computeAgentHealth(): Promise<Record<string, HealthCheck>>` that, for each `instanceId`, runs `providerHealth(def.provider)` + all binding `health[].check()` and `aggregateHealth`s them. Cache the latest result in a module variable; refresh at boot and on `GET /api/health`.

- [ ] **Step 2: `pipelineService` accepts a health getter** — add to `PipelineServiceDeps` an optional `getAgentHealth?: () => Record<string, HealthCheck>` (synchronous read of the cached map; the app refreshes the cache). `getBoard()` includes `agentHealth: deps.getAgentHealth?.() ?? {}`. Update the `getBoard` return type + the `Board`-shaped client type.

- [ ] **Step 3: Route** — add `GET /api/health` to `routes.ts`: it calls a new `service.refreshHealth()` (which re-runs `computeAgentHealth` via an injected async refresher) and returns the map. Simplest wiring: `PipelineServiceDeps.refreshHealth?: () => Promise<Record<string, HealthCheck>>`; the route awaits it and returns JSON; the result is also cached for `getAgentHealth`. (Keep the sync `getAgentHealth` for the board snapshot, the async `refreshHealth` for the endpoint + boot.)

- [ ] **Step 4: Client data shape** — in `serverTypes.ts` add:
```ts
export type AgentHealth = { ok: true } | { ok: false; error: string; hint: string }
export type Board = { items: WorkItem[]; gates: Gate[]; lastEventId: number; agentHealth: Record<string, AgentHealth> }
```
(NO component — Stage 4 renders the badge from this.)

- [ ] **Step 5: Boot logs health** — in `index.ts` `boot()`, after the sweep, `await refreshHealth()` and `console.log` a one-line summary (e.g. `health: 3 ok, 1 missing-creds`). Never throw.

- [ ] **Step 6: Test + sweep + commit** — add a `pipelineService` test that `getBoard()` carries `agentHealth` when `getAgentHealth` is provided. `yarn typecheck && yarn test && yarn lint`.

```bash
git add apps/inbox/server/index.ts packages/server/src/pipelineService.ts packages/server/src/routes.ts packages/react/src/serverTypes.ts packages/server/src/pipelineService.test.ts
git commit -m "feat(server): credential-health surface — GET /api/health + agentHealth on the board (F3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK GROUP E — F4: activity feed (server + endpoints; the panel UI is Stage 4)

A single chronological feed of everything happening, fed from the seams that already exist. In-memory ring buffer (last ~200) + an `activity` bus topic + snapshot/SSE endpoints.

### Task E1: activity ring buffer + bus topic (TDD)

**Files:**
- Create: `packages/server/src/activity.ts`
- Test: `packages/server/src/activity.test.ts`
- Modify: `packages/server/src/index.ts` (barrel — export the `ActivityEntry` type if the app needs it; otherwise internal)

- [ ] **Step 1: Failing test** — `makeActivityLog({ bus, limit })` with `record(entry)` (pushes to the ring + publishes on the `activity` topic) and `snapshot()` (returns the buffer, newest last, capped at `limit`).

```ts
import { describe, it, expect } from 'vitest'
import { makeActivityLog, type ActivityEntry } from './activity.js'
import { makeEventBus } from './eventBus.js'

describe('activity log', () => {
  it('records entries, caps the ring, and publishes', () => {
    const bus = makeEventBus()
    const seen: ActivityEntry[] = []
    bus.subscribe('activity', (m) => seen.push(m as ActivityEntry))
    const log = makeActivityLog({ bus, limit: 2 })
    const e = (kind: string): ActivityEntry => ({ ts: 0, workflowId: 'wf', agentId: 'wf__a', workItemId: 'i', kind, summary: kind })
    log.record(e('queued')); log.record(e('running')); log.record(e('gate'))
    expect(log.snapshot().map((x) => x.kind)).toEqual(['running', 'gate']) // capped at 2, oldest dropped
    expect(seen).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Implement `activity.ts`**

```ts
import type { EventBus } from './eventBus.js'

export interface ActivityEntry {
  ts: number
  workflowId: string
  agentId: string
  workItemId: string
  kind: string // 'queued' | 'running' | 'gate' | 'resolved' | 'effect' | 'finished' | 'error' | 'cancelled' | 'delivered'
  summary: string
}

export interface ActivityLog {
  record(entry: ActivityEntry): void
  snapshot(): ActivityEntry[]
}

export function makeActivityLog(opts: { bus: EventBus; limit?: number }): ActivityLog {
  const limit = opts.limit ?? 200
  const ring: ActivityEntry[] = []
  return {
    record(entry) {
      ring.push(entry)
      if (ring.length > limit) ring.shift()
      opts.bus.publish('activity', entry)
    },
    snapshot() {
      return [...ring]
    },
  }
}
```

> Note: `ts` is passed IN by the caller (the pipelineService stamps `Date.now()` at the seam). Do NOT call `Date.now()` inside `activity.ts` if it's ever exercised by a workflow-resume path — but here it's plain server code, so `Date.now()` at the call site in pipelineService is fine.

- [ ] **Step 3: Export** the type from the barrel if the route/app needs it. Run green, commit.

```bash
git add packages/server/src/activity.ts packages/server/src/activity.test.ts packages/server/src/index.ts
git commit -m "feat(server): in-memory activity ring buffer + bus topic (F4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task E2: instrument the pipeline seams + activity endpoints

**Files:**
- Modify: `packages/server/src/pipelineService.ts`
- Modify: `packages/server/src/runObserver.ts`
- Modify: `packages/server/src/routes.ts`

- [ ] **Step 1: Construct the log** in `makePipelineService` (`const activity = makeActivityLog({ bus })`). Record at these seams (each one-liner, `ts: Date.now()`):
  - `dispatch()` → `kind: 'queued'`, summary `START <agentId>` (origin human) / `dispatched <agentId>` (origin agent).
  - `deliverImpl()` → `kind: 'delivered'`, summary `→ <dest.agentId>`.
  - `resolveGate()` approved → `kind: 'resolved'` (summary `approved <toolName>`), then after the effect runs, `kind: 'effect'` (summary from `executedResult`); rejected → `kind: 'resolved'` summary `rejected`.
  - `cancelItem()` → `kind: 'cancelled'`.
  - In `runObserver` (it has the `bus`; give it the `activity` log via deps OR have it publish a structured status the service maps — simplest: pass `activity` into `RunObserverDeps`): run start → `running`, gate → `gate`, finish → `finished`, error → `error`. Use `wi.workflowId` + `wi.agentId` + `id`.

> To keep `runObserver` decoupled, add `activity?: ActivityLog` to `RunObserverDeps` (optional). The service passes it. RunObserver records at the start/gate/finish/error points it already has.

- [ ] **Step 2: Façade exposes** `getActivity()` (= `activity.snapshot()`) and `subscribeActivity(fn)` (= `bus.subscribe('activity', fn)`).

- [ ] **Step 3: Routes** — add to `routes.ts`:
```ts
app.get('/api/activity', (c) => c.json(service.getActivity()))
app.get('/api/activity/stream', (c) =>
  streamSSE(c, async (stream) => {
    await new Promise<void>((resolve) => {
      const unsub = service.subscribeActivity((m) => {
        void stream.writeSSE({ event: 'activity', data: JSON.stringify(m) }).catch(() => {})
      })
      stream.onAbort(() => { unsub(); resolve() })
    })
  })
)
```

- [ ] **Step 4: Test** — extend `pipelineService.test.ts`: a dispatch records a `queued` activity entry retrievable via `getActivity()`. `yarn typecheck && yarn test && yarn lint`.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/pipelineService.ts packages/server/src/runObserver.ts packages/server/src/routes.ts packages/server/src/pipelineService.test.ts
git commit -m "feat(server): emit activity at pipeline seams + GET /api/activity (+SSE) (F4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK GROUP F — F6 singleton START guard + global cancel-all

### Task F1: reject a duplicate START of a singleton input agent (TDD)

**Files:**
- Modify: `packages/server/src/pipelineService.ts`
- Modify: `packages/server/src/routes.ts`
- Test: `packages/server/src/pipelineService.test.ts`

**Design:** the façade's `dispatch()` is the human START path (origin `human`). For an agent whose `maxInstances` is 1, if it already has an active instance (`pool.activeCount(agentId) >= maxInstances`), reject with a typed result so the route returns 409. Machine dispatch (`deliver`, origin `agent`) is unaffected — only the human START is guarded (a queued second START is the confusing case the spec calls out).

- [ ] **Step 1: Failing test** — dispatch a `maxInstances: 1` agent twice via the façade `dispatch`; the second returns `{ ok: false, reason: 'already_running' }` (or throws a typed error the route maps to 409). Use a blocking fake provider so the first stays active. (Follow the existing `pipelineService.test.ts` cap test for the blocking-provider fixture pattern.)

- [ ] **Step 2: Implement** — in `dispatch()`, before the chokepoint, when `origin === 'human'`: look up `maxInstances` (already done via `resolveAgent`); if `pool.activeCount(req.agentId) >= maxInstances`, return `{ id: '', deduped: false, rejected: 'already_running' }` (extend `DispatchResult` with an optional `rejected?` field, or return a discriminated union — pick one and keep the type honest). Do NOT enqueue.

- [ ] **Step 3: Route maps it to 409** — in `POST /api/dispatch`, if the result is rejected, `return c.json({ error: 'already running' }, 409)`.

- [ ] **Step 4: Run green, commit**

```bash
git add packages/server/src/pipelineService.ts packages/server/src/routes.ts packages/server/src/pipelineService.test.ts
git commit -m "feat(server): reject a duplicate human START of a singleton agent (409) (F6)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task F2: global `POST /api/cancel-all`

**Files:**
- Modify: `packages/server/src/pipelineService.ts`
- Modify: `packages/server/src/routes.ts`
- Test: `packages/server/src/pipelineService.test.ts`

- [ ] **Step 1: Façade method** — add `cancelAll()`: cancel every active work item across ALL workflows. Reuse `store.getActive...` — the simplest correct implementation iterates the board snapshot's active items and calls `cancelItem` on each root (parent-first, ascending-id), OR loops `cancelWorkflow` over the distinct `workflowId`s present in active items. Prefer the latter (reuses the tested cascade).

- [ ] **Step 2: Route** — `app.post('/api/cancel-all', async (c) => { await service.cancelAll(); return c.json({ ok: true }) })`.

- [ ] **Step 3: Test** — two active items in two workflows → `cancelAll()` → both `finished`/`cancelled`. Run green.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/pipelineService.ts packages/server/src/routes.ts packages/server/src/pipelineService.test.ts
git commit -m "feat(server): POST /api/cancel-all — stop every active work item (Stop all) (F6/cancel-all)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK GROUP G — wrap-up

### Task G1: full validation + foundation check

- [ ] **Step 1:** `yarn typecheck && yarn test && yarn lint` (all green). Confirm YOUR new/edited files are Prettier-clean: `npx prettier --check <list of touched files>` (the two pre-existing doc failures are out of scope — see Context).

- [ ] **Step 2:** Invoke the `check-foundation` skill on the whole stage diff (`git diff master...feat/gmail-viewer` scoped to this stage's commits). Expected CLEAR; the risk to assert explicitly: **F2 must not let the model execute a Gmail mutation** (it only dispatches a child work item — I2/I9 intact) and **I15 still refuses to boot on an unclassified tool** (the classifier now accepts `dispatches`, which is a legal classification, not a bypass). Any WARN → STOP, surface to the user.

### Task G2: docs (HANDOFF + AGENTIC) + smoke

**Files:**
- Modify: `HANDOFF.md`
- Modify: `docs/AGENTIC.md` (if not already covered by Task A3)

- [ ] **Step 1: HANDOFF** — under the "🆕 ACTIVE TRACK (2026-06-11)" section, mark Stage 2 ✅ BUILT with an as-built note: F9 contract types; F1 `composeInstructions` + `defineWorkflow.prompt` (mechanism only — claude-cli prompt-strategy composition is wired in Stage 3's `server.ts`); F2 `dispatches` class + RunObserver→deliver + classifier + conformance; F3 `GET /api/health` + `agentHealth` on the board (UI badge is Stage 4); F4 activity feed + endpoints (panel is Stage 4); F6 singleton 409 + `POST /api/cancel-all`. Note the next stage = Stage 3 (the workflow itself).

- [ ] **Step 2: Boot smoke** — start the server once (`DEV_RECORD_REPLAY=1 yarn dev:server`, or full `yarn dev`) and confirm: it boots (migrate + sweep), logs the health summary, and `curl localhost:4000/api/health` + `curl localhost:4000/api/activity` return JSON; `curl -X POST localhost:4000/api/cancel-all` returns `{ ok: true }`. This is a server smoke, NOT a browser E2E (no UI changed this stage). Kill the server after.

- [ ] **Step 3: Commit docs**

```bash
git add HANDOFF.md docs/AGENTIC.md
git commit -m "docs(handoff): email-inbox stage 2 (core+server capabilities) built; next = stage 3 workflow

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task G3: final whole-branch review

- [ ] Dispatch a final reviewer over the stage's commits: coherence (the new types are used by the server wiring; the conformance check runs against all three providers), the I2/I15 invariant, cross-task type consistency (`HealthCheck` used identically in core, integrations, server, serverTypes; `AgentHealth` in serverTypes is structurally the same as `HealthCheck`). Report ready-to-merge or issues-first.

---

## SELF-REVIEW NOTES (applied)

- **Spec coverage (§2):** F9 = Group A; F1 = Group B; F2 = Group C (defineAgent + classifier + RunObserver + conformance); F3 = Group D; F4 = Group E; F6 = Group F1; cancel-all = Group F2. F5 (primitives/header/tabs/ActivityLog panel) and F7 (pipeline states) are explicitly Stage 4 (UI) — NOT in this plan.
- **No React this stage** — `serverTypes.ts` gains data shapes only; the badge/panel/tabs/Stop-all button render in Stage 4.
- **Type consistency:** `HealthCheck` (core) is the single source; `AgentHealth` (serverTypes) mirrors it for the client (the client can't import server/core node types freely — it mirrors, same as the existing `WorkItem`/`Gate` mirrors). `BatchActionResult`/`ReadResult` lifted into core and re-referenced by the gmail `.d.ts`.
- **F1 honesty:** Stage 2 ships the mechanism + Mastra threading + helper; the claude-cli prompt-strategy composition is a one-liner in the email-inbox `server.ts` authored in Stage 3 (noted in B2). Zero regression on lead-inbox (no `prompt`).
- **Invariant guard:** F2 dispatch produces a child work item only — never an action (I2); the classifier extension keeps the unclassified-tool boot failure (I15).

---

## SUBSEQUENT STAGES (design-level — each gets its own detailed plan right before it is built)

We write the detailed, code-level plan for each stage immediately before building it, because each stage's plan depends on the previous stage's AS-BUILT reality (every prior beta step had as-built deviations). What follows is enough context to start each.

### Stage 3 — the email-inbox workflow itself (the payoff)

**Goal:** assemble the workflow from the Stage-1 integration + Stage-2 capabilities. New module `apps/inbox/workflows/email-inbox/{descriptor,server,client}.tsx` + one line in each aggregator (`workflows/index.ts`, `server/workflows.ts`, `client/src/workflows.ts`).

- **Agents** (spec §5): `sorter` (input, `maxInstances 1`, `readonly:['list_unread']`, `dispatches:['route_emails']`, `renders:{renderSort}`, `handoffs:['reply','reader','spam','important']`); `reply` (worker, `maxInstances 2`, `readonly:['get_email']`, `saveDraft`→createDraft effect — same shape as today's lead-inbox reply); `reader`/`spam`/`important` (worker, `maxInstances 1`, `approvals:['applyActions']`, `effects:['applyActions']`, `renders:{applyActions:BatchCard}`, `handoffs:['reply']`).
- **Workflow prompt** (F1): the shared email-pipeline context + "never narrate tool plumbing." Author the `server.ts` prompt strategies from `composeInstructions(descriptor.prompt, agent.instructions)` — this is where F1's claude-cli path is finally wired (Stage 2 only shipped the mechanism).
- **Batch gate (spec §4):** the `applyActions` approval tool's form is `{ items: [{ messageId, from, subject, action }] }`, `action ∈ 'read'|'trash'|'star'|'keep'`. ONE server effect `applyEmailActions(form)` groups the rows into `markRead`/`trash`/`star` batch calls (gmail-viewer's `modify`), best-effort, returns `{ applied, failed }`. Bind it in the workflow `server.ts` `effects`. The model proposes the default (reader→all read, spam→all trash, important→all star).
- **Machine dispatch (F2):** the sorter's prompt instructs it to call `route_emails({ to, emails })` once per destination group (reply = one email each; reader/spam/important = the batch). RunObserver (Stage 2) turns each call into a child.
- **MCP wiring:** add `gmail-viewer` to `claude-spawn.ts`'s mcp-config (`require.resolve('@atizar/integrations/gmail-viewer')`) + native Mastra read-tool registrations in `apps/inbox/server/mastra/tools.ts` (reads only; effects never reach the model).
- **Effect MCP/create-draft:** reply's `saveDraft` reuses the existing `@atizar/integrations/gmail-basic/create-draft` effect.
- **Verification (the real proof):** record cassettes (`DEV_RECORD_REPLAY=record` once, then `=1`), then **browser E2E** via the `browser-verify` skill: START sorter → 4-way machine dispatch visible in the pipeline → batch approve with edited per-row actions → real Gmail markRead/trash/star (verify via the API, then undo) → reply approve → real draft → re-route a row to REPLY → reject → Stop. This is the stage where mutations get their FIRST live verification (Stage 1 was read-only).
- **Cards** are USERLAND (`EmailBatchCard`, `renderSort` summary card) — built in the workflow's `client.tsx` on the existing render-spec mechanism, NOT in `@atizar/react`.

### Stage 4 — React/UI chrome (spec F5 + F7)

**Goal:** the UI for everything Stages 2–3 made server-true. All in `@atizar/react` (the package) + demo cards in userland.

- **Primitives kit** (`Button`, `Card`/`CardShell`, `Badge`, `Tabs`, `Field`, `List`) — port the existing Smedja CSS into reusable components; rewrite demo cards on top.
- **Global header**: workflow tabs (Chrome-tab styling — restyle the existing `WorkflowSwitcher`), a **Stop all** button (`POST /api/cancel-all`), an activity-log toggle.
- **F3 badge**: read `board.agentHealth[instanceId]`; render an unhealthy agent greyed-out with a "missing credentials" badge + the `hint` in a tooltip; disable START.
- **F6 UI**: disable START while `active ≥ maxInstances` (board `stats`); surface the 409 gracefully.
- **F7 pipeline states**: a finished input agent with live children shows "Delegating"; with none, "Done" (fix in `pipelineModel`/`statusDisplay`).
- **ActivityLog panel**: reads `GET /api/activity` + the SSE tail; reverse-chronological, auto-follow.
- **Verification:** browser-verify EVERY flow again through the new chrome (the repo's "only the browser catches it" rule).

### Stage 5 — polish + full-scenario E2E

- Fresh cassette set covering the whole sort→4-way→batch→reply→approve→draft + re-route + reject + Stop scenario.
- Update HANDOFF/AGENTIC/CLAUDE.md with new gotchas; reword the HANDOFF "draft-only is a product law" line to "draft-only is the gmail-basic demo's scope, not a framework law — sending is legitimate gated future work" (same clarification pattern as GitHub read-only; the `draft-only-is-integration-scoped` memory already records this).

### Then: the packaging tail (the original Stage 7c — now with email-inbox as the demo)

1. **Bearer-token auth** on every mutating route (`AUTH_TOKEN` env, middleware; demo mode may default it) — honest `resolvedBy`.
2. **`DEMO=1` zero-cred mode**: PGlite (Postgres-in-WASM, no Docker) + the mock provider + SYNTHETIC cassettes authored from scratch with invented names/emails (NEVER scrub real recordings; `scanCassette` CI gate).
3. **Golden-set eval** per workflow; the two step-6 follow-ups (3-at-once cap via a slow fixture; cross-workflow "Treat as lead" with a recorded github-triage cassette).
4. **README** 10-minute "try it" script; **LICENSE** (ASK THE USER — recommend MIT); **`@atizar/*` scope rename** (placeholder → the real npm scope, also ASK THE USER for the name).
5. Carried-over cleanups: `WorkerPool.resumeAcquire` benign `IllegalTransition` log; `.env.local` auto-load for `PROVIDER=mastra`.

The two questions that REQUIRE the user (everything else: decide-and-go): **the npm scope name** and **the LICENSE**. Ask both at the start of the packaging tail.
