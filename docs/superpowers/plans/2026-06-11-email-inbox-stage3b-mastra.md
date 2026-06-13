# Email-inbox Stage 3b — Mastra Provider Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the email-inbox workflow (built in Stage 3 on claude-cli) run on the **Mastra production provider** — because the public/beta demo ships on Mastra (user decision, 2026-06-11). Today the Mastra runner is hardcoded to the lead-inbox reply shape; generalize it so the sorter (machine dispatch), the reply agent (reads body + drafts), and the three batch agents (per-row gate) all run under `PROVIDER=mastra`, verified by a live Mastra browser E2E.

**Architecture:** Two changes, both in `apps/inbox/server/mastra/`. (1) **Unify the prompt source:** thread each agent's `PromptStrategy` (already built in the workflow `server.ts`) into the runner, so claude-cli and Mastra build the system prompt from the SAME `buildFirst`/`buildResume` — deleting the runner's hardcoded lead-inbox `buildPrompt`. (2) **Generalize the tool registry:** add the email-inbox tools (`list_unread`, `get_email` reads; `route_emails`, `renderSort`, `applyActions` capture tools) to the Mastra tool map. The runner's gate logic (suspend on the approval-named tool) is already generic and needs no change; machine dispatch works for free once `route_emails` surfaces as a tool-call (the mastra-stream maps it to AG-UI `TOOL_CALL_*`, and the Stage-2 RunObserver dispatches the child — exactly as it does for claude-cli).

**Tech Stack:** Mastra (`@mastra/core`, `@mastra/pg`), `@ai-sdk/anthropic`, the existing `@atizar/providers` Mastra seam, Postgres, vitest, Playwright-MCP. `PROVIDER=mastra` + `ANTHROPIC_API_KEY` for the live path; the conformance suite runs on a fake runner (no key).

**Branch:** continue on `feat/gmail-viewer`. Verify `git rev-parse --abbrev-ref HEAD`.

**PREREQUISITE:** Stage 3 (the email-inbox workflow on claude-cli) is BUILT and browser-verified. This plan assumes `workflows/email-inbox/{descriptor,server,prompts,apply-actions,client}` exist. If Stage 3 is not done, STOP — build it first.

---

## CONTEXT FOR A FRESH AGENT (read before Task 1)

### Why this stage exists

The framework proves "swappability, not declared" with two unlike providers (invariant I4): **claude-cli** (dev, a subprocess) and **Mastra** (production, in-process). The email-inbox flagship demo ships publicly on Mastra, so it must run there. The conformance suite (`packages/core/src/conformance.ts`) already proves the contract for both; this stage makes the REAL Mastra assembly handle the email-inbox agent shapes.

### How the Mastra provider works today (the as-built you are changing)

Read these three files fully before starting:

- **`apps/inbox/server/providers.ts`** — `mastraFactory(config)`: strips the `mcp__<server>__` prefix off `config.allowedTools`, splits them into `readTools` (bare names NOT in `surfaceTools` and NOT in `approvalNames`) and `renderAndProposeTools` (bare names in `surfaceTools`), builds a `MastraRunner` via `makeMastraRunner({ agentId, instructions, approvalNames, readTools, renderAndProposeTools, model, databaseUrl })`, and wraps it in `createMastraProvider({ approvalNames, surfaceTools, runner })`. **`config.prompts` (the `PromptStrategy`) is available here but NOT passed to the runner today** — that is the gap Task 1 closes.
  - `surfaceTools` = `def.tools` (the render/propose/approval/dispatch tools). `readonly` tools are NOT in `def.tools` (convention — see the Stage-3 descriptor fix), so they fall into `readTools`. **This is why the Stage-3 sorter must keep `list_unread` in `readonly` only, never in `tools`.**
- **`apps/inbox/server/mastra/tools.ts`** — `captureTool(id, schema)` makes a no-op tool whose `execute` echoes its `inputData` (render/propose tools surface but perform no action). Real read tools call the integration functions (`getLatestEmailTool` → `getLatestEmail()`). `ALL_TOOLS` is a fixed map: `{ get_latest_email, renderLead, renderVerdict, saveDraft }`. **Task 2 expands this.**
- **`apps/inbox/server/mastra/runner.ts`** — `makeMastraRunner(cfg)`:
  - `tools = pick(ALL_TOOLS, [...readTools, ...renderAndProposeTools])` → an `Agent({ instructions, model, tools })`.
  - A 2-step Mastra workflow: `agentStep` streams the agent (forwarding every chunk via `writer.write`, so EVERY tool call surfaces) and captures the LAST approval-named tool call as `draft` + `toolCallId`; `gateStep` `suspend()`s with `{ toolCallId, proposedArtifact: draft }` when there is a draft, else completes. On resume: approved → a short "saved" narrative; rejected → bail with a "rejected" narrative.
  - **`buildPrompt(instructions, messages)` is HARDCODED to lead-inbox reply**: it `decodeHandoff(…, HandoffPayloadSchema)` and emits the reply-specific instructions. `start()` calls it; `resume()` ignores `PromptStrategy` entirely. **Task 1 replaces this with the threaded `PromptStrategy`.**
  - The gate/suspend/resume logic is **already generic** (keys on `approvalNames`, not on any lead-inbox specifics) — do NOT rewrite it.

### What is generic already (do NOT touch)

- The gate suspend/resume (keys on `approvalNames` — `saveDraft` for reply, `applyActions` for batch both work).
- `createMastraProvider` + `mastra-stream.ts` (the chunk→AG-UI mapper) in `@atizar/providers` — a `route_emails` tool call surfaces as `TOOL_CALL_START/ARGS/END` automatically, which the Stage-2 RunObserver turns into a child dispatch. Machine dispatch needs NO Mastra-specific code beyond registering `route_emails` as a (capture) tool so the agent can call it.
- The shared `PostgresStore` (one bounded pool, `max 8`) — keep it.
- The provider conformance suite — it runs on a fake runner; your changes must keep it green.

### Conventions

English only; Prettier (`semi:false`, single quotes, `printWidth:100`); never `git add -A`; commit trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; TDD where there's logic; `browser-verify` skill before any browser/dev-server work. Validation sweep: `yarn typecheck && yarn test && yarn lint`.

### The DEV/prod split + DEMO

`PROVIDER` unset → claude-cli (dev). `PROVIDER=mastra` → the Mastra factory (needs `ANTHROPIC_API_KEY` in the process env: `set -a; . ./.env.local; set +a` before `yarn dev`). `DEMO=1` (packaging stage, later) → mock provider + synthetic cassettes (key-less). This stage targets `PROVIDER=mastra`.

---

## TASK GROUP A — unify the prompt source (delete the hardcoded reply prompt)

This is the keystone: instead of the runner rebuilding a lead-inbox prompt, it uses the agent's `PromptStrategy` (the SAME object claude-cli uses), so all five email-inbox agents get correct prompts and lead-inbox is unchanged.

### Task A1: thread `PromptStrategy` into `MastraRunnerConfig` and use it

**Files:**
- Modify: `apps/inbox/server/mastra/runner.ts`
- Modify: `apps/inbox/server/providers.ts`
- Modify: `apps/inbox/server/mastra/runner.test.ts` (the existing runner unit test — update for the new prompt source)

- [ ] **Step 1: Read `runner.test.ts`** to see how `makeMastraRunner` is currently unit-tested (it likely tests `unwrapStepOutput` and/or a fake-run shape). Note what asserts `buildPrompt` behavior, if anything — those assertions change.

- [ ] **Step 2: Add `prompts` to `MastraRunnerConfig`** and use it. Replace the hardcoded `buildPrompt` with a call to `cfg.prompts.buildFirst(input)` / `cfg.prompts.buildResume(args, executedResult)`:

```ts
import type { PromptStrategy } from '@atizar/core'
import type { RunAgentInput } from '@ag-ui/client'

export interface MastraRunnerConfig {
  agentId: string
  instructions: string
  approvalNames: readonly string[]
  readTools: readonly string[]
  renderAndProposeTools: readonly string[]
  model: string
  databaseUrl: string
  prompts: PromptStrategy // NEW — the single prompt source, shared with claude-cli
}
```

In `start(runId, inputData)`: build the prompt from the strategy, passing the run's messages as a minimal `RunAgentInput`:

```ts
start(runId, inputData) {
  const messages = (inputData.messages ?? []) as Message[]
  const input = { messages, threadId: runId, runId, state: {}, tools: [], context: [], forwardedProps: {} } as RunAgentInput
  const prompt = cfg.prompts.buildFirst(input)
  return deferRun((run) => run.stream({ inputData: { prompt } }), () => createRun(runId))
}
```

> Delete the hardcoded `buildPrompt` function and its `decodeHandoff`/`HandoffPayloadSchema` imports (no longer used). The reply-specific text now lives ONLY in `workflows/{lead-inbox,email-inbox}/prompts` — one source for both providers.

- [ ] **Step 3: Handle `resume()`'s prompt.** Today `resume()` ignores the prompt (Mastra's `gateStep` writes its own "saved"/"rejected" narrative). Decision: **keep the gateStep narrative as-is for now** (it is generic and provider-correct), so `resume()` does NOT need `buildResume`. BUT the gateStep's hardcoded "The Gmail draft was saved." text is lead-inbox-flavored. Generalize it to a neutral line that fits any effect: on approved → `'The action was approved and applied.'`; on rejected → `'The human rejected the proposal; nothing was applied.'`. (The per-workflow specific summary — draftId / applied-count — is a nicety the claude-cli path gets via `buildResume`; Mastra's in-workflow narrative staying generic is acceptable and avoids threading `executedResult` text through Mastra's resume. If you want parity, thread `cfg.prompts.buildResume(args, executedResult)` as the resume narrative instead — OPTIONAL, note which you chose.)

- [ ] **Step 4: Pass `prompts` from the factory.** In `providers.ts` `mastraFactory`, add `prompts: config.prompts` to the `makeMastraRunner({...})` call.

- [ ] **Step 5: Update `runner.test.ts`** — remove/replace any assertion tied to the old `buildPrompt`; if the test constructed a runner, give it a fake `prompts: { buildFirst: () => 'PROMPT', buildResume: () => null }`. Add a focused assertion that `start()` uses `prompts.buildFirst` (e.g. spy that it was called with an input carrying the run's messages).

- [ ] **Step 6: Run** `yarn vitest run apps/inbox/server/mastra/ packages/core` + `yarn typecheck`. Confirm the Mastra conformance test (the fake-runner one — search for it, likely `apps/inbox/server/mastra/*.test.ts` or a providers conformance test) still passes; if it constructs a runner without `prompts`, update its fixture.

- [ ] **Step 7: Commit**

```bash
git add apps/inbox/server/mastra/runner.ts apps/inbox/server/providers.ts apps/inbox/server/mastra/runner.test.ts
git commit -m "refactor(mastra): use the agent PromptStrategy as the single prompt source (drop hardcoded reply prompt) (A1)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK GROUP B — generalize the tool registry

### Task B1: add the email-inbox tools to the Mastra tool map (TDD the read tools)

**Files:**
- Modify: `apps/inbox/server/mastra/tools.ts`
- Modify: `apps/inbox/server/mastra/runner.ts` (extend `ALL_TOOLS`)
- Test: `apps/inbox/server/mastra/tools.test.ts` (new or extend — assert the read tools call the gmail-viewer functions; capture tools echo)

- [ ] **Step 1: Add the tools to `tools.ts`:**

```ts
import { listUnread } from '@atizar/integrations/gmail-viewer/list-unread'
import { getEmail } from '@atizar/integrations/gmail-viewer/get-email'

// Read tools — call the gmail-viewer functions (the SAME functions the stdio MCP wrapper delegates
// to). Reads only; no mutation tool is ever a Mastra tool (effects are server-side).
export const listUnreadTool = createTool({
  id: 'list_unread',
  description: 'List unread inbox emails of the last N hours (default 24). Metadata + snippet, no bodies.',
  inputSchema: z.object({ sinceHours: z.number().int().positive().optional() }),
  execute: async (inputData: { sinceHours?: number }) => listUnread(inputData ?? {}),
})

export const getEmailTool = createTool({
  id: 'get_email',
  description: 'Fetch one email by messageId, including the full text body.',
  inputSchema: z.object({ messageId: z.string() }),
  execute: async (inputData: { messageId: string }) => getEmail(inputData),
})

// Capture (no-op surface) tools — the model CALLS them; the SERVER acts on the call.
// route_emails: a dispatch tool — surfacing the call is enough (RunObserver dispatches the child).
// renderSort: the sorter's summary card. applyActions: the batch approval/propose tool (the gate).
export const routeEmailsTool = captureTool(
  'route_emails',
  z
    .object({
      to: z.string(),
      email: z.record(z.unknown()).optional(),
      emails: z.array(z.record(z.unknown())).optional(),
    })
)
export const renderSortTool = captureTool('renderSort', z.object({}).passthrough())
export const applyActionsTool = captureTool(
  'applyActions',
  z.object({
    items: z.array(
      z.object({
        messageId: z.string(),
        from: z.string().optional(),
        subject: z.string().optional(),
        action: z.enum(['read', 'trash', 'star', 'keep']),
      })
    ),
  })
)
```

> Mastra 1.41: `execute` receives the validated `inputData` as the first positional arg (the existing `captureTool` + `getLatestEmailTool` already follow this). `listUnread`/`getEmail` return `ReadResult` (a plain object) — Mastra serializes it into the tool result; the mastra-stream surfaces the call, and the consuming agent reads the result in-context. Match the existing tool style exactly.

- [ ] **Step 2: Extend `ALL_TOOLS` in `runner.ts`:**

```ts
import {
  getLatestEmailTool, renderLeadTool, renderVerdictTool, saveDraftTool,
  listUnreadTool, getEmailTool, routeEmailsTool, renderSortTool, applyActionsTool,
} from './tools.js'

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
} as const
```

- [ ] **Step 3: TDD the read tools** — in `tools.test.ts`, assert `listUnreadTool.execute` / `getEmailTool.execute` call through to the gmail-viewer functions (inject a fake by mocking, OR just assert the tool ids + inputSchema shapes — the gmail-viewer functions are unit-tested already, so a shape/id assertion plus one fake-`execute` round-trip is enough). Assert the capture tools (`route_emails`, `applyActions`, `renderSort`) echo their input.

- [ ] **Step 4: Run** `yarn vitest run apps/inbox/server/mastra/` + `yarn typecheck`. Verify the `mastraFactory` derivation now resolves all email-inbox agents' tools: sorter → readTools `['list_unread']`, renderAndProposeTools `['route_emails','renderSort']`; reply → readTools `['get_email']`, renderAndPropose `['renderLead','saveDraft']`; batch → renderAndPropose `['applyActions']`. (All must exist in `ALL_TOOLS`, or the runner builds an `Agent` with `undefined` tools → confirm none is undefined.)

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/server/mastra/tools.ts apps/inbox/server/mastra/runner.ts apps/inbox/server/mastra/tools.test.ts
git commit -m "feat(mastra): register email-inbox tools (list_unread/get_email reads + route_emails/renderSort/applyActions) (B1)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task B2: guard against a missing tool (fail-fast at build, not silent)

**Files:**
- Modify: `apps/inbox/server/mastra/runner.ts`
- Test: `apps/inbox/server/mastra/runner.test.ts`

The current `tools = Object.fromEntries([...readTools, ...renderAndProposeTools].map((n) => [n, ALL_TOOLS[n]]))` silently maps an unknown tool name to `undefined`. With more agents, a typo would build an Agent missing a tool and fail mysteriously at run time. Add a fail-fast.

- [ ] **Step 1: Failing test** — `makeMastraRunner` with a `readTools: ['nonexistent']` throws `Error: Mastra has no tool "nonexistent"`.

- [ ] **Step 2: Implement** — in the `tools` build, throw if `ALL_TOOLS[n]` is undefined:

```ts
const tools = Object.fromEntries(
  [...cfg.readTools, ...cfg.renderAndProposeTools].map((n) => {
    const t = ALL_TOOLS[n as keyof typeof ALL_TOOLS]
    if (!t) throw new Error(`Mastra has no tool "${n}" — add it to ALL_TOOLS in mastra/runner.ts`)
    return [n, t]
  })
)
```

- [ ] **Step 3: Run green, commit**

```bash
git add apps/inbox/server/mastra/runner.ts apps/inbox/server/mastra/runner.test.ts
git commit -m "feat(mastra): fail-fast on an unregistered tool name (B2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK GROUP C — live Mastra E2E (the proof)

The conformance suite + unit tests prove structure; the live run proves the email-inbox agent shapes actually work on Mastra. Invoke `browser-verify` first.

### Task C1: live Mastra E2E of the full email-inbox flow

- [ ] **Step 1:** load creds into the env: `set -a; . ./.env.local; set +a` (must contain `ANTHROPIC_API_KEY`). Ensure Postgres is up (`docker compose up -d postgres`) and the DB is clean (`yarn workspace inbox db:reset`). Gmail creds at `~/.gmail-mcp/`.

- [ ] **Step 2:** `PROVIDER=mastra yarn dev` (NOT record/replay — Mastra runs live; record/replay re-key was deferred in the beta and is not needed here). Open `http://localhost:5173`, Email inbox tab, START the sorter.

- [ ] **Step 3: Verify each flow on the live Mastra path** (drive with Playwright-MCP; this is REAL mail + REAL LLM — be deliberate, undo Gmail changes):
  1. **Sort + machine dispatch:** the sorter calls `list_unread`, then `route_emails` per group; children appear nested in the pipeline; `renderSort` summary renders. (Proves `route_emails` surfaces as a tool-call and RunObserver dispatches on Mastra — the keystone for machine dispatch on the prod provider.)
  2. **Batch approve with edited rows:** open a batch child → EmailBatchCard → edit a row → Apply → gate resolves → **verify the real Gmail action happened (API), then undo**; DB shows the ledger row + `finished`.
  3. **Reply approve → real draft:** reply child reads the body (get_email) + drafts → edit + Approve → **fetch the real draft by id → edited body present** → delete the test draft.
  4. **Reject** a batch gate → `finished`/`rejected`, no Gmail change, no ledger.
  5. **Cancel mid-run** (the beta caught a Mastra bug here — `finally{run.abort()}` cancelled a clean suspend): Stop a running child → the Mastra run is aborted, the item is `cancelled`, and a DIFFERENT child that reached its gate is NOT disturbed (its suspended run survives). This is the load-bearing Mastra cancel check.
  6. **Singleton guard:** a second START of the sorter → 409.

- [ ] **Step 4: Record PASS/FAIL per flow.** A FAIL is a STOP — fix (likely in `runner.ts`/`tools.ts`) and re-verify. Known Mastra trap to watch (from the beta): the provider must `abort()` ONLY on a real interrupt (Stop/`iterator.return`), NEVER on a clean suspend/finish — a regression here makes resume fail with "This workflow run was not suspended". If you touch the abort path, re-verify flow 5 carefully.

### Task C2: regression — claude-cli still works

- [ ] **Step 1:** unset `PROVIDER` (or `PROVIDER=claude-cli`), `DEV_RECORD_REPLAY=1 yarn dev`, and re-run the Stage-3 cassette E2E for ONE flow (e.g. reply approve → draft) to confirm the prompt-source unification (Task A1) did not regress claude-cli. (Lead-inbox should also still work — its prompts come from `lead-inbox/prompts`, now the single source for both providers.)

- [ ] **Step 2:** `yarn typecheck && yarn test && yarn lint && yarn build` green.

---

## TASK GROUP D — wrap-up

### Task D1: foundation check + docs

- [ ] **check-foundation** — assert I4 (now TWO unlike providers run the SAME flagship workflow — swappability proven, not declared), I2/I9 (Mastra path: the model proposes via `route_emails`/`applyActions`/`saveDraft` capture tools; the SERVER executes the effect after approval — no Gmail mutation is a Mastra tool), I3 (no engine import leaked into `@atizar/core`; the Mastra assembly stays in `apps/inbox/server/mastra/`). WARN → STOP.

- [ ] **HANDOFF.md** — mark Stage 3b ✅ BUILT: the Mastra runner now uses the agent `PromptStrategy` (one prompt source for both providers; hardcoded reply prompt deleted); the email-inbox tools are registered; machine dispatch + batch gate + reply draft verified live on `PROVIDER=mastra`; the cancel-mid-run guard holds. Note that the public demo can now run on Mastra. Next = Stage 4 (UI chrome).

- [ ] **`docs/AGENTIC.md`** — add the parked future item the user requested (2026-06-11): a Phase-2 **`add-provider` / `write-provider` consumer skill** (in `@atizar/providers`), with the conformance suite as the definition-of-done; the first real exercise will be adding a non-Mastra, non-CLI provider (e.g. the Anthropic SDK directly) — explicitly LATER, after the beta demo. Match the existing roadmap bullet style; mark it ❌ (not built), gated on demand.

- [ ] **Commit docs** (exact paths).

```bash
git add HANDOFF.md docs/AGENTIC.md
git commit -m "docs(handoff): email-inbox runs on Mastra (stage 3b); park add-provider skill for later

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task D2: final whole-branch review

- [ ] Dispatch a final reviewer over the stage's commits: the prompt source is genuinely unified (no second prompt path; lead-inbox + email-inbox both build from their `prompts` module for BOTH providers); every email-inbox tool resolves in `ALL_TOOLS` (fail-fast guards the rest); no Gmail mutation is a Mastra tool (I2/I9); the cancel/abort path is unchanged or re-verified. Ready-to-merge or issues-first.

---

## SELF-REVIEW NOTES (applied)

- **Keystone is the prompt unification** (Task A1): it both fixes email-inbox on Mastra AND removes a duplicated, drift-prone reply prompt — claude-cli and Mastra now share `workflows/<id>/prompts`. This is the cleanest generalization; resist re-adding a Mastra-specific prompt path.
- **Machine dispatch needs no Mastra-specific code** beyond registering `route_emails` as a capture tool — the surfacing + RunObserver dispatch are provider-agnostic (Stage 2). Stated explicitly so the implementer doesn't over-build.
- **The gate/suspend/resume logic is already generic** — touch only the hardcoded "Gmail draft was saved" narrative (neutralize it); do NOT rewrite the suspend keying.
- **Cancel-mid-run is the known Mastra trap** — flow 5 of the live E2E is mandatory, with the beta's `abort()`-only-on-interrupt lesson quoted.
- **Regression guard** (Task C2): the prompt-source change touches lead-inbox's path too (it now also flows through `prompts.buildFirst` on Mastra) — re-verify one claude-cli flow.
- **Parked, not built:** the `add-provider` skill + a new SDK provider are recorded in AGENTIC as a later item per the user (2026-06-11), not built here.

## Subsequent stages (unchanged)

- **Stage 4 — React/UI chrome:** primitives, header (Chrome tabs + Stop-all + activity toggle), F3 health badge, F6 START-disable, F7 pipeline states, ActivityLog panel. Browser-verify every flow.
- **Stage 5 — polish + full-scenario E2E**; reword the HANDOFF draft-only line.
- **Packaging tail (7c):** bearer-token auth; `DEMO=1` (PGlite + mock + synthetic cassettes; note the public demo's Mastra path is separate from the key-less DEMO path — clarify the two at packaging time); golden-set eval; README; LICENSE + `@atizar/*` scope rename (ASK THE USER for both); the `write-provider` skill + a new provider (Anthropic SDK) when demand lands.
