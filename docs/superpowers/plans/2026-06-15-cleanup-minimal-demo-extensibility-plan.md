# Cleanup → Minimal Demo → Extensibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking. Pairs with the spec
> `docs/superpowers/specs/2026-06-15-cleanup-minimal-demo-extensibility-design.md` — read it first.

**Goal:** Trim the demo to a single clean `email-inbox` reference workflow, make prompts a reusable
framework primitive (`definePrompt`), kill remaining magic strings, add board-cleanup/Reset, re-audit
the library boundary, record a fresh real cassette, and ship an `add-workflow` skill.

**Architecture:** A new pure `definePrompt` helper in `@atizar/core` owns prompt boilerplate
(decode/branch/resume); claude-cli prepends the composed identity so prose stays turn-only. Wire strings
become per-workflow consts (no enums, I7). Board visibility drops finished items from the live column;
Reset drives `transition()` (I8) and hides-never-destroys (I12).

**Tech Stack:** TypeScript, Zod, Vitest, React + Vite, Hono, Postgres/Drizzle, yarn-classic workspace.
Run everything from the repo root.

---

## Units & order

- **Unit 1 — Trim to email-inbox** (independent) — gives the clean base.
- **Unit 2 — `definePrompt` in core + provider prepend** (independent of 1; touches core + providers).
- **Unit 3 — email-inbox prompts/consts refactor + CONVENTIONS** (needs Units 1 + 2 merged).
- **Unit 4 — Board cleanup + Reset** (independent; touches @atizar/react + @atizar/server).
- **Unit 5 — Boundary extractions** (after Unit 1).
- **Unit 6 — Cassettes** (LAST; blocked on developer Gmail re-auth).
- **Unit 7 — `add-workflow` skill** (after Units 1–5).

Units 1, 2, 4 can run in parallel (separate file areas). 3 waits on 1+2. Each unit = one branch off
`master`, merged when its green gate + browser-verify pass.

**Green gate (every unit before "done"):**
`yarn typecheck && yarn test && yarn lint && yarn format:check`
(+ `yarn workspace @atizar/react build` for any `@atizar/react` change).

---

## Unit 1 — Trim the demo to email-inbox only

Branch: `cleanup/trim-to-email-inbox`. No new framework code — deletions + rewiring + the card-registration
fix. Read each file before editing; line numbers drift as you delete.

### Task 1.1 — Delete the two workflows and github-only infra

- [ ] **Step 1: Delete directories and files**

```bash
git rm -r apps/inbox/workflows/lead-inbox apps/inbox/workflows/github-triage
git rm apps/inbox/mcp/github-tools.mjs apps/inbox/mcp/github-format.mjs apps/inbox/mcp/github-format.test.mjs
git rm apps/inbox/agents/qualifier.prompts.ts apps/inbox/agents/qualifier.prompts.test.ts
git rm apps/inbox/agents/triage.prompts.ts apps/inbox/agents/triage.prompts.test.ts
git rm apps/inbox/agents/ticket.prompts.ts apps/inbox/agents/ticket.prompts.test.ts
git rm apps/inbox/agents/inbox.agent.test.ts apps/inbox/agents/github.agent.test.ts
git rm apps/inbox/eval/lead-inbox.eval.ts apps/inbox/eval/scenarios/lead-inbox.ts
git rm apps/inbox/client/src/renderLead.test.tsx apps/inbox/client/src/renderVerdict.test.tsx
```

(If any path 404s, `ls` the dir and adjust — some `.test` siblings may not exist.)

- [ ] **Step 2: Commit the bulk delete**

```bash
git add -A apps/inbox/workflows apps/inbox/mcp apps/inbox/agents apps/inbox/eval apps/inbox/client/src
git commit -m "chore(inbox): delete lead-inbox + github-triage workflows and github-only infra"
```

### Task 1.2 — Rewire the three aggregators

**Files:** Modify `apps/inbox/workflows/index.ts`, `apps/inbox/server/workflows.ts`,
`apps/inbox/client/src/workflows.ts`.

- [ ] **Step 1: Remove lead-inbox + github-triage imports/entries** from all three so only `emailInbox`
  remains. After editing, `workflows/index.ts` exports `[emailInbox]`; `server/workflows.ts` registers
  only `{ descriptor: emailInbox, bindings: emailInboxServer }`; `client/src/workflows.ts` merges only
  `emailInboxMeta`, scopes only `email-inbox` renders + hitl.

- [ ] **Step 2: Typecheck to surface dangling refs**

Run: `yarn typecheck`
Expected: errors ONLY where deleted symbols are still referenced (fix those imports). Iterate to green.

### Task 1.3 — Remove github tool defs from the Mastra provider wiring

**Files:** Modify `apps/inbox/server/mastra/tools.ts` (delete `listMyTicketsTool`, `getTicketTool`,
`renderTriageTool`, `renderTicketResultTool`, `renderReplyDraftTool` + the github comment block),
`apps/inbox/server/providers.ts` (delete the github entries from `ALL_TOOLS` + the github comment).

- [ ] **Step 1: Delete the github tool defs and their references; run typecheck**

Run: `yarn typecheck`
Expected: green (no consumer left after Task 1.2).

### Task 1.4 — Fix the card-registration gotcha (email-inbox self-registers its reply cards)

**Files:** Modify `apps/inbox/workflows/email-inbox/client.tsx`.

Context: email-inbox's reply agent renders `renderLead → LeadCard` and `saveDraft → ApprovalDialog`.
These were previously registered by lead-inbox (scoped first). After the trim, email-inbox must declare
them in its own render specs.

- [ ] **Step 1: Add the two render specs to `emailInboxRenders`** (import the components from
  `../../client/src/components/LeadCard/LeadCard` and `.../ApprovalDialog/ApprovalDialog`; map
  `renderLead → LeadCard`, `saveDraft → ApprovalDialog`). Remove the now-stale "already registered by
  lead-inbox" comment.

- [ ] **Step 2: Update remaining tests** that referenced deleted workflows
  (`apps/inbox/workflows/descriptors.parse.test.ts` — drop the lead/github describe blocks;
  `apps/inbox/client/src/workflows.test.ts` — drop the "reused by lead-inbox" assertions). Keep
  email-inbox assertions.

- [ ] **Step 3: Green gate**

Run: `yarn typecheck && yarn test && yarn lint && yarn format:check && yarn workspace @atizar/react build`
Expected: PASS.

- [ ] **Step 4: Browser-verify** (invoke the `browser-verify` skill, `DEV_RECORD_REPLAY=1`):
  start email-inbox → sorter routes → open the reply instance → its LeadCard + ApprovalDialog render →
  approve → confirm card. Then a batch instance → EmailBatchCard → approve.

- [ ] **Step 5: Commit + merge**

```bash
git add apps/inbox/workflows/email-inbox/client.tsx apps/inbox/workflows/descriptors.parse.test.ts apps/inbox/client/src/workflows.test.ts apps/inbox/server
git commit -m "feat(inbox): single email-inbox reference workflow; self-register reply cards"
git switch master && git merge --no-ff cleanup/trim-to-email-inbox && git branch -d cleanup/trim-to-email-inbox
```

---

## Unit 2 — `definePrompt` in `@atizar/core` + claude-cli identity prepend

Branch: `feat/define-prompt`. **Foundation-touching** (core SDK + provider contract) → run the
`check-foundation` skill before merge; warn + confirm if it flags I3/I4. Independent of Unit 1.

### Task 2.1 — Add `definePrompt` (TDD)

**Files:** Create `packages/core/src/definePrompt.ts`, `packages/core/src/definePrompt.test.ts`;
Modify `packages/core/src/index.ts` (add `export * from './definePrompt.js'`).

- [ ] **Step 1: Write the failing test**

`packages/core/src/definePrompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import type { RunAgentInput } from '@ag-ui/client'
import { definePrompt } from './definePrompt.js'
import { encodeHandoff } from './handoff.js'

const Schema = z.object({ email: z.object({ from: z.string() }) })
const base = { threadId: 't', runId: 'r', state: {}, tools: [], context: [], forwardedProps: {} }
const inputWith = (p: unknown): RunAgentInput => ({ ...base, messages: [encodeHandoff(p)] } as RunAgentInput)
const emptyInput = { ...base, messages: [] } as RunAgentInput

describe('definePrompt', () => {
  it('exposes identity for the descriptor to reference', () => {
    const p = definePrompt({ identity: 'who I am', onStart: () => 's' })
    expect(p.identity).toBe('who I am')
  })
  it('renders onInput when a matching payload decodes', () => {
    const p = definePrompt({ identity: 'i', input: Schema, onInput: ({ email }) => `to ${email.from}`, onStart: () => 'start' })
    expect(p.buildFirst(inputWith({ email: { from: 'jane@acme.com' } }))).toBe('to jane@acme.com')
  })
  it('falls back to onStart when no payload decodes', () => {
    const p = definePrompt({ identity: 'i', input: Schema, onInput: ({ email }) => `to ${email.from}`, onStart: () => 'start' })
    expect(p.buildFirst(emptyInput)).toBe('start')
  })
  it('input agent (no schema) always renders onStart', () => {
    const p = definePrompt({ identity: 'i', onStart: () => 'read the inbox' })
    expect(p.buildFirst(emptyInput)).toBe('read the inbox')
  })
  it('buildFirst is turn-only — it does NOT include identity', () => {
    const p = definePrompt({ identity: 'IDENTITY', onStart: () => 'TURN' })
    expect(p.buildFirst(emptyInput)).toBe('TURN')
  })
  it('buildResume passes the server effect result', () => {
    const p = definePrompt({ identity: 'i', onStart: () => 's', onResume: ({ draftId }) => `saved ${draftId}` })
    expect(p.buildResume?.({}, { draftId: 'd1' })).toBe('saved d1')
  })
  it('no onResume → buildResume is undefined', () => {
    const p = definePrompt({ identity: 'i', onStart: () => 's' })
    expect(p.buildResume).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `yarn test packages/core/src/definePrompt.test.ts`
Expected: FAIL — `definePrompt` not found.

- [ ] **Step 3: Implement `packages/core/src/definePrompt.ts`**

```ts
import type { z } from 'zod'
import type { RunAgentInput } from '@ag-ui/client'
import { decodeHandoff } from './handoff.js'
import type { PromptStrategy } from './providers.js'

// Declarative prompt for one agent. buildFirst/buildResume return TURN-ONLY prose — the agent's
// identity (descriptor.instructions, composed with the workflow prompt) is prepended by the provider,
// never repeated here. `identity` is carried on the result so the descriptor can reference it
// (instructions: replyPrompt.identity). Owns the decode/branch/resume boilerplate.
export interface PromptSpec<T> {
  // Who the agent is. Becomes the descriptor's `instructions` (config-as-data, I7).
  identity: string
  // Handoff payload schema. Omit for input agents (human-started, no payload).
  input?: z.ZodType<T>
  // First turn WITH a decoded payload.
  onInput?: (payload: T) => string
  // First turn with NO payload: an input agent's start, or a worker that wasn't handed anything.
  onStart: () => string
  // After the human approves and the SERVER ran the effect (`result` = effect result, e.g. { draftId }).
  onResume?: (result: Record<string, unknown>) => string
}

export function definePrompt<T>(spec: PromptSpec<T>): PromptStrategy & { identity: string } {
  return {
    identity: spec.identity,
    buildFirst(input: RunAgentInput): string {
      if (spec.input && spec.onInput) {
        const payload = decodeHandoff(input, spec.input)
        if (payload) return spec.onInput(payload)
      }
      return spec.onStart()
    },
    buildResume: spec.onResume
      ? (_args: Record<string, unknown>, executedResult?: Record<string, unknown>): string | null =>
          spec.onResume!(executedResult ?? {})
      : undefined,
  }
}
```

- [ ] **Step 4: Export it** — add to `packages/core/src/index.ts`: `export * from './definePrompt.js'`

- [ ] **Step 5: Run, verify pass**

Run: `yarn test packages/core/src/definePrompt.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/definePrompt.ts packages/core/src/definePrompt.test.ts packages/core/src/index.ts
git commit -m "feat(core): definePrompt — reusable turn-only prompt strategy"
```

### Task 2.2 — claude-cli prepends the composed identity (TDD)

Context: `ProviderConfig.instructions` is the composed `workflow.prompt + agent.instructions`
(`createServer.ts:102`). Today claude-cli ignores it and relies on the strategy baking it in. Change:
prepend `config.instructions` to the strategy's `buildFirst`/`buildResume` output, so prose is turn-only.

**Files:** Modify `packages/providers/src/claude-cli-provider.ts`; add/modify its test.

- [ ] **Step 1: Write a failing test** asserting the primed prompt starts with the composed instructions.
  In `packages/providers/src/claude-cli-provider.test.ts` add a case: build a provider with
  `instructions: 'HOUSE RULES'` and a `prompts` whose `buildFirst` returns `'TURN STEPS'`; capture the
  prompt passed to the (mocked) spawn; assert it equals `'HOUSE RULES\n\nTURN STEPS'`.

- [ ] **Step 2: Run, verify fail**

Run: `yarn test packages/providers/src/claude-cli-provider.test.ts`
Expected: FAIL — prompt currently equals `'TURN STEPS'` (no prepend).

- [ ] **Step 3: Implement the prepend** — in `claude-cli-provider.ts`, where the provider calls
  `prompts.buildFirst(input)` (line ~109) and the resume prompt (line ~106), wrap with a helper:

```ts
const withIdentity = (turn: string | null): string | null =>
  turn == null ? null : config.instructions ? `${config.instructions}\n\n${turn}` : turn
// first turn:
yield* primeAndStream(withIdentity(prompts.buildFirst(input))!, approvalNames)
// resume turn (both call sites):
const resumePrompt = withIdentity(prompts.buildResume?.(args, executedResult) ?? null)
```

(`config` here is the `ProviderConfig` the factory closes over; confirm the param name in the file.)

- [ ] **Step 4: Run, verify pass**

Run: `yarn test packages/providers/src/claude-cli-provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the conformance suite** to prove the contract still holds across providers.

Run: `yarn test packages/core/src/conformance.test.ts packages/providers`
Expected: PASS. If a Mastra-path test now expects identity inside `buildFirst`, update it to expect
turn-only `buildFirst` (the identity is the Agent's system prompt). Document any such change in the commit.

- [ ] **Step 6: `check-foundation`** — run the skill against this diff (core SDK addition + provider
  contract). Confirm no I3/I4 erosion (definePrompt is pure; the contract is proven by conformance).

- [ ] **Step 7: Commit + merge**

```bash
git add packages/providers/src/claude-cli-provider.ts packages/providers/src/claude-cli-provider.test.ts
git commit -m "feat(providers): claude-cli prepends composed identity; prompt strategy is turn-only"
git switch master && git merge --no-ff feat/define-prompt && git branch -d feat/define-prompt
```

---

## Unit 3 — email-inbox prompts/consts refactor + CONVENTIONS (needs Units 1 + 2)

Branch: `refactor/email-inbox-single-source`. Pure userland refactor on the trimmed base. Behavior must
be byte-identical at the model boundary except the (intended) de-duplication of identity.

### Task 3.1 — Extract contracts + id/role consts

**Files:** Create `apps/inbox/workflows/email-inbox/contracts.ts` (move `EmailRefSchema`,
`EmailBatchSchema`, `ReplyPayloadSchema` out of `descriptor.ts`); Create
`apps/inbox/workflows/email-inbox/ids.ts`:

```ts
export const EMAIL_INBOX_ID = 'email-inbox' as const
export const EMAIL_INBOX_AGENTS = {
  sorter: 'sorter', reply: 'reply', reader: 'reader', spam: 'spam', important: 'important',
} as const
export type EmailInboxAgentId = (typeof EMAIL_INBOX_AGENTS)[keyof typeof EMAIL_INBOX_AGENTS]
export const ROLES = { input: 'input', worker: 'worker' } as const
```

Extend `apps/inbox/workflows/email-inbox/tools.ts` to also carry the read tools (`list_unread`,
`get_email`) so `readonly` arrays stop using raw strings.

- [ ] **Step 1:** Create the files; update `descriptor.ts` imports (schemas now from `contracts.ts`).
- [ ] **Step 2:** Replace raw literals in `descriptor.ts`: `id: EMAIL_INBOX_ID`; `handoffs` via
  `EMAIL_INBOX_AGENTS.*`; `role` via `ROLES.*`; `readonly` via the tool consts.
- [ ] **Step 3:** In `client/src/workflows.ts` use `scope(EMAIL_INBOX_ID, …)` (import from `ids.ts`).
- [ ] **Step 4: Typecheck.** Run: `yarn typecheck` — Expected: green.

### Task 3.2 — Rewrite prompts with `definePrompt` (TDD: assert the composed strings)

**Files:** Rewrite `apps/inbox/workflows/email-inbox/prompts.ts`; Modify
`apps/inbox/workflows/email-inbox/server.ts` (drop the `compose(...)` baking — the provider now prepends
identity; bind `prompts: replyPrompt` etc.); delete the now-unused `apps/inbox/agents/reply.prompts.ts`
(+ its test) once its content is migrated.

- [ ] **Step 1: Write the prompt tests** in `apps/inbox/workflows/email-inbox/prompts.test.ts` asserting
  each agent's `buildFirst`/`buildResume` output (turn-only, no identity) for: sorter start, reply
  onInput (with a sample email; assert tool names from `t.*` appear), reply onStart, reply onResume
  (draftId), batch onInput/onResume. Use `encodeHandoff` to seed payloads.

- [ ] **Step 2: Run, verify fail.** Run: `yarn test apps/inbox/workflows/email-inbox/prompts.test.ts -c vitest.config.ts`

- [ ] **Step 3: Implement `prompts.ts`** using `definePrompt` per the spec §1 (sorterPrompt with
  `identity` + `onStart`; replyPrompt with `identity` + input/onInput/onStart/onResume; `batchPrompt(def)`
  factory → reader/spam/important, each carrying `identity`). Tool names interpolated from
  `EMAIL_INBOX_TOOLS as t`. Then in `descriptor.ts` set each agent's `instructions: <agent>Prompt.identity`
  (import the prompt blocks from `prompts.ts`; no cycle — schemas live in `contracts.ts`).

- [ ] **Step 4:** Update `server.ts` bindings to `prompts: sorterPrompt` / `replyPrompt` /
  `readerPrompt` … (no `compose`, no `createXxxPrompts`). Keep `effects` + `allowedTools` unchanged.

- [ ] **Step 5: Run, verify pass.** Run: `yarn test apps/inbox/workflows/email-inbox -c vitest.config.ts`

### Task 3.3 — Drift-guard test

**Files:** Create `apps/inbox/workflows/email-inbox/prompts.drift.test.ts`.

- [ ] **Step 1: Write the test** — for each exported prompt, render `onStart` and a representative
  `onInput`/`onResume`, scan the text for tokens that look like tool calls (`/\b([a-z_]+)\b/` filtered to
  words mentioned after "Call "), and assert each ∈ `Object.values(EMAIL_INBOX_TOOLS)`; assert every
  `handoffs` entry in the descriptor ∈ `Object.values(EMAIL_INBOX_AGENTS)`.

- [ ] **Step 2: Run, verify pass.** Run: `yarn test apps/inbox/workflows/email-inbox/prompts.drift.test.ts -c vitest.config.ts`

### Task 3.4 — Write the standards into CONVENTIONS + verify

**Files:** Modify `docs/CONVENTIONS.md`.

- [ ] **Step 1:** Add a "Workflows: wire strings & prompts" section: wire strings via per-workflow consts
  (never enums); prompts via `definePrompt` (flat, turn-only); identity in the descriptor; "structure →
  descriptor, words → prompts.ts"; drift-guard test required per workflow; `scope(WORKFLOW_ID, …)`.

- [ ] **Step 2: Green gate.**
Run: `yarn typecheck && yarn test && yarn lint && yarn format:check`
Expected: PASS.

- [ ] **Step 3: Browser-verify** (`browser-verify`, `DEV_RECORD_REPLAY=record` to refresh cassettes after
  the prompt change, then `=1`): email-inbox sort → reply approve → confirm; batch approve. Confirm the
  model still behaves (no identity lost, no double).

- [ ] **Step 4: Commit + merge**

```bash
git add apps/inbox/workflows/email-inbox docs/CONVENTIONS.md
git rm apps/inbox/agents/reply.prompts.ts apps/inbox/agents/reply.prompts.test.ts
git commit -m "refactor(email-inbox): definePrompt + single-source wire strings; document conventions"
git switch master && git merge --no-ff refactor/email-inbox-single-source && git branch -d refactor/email-inbox-single-source
```

---

## Unit 4 — Board cleanup + Reset

Branch: `feat/board-reset`. Touches `@atizar/react` + `@atizar/server`. **Foundation-touching** (I8/I12)
→ run `check-foundation`. Independent of Units 1–3.

### Task 4.1 — Finished agents (incl. input) leave the live pipeline (TDD)

**Files:** Modify `packages/react/src/boardModel.ts` (`isVisible`), `packages/react/src/pipelineModel.ts`
(`buildPipeline`); update their tests.

- [ ] **Step 1: Update `boardModel.test.ts`** — add/adjust a case: a finished INPUT root with no active
  child is NOT visible (today it is). A finished input root WITH an active child stays visible.

- [ ] **Step 2: Run, verify fail.** Run: `yarn test packages/react/src/boardModel.test.ts`

- [ ] **Step 3: Implement** — in `isVisible`, drop the `isInput ||` clause from the finished/closed branch
  so a terminal item is visible only if it still carries live work (active descendant). In `pipelineModel`,
  change the `shown` seed so `x.isInput` only forces visibility when the instance is non-terminal (keep the
  ancestor-promotion walk for active children).

- [ ] **Step 4: Update `pipelineModel.test.ts`** for the new rule; run both. Run:
  `yarn test packages/react/src/boardModel.test.ts packages/react/src/pipelineModel.test.ts`
  Expected: PASS.

### Task 4.2 — START not blocked by an error (TDD)

**Files:** Modify `packages/react/src/aggregate.ts` (or `components/AgentCard/AgentCard.tsx` — whichever
owns the START-vs-label decision); update tests.

- [ ] **Step 1: Failing test** — an agent whose only instance is `error` should expose START (today
  `aggregateLabel` is non-empty → START hidden). Add to `aggregate.test.ts`.

- [ ] **Step 2: Run, verify fail.** Run: `yarn test packages/react/src/aggregate.test.ts`

- [ ] **Step 3: Implement** — introduce a `canStart`/`isBusy` derivation that counts only
  `running` + `awaiting_approval` (NOT `error`); AgentCard shows START when not busy, with the error badge
  alongside. Keep `aggregateLabel` for the busy summary.

- [ ] **Step 4: Run, verify pass.** Run: `yarn test packages/react/src/aggregate.test.ts`

### Task 4.3 — Server reset transition + routes (TDD)

**Files:** Modify `packages/server/src/transition.ts` (add a `reset` edge), `packages/server/src/db/schema.ts`
(if a new `resolution` value is needed), `packages/server/src/routes.ts` (+ a service method); their tests.

- [ ] **Step 1: Failing test** in `transition.test.ts` — `transition(db, id, 'reset')` moves a `finished`
  item to `closed` with `resolution: 'reset'`; rejects from `running`/`awaiting_approval` (those must be
  `cancel`led first).

- [ ] **Step 2: Run, verify fail.** Run: `yarn test packages/server/src/transition.test.ts`

- [ ] **Step 3: Implement** — add to `EDGES`: `reset: { from: ['finished', 'result', 'error'], to: 'closed' }`
  and to `EDGE_RESOLUTION`: `reset: 'reset'` (add `'reset'` to the resolution union/enum if it is typed).

- [ ] **Step 4: Add service + routes** — a `resetWorkflow(id)` (close all terminal items in the workflow)
  and `resetAll()` (all workflows) on the PipelineService; routes
  `POST /api/workflows/:id/reset` and `POST /api/reset-all` mirroring the cancel routes
  (`routes.ts:187`/`193`). For active/awaiting items the route returns the count without closing them
  (the client confirms + cancels separately). Add route tests.

- [ ] **Step 5: Run, verify pass.** Run: `yarn test packages/server/src/transition.test.ts packages/server/src/routes.test.ts`

### Task 4.4 — Reset UI + resetOnStart knob

**Files:** Create `packages/react/src/primitives/ResetButton/ResetButton.tsx` (+ `.module.scss`);
Modify `packages/react/src/hooks/useDispatch.ts` (add `resetWorkflow`, `resetAll`), the StopController-style
state for confirm; Modify `packages/react/src/index.ts` (export `ResetButton`); wire into
`apps/inbox/client/src/BoardApp/BoardInner.tsx`. Add `resetOnStart?: boolean` to
`packages/core/src/defineWorkflow.ts` (`WorkflowDescriptor`) + honor it in `pipelineService.dispatch`.

- [ ] **Step 1:** Add `resetWorkflow`/`resetAll` to `useDispatch` (fetch the new routes, `authHeaders`).
- [ ] **Step 2:** Build `ResetButton` mirroring `StopButton`; add a confirm path (reuse the
  `ConfirmDialog` pattern) for when active/awaiting items exist — on confirm, cancel them then reset.
- [ ] **Step 3:** Add `resetOnStart?: boolean` to `WorkflowDescriptor` (documented as config-as-data, I7);
  in `pipelineService.dispatch`, when set, close the workflow's terminal items before spawning.
- [ ] **Step 4: `check-foundation`** — confirm I8 (status only via `transition`) and I12 (no silent
  destruction; the confirm gate guards open work).
- [ ] **Step 5: Green gate.**
Run: `yarn typecheck && yarn test && yarn lint && yarn format:check && yarn workspace @atizar/react build`
- [ ] **Step 6: Browser-verify** (`browser-verify`): scan finishes → input plate leaves the live column,
  result still in Activity; per-workflow Reset clears the board; full reset clears all; an errored item
  shows START; full reset with an awaiting-approval item prompts to confirm before cancelling.
- [ ] **Step 7: Commit + merge**

```bash
git add packages/react packages/server packages/core apps/inbox/client
git commit -m "feat(board): finished agents leave the live pipeline; per-workflow + full Reset"
git switch master && git merge --no-ff feat/board-reset && git branch -d feat/board-reset
```

---

## Unit 5 — Boundary extractions (after Unit 1)

Branch: `refactor/boundary-extractions`. Small, mechanical.

### Task 5.1 — Move `scope()` into `@atizar/react`

**Files:** Modify `packages/react/src/` (add `scope` + export from `index.ts`); update
`apps/inbox/client/src/workflows.ts` to import `scope` from `@atizar/react`.

- [ ] **Step 1:** Move the `scope<T>(workflowId, specs)` helper from `client/src/workflows.ts` into a small
  `packages/react/src/scope.ts`; export it; keep a unit test (`scope.test.ts`) asserting it stamps
  `workflowId` + dedups.
- [ ] **Step 2: Typecheck + test.** Run: `yarn typecheck && yarn test packages/react/src/scope.test.ts`

### Task 5.2 — Export `captureTool()` from `@atizar/server`

**Files:** Move the capture-tool helper out of `apps/inbox/server/mastra/tools.ts` into
`packages/server/src/` (e.g. `mastraTools.ts`), export from `@atizar/server`; import it back in the app.

- [ ] **Step 1:** Extract + export `captureTool`; update the app import.
- [ ] **Step 2: Green gate + react build.**
Run: `yarn typecheck && yarn test && yarn lint && yarn format:check && yarn workspace @atizar/react build`
- [ ] **Step 3: Browser-verify** smoke (board loads, a run renders a card) then commit + merge.

```bash
git add packages/react packages/server apps/inbox
git commit -m "refactor(boundary): extract scope() to @atizar/react and captureTool() to @atizar/server"
git switch master && git merge --no-ff refactor/boundary-extractions && git branch -d refactor/boundary-extractions
```

---

## Unit 6 — Cassettes (LAST; blocked on developer Gmail re-auth)

No branch needed (no code). **Prereq (developer, real terminal):** re-auth Gmail so
`~/.gmail-mcp/` has a valid refresh token (current: `invalid_grant`). Until then this unit cannot run.

- [ ] **Step 1:** Confirm credentials: `yarn dev:server` then `GET /api/health` reports gmail `ok:true`.
- [ ] **Step 2:** Wipe cassettes: `rm -rf apps/inbox/.cassettes/*`
- [ ] **Step 3:** Run a real flow with `DEV_RECORD_REPLAY=record yarn dev`; via the browser, run
  email-inbox end-to-end (sort → reply approve → confirm; one batch approve). Confirm one JSONL per
  `wf__agent` appears under `apps/inbox/.cassettes/`.
- [ ] **Step 4:** Replay: restart with `DEV_RECORD_REPLAY=1 yarn dev`; re-run the same flow; confirm it
  replays instantly with no Gmail calls.
- [ ] **Step 5:** Delete the stale WS5 draft `r7666524379648912752` from Gmail Drafts (manual).
- [ ] **Step 6:** Do NOT commit cassettes (gitignored; real data). If ever asked to share, run the
  `scanCassette` ritual first (warn + scan + report + wait).

---

## Unit 7 — `add-workflow` skill (after Units 1–5)

Branch: `feat/add-workflow-skill`.

**Files:** Create `.claude/skills/add-workflow/SKILL.md` (+ any `references/`).

- [ ] **Step 1:** Write the skill walking the clean pattern, referencing real email-inbox paths:
  `contracts.ts` (schemas + consts) → `tools.ts`/`cards.ts`/`ids.ts` → `prompts.ts` (`definePrompt`
  blocks, turn-only, tool names from consts) → `descriptor.ts` (structure: agents, roles via `ROLES`,
  handoffs via the agent-id consts, `connections`, `rerun`, `resetOnStart`) → `server.ts` (effects,
  `allowedTools`) → `client.tsx` (render/HITL specs, register own cards) → aggregator wiring (the 3
  files) → tests (incl. the drift guard) → green gate → browser-verify.
- [ ] **Step 2:** Add the "gotchas" the email-inbox trim surfaced (a workflow must register its OWN render
  cards; the descriptor↔prompts cycle is broken via `contracts.ts`).
- [ ] **Step 3:** Dry read-through: a fresh agent could scaffold a new workflow from the skill without
  re-deriving boilerplate. Commit + merge.

```bash
git add .claude/skills/add-workflow
git commit -m "docs(skill): add-workflow — how to build a new workflow from the email-inbox reference"
git switch master && git merge --no-ff feat/add-workflow-skill && git branch -d feat/add-workflow-skill
```

---

## After all units

Update `HANDOFF.md`: move the completed track into BUILD-LOG / git; reset HANDOFF to the new "where we
are + next". Note any open tails (Mastra system-vs-turn double if conformance surfaced it; the OAuth
re-auth status).

## Self-review (done while writing)

- **Spec coverage:** Task 1↔Unit 1; §1 definePrompt + provider↔Unit 2; §2 consts/CONVENTIONS + Task 5
  fold↔Unit 3; Task 3 board↔Unit 4; Task 4 boundary↔Unit 5; Task 6↔Unit 6; Task 7↔Unit 7. All covered.
- **Placeholders:** novel code (definePrompt + test, claude-cli prepend, reset edge) is complete;
  mechanical units use exact paths/commands (deletions/rewrites need no code block). No TBDs.
- **Type consistency:** `PromptSpec`/`definePrompt`/`PromptStrategy`, `EMAIL_INBOX_ID`,
  `EMAIL_INBOX_AGENTS`, `ROLES`, `reset` edge + `'reset'` resolution, `resetWorkflow`/`resetAll`,
  `resetOnStart` — names consistent across units.
