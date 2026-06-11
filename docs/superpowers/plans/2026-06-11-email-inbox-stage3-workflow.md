# Email-inbox Stage 3 — the Workflow Itself Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assemble the email-inbox workflow from the Stage-1 `gmail-viewer` integration + the Stage-2 framework capabilities: a singleton **sorter** that reads unread mail and **machine-dispatches** children, a **reply** agent (one per email, drafts a Gmail draft for approval), and three **batch** agents (reader / spam / important) that propose per-row Gmail actions (mark-read / trash / star / keep) through ONE batch gate the human edits and approves. All Gmail mutations are server-executed effects. Verified by browser E2E on recorded cassettes (the dev provider, claude-cli).

**Architecture:** A new self-contained workflow module `apps/inbox/workflows/email-inbox/{descriptor.ts, server.ts, client.tsx}` + one line in each of the three aggregators. Agent definitions use `defineAgent` (incl. the Stage-2 `dispatches` class); the sorter dispatches children via the Stage-2 RunObserver machine-dispatch path; the batch gate reuses the existing gate machinery (the approval-tool args ARE the editable form); the batch effect groups rows and calls `gmail-viewer/modify`; reply reuses `gmail-basic/create-draft`. Cards (SortSummaryCard, EmailBatchCard, plus a small reply card) are USERLAND, built in this workflow's `client.tsx` on the existing render/HITL spec mechanism.

**Tech Stack:** TypeScript (strict), zod v3, the claude-cli provider (dev), the existing pipeline spine (`@platform/server`), Hono, vitest, Playwright-MCP for browser E2E, `DEV_RECORD_REPLAY` cassettes. yarn-classic, NO build step.

**Branch:** continue on `feat/gmail-viewer` (the whole email-inbox track shares it; Stages 1–2 are here, unmerged). Verify `git rev-parse --abbrev-ref HEAD` → `feat/gmail-viewer` before starting.

**SCOPE DECISION (read first):** This stage builds and browser-verifies the workflow on the **claude-cli provider** (the dev/demo path; the spec §6 stage-3 DoD is "browser E2E on recorded cassettes", which is claude-cli). The **Mastra provider's email-inbox support is DEFERRED to an explicit sub-step (Stage 3b, described at the end)** because the current Mastra runner (`apps/inbox/server/mastra/runner.ts`) is hardcoded to the lead-inbox reply shape (`buildPrompt` decodes `HandoffPayloadSchema`; `ALL_TOOLS` is a fixed 4-tool map) and generalizing it to the sorter / batch / dispatch shapes is a meaningful chunk that the demo/eval path does not need (DEMO=1 uses the MOCK provider, dev uses claude-cli). The conformance suite already proves the contract for both providers. Do NOT try to make email-inbox run on Mastra in this stage — flag it and move on.

---

## CONTEXT FOR A FRESH AGENT (read before Task 1)

### What this is

An open-source framework for agent automations. The **email-inbox workflow** is a new flagship demo built before the packaging tail to stress-test the framework as a real consumer. Spec: `docs/superpowers/specs/2026-06-11-email-inbox-workflow-design.md` (read §3, §4, §5, §6). Stages 1 (the `gmail-viewer` integration) and 2 (the core/server capabilities) are BUILT on this branch — see `HANDOFF.md` "🆕 ACTIVE TRACK" for their as-built notes.

### The flow (spec §1)

```
EMAIL SORTER (input, singleton, maxInstances 1)
  reads unread emails (last 24h) via list_unread, classifies each, MACHINE-DISPATCHES children:
    ├─→ reply      one child PER email needing a reply; reads the body via get_email, drafts a
    │              reply, saveDraft gate → human approves → SERVER creates the Gmail draft
    ├─→ reader     ONE child for the "informational" batch — proposes mark-all-read; per-row
    │              overrides (trash / star / keep) in the card; one applyActions gate
    ├─→ spam       ONE child for suspected spam — proposes trash-all, same per-row overrides
    └─→ important  ONE child for important mail — proposes star-all, same per-row overrides
```

Machine dispatch is allowed (the sorter creates child work items autonomously, visible in the pipeline); a machine ACTION is never allowed (every Gmail mutation is a server-executed effect behind a human-approved gate) — invariants I2/I9.

### The locked foundation (run `check-foundation` if unsure)

`docs/PHILOSOPHY.md` + `docs/ARCHITECTURE.md` §0 (I1–I15). This stage must keep: **I2/I9** (the model proposes; the server executes effects; the sorter dispatches but never acts); **I15** (every allow-listed tool classified — the boot classifier in `apps/inbox/server/agent-checks.ts` refuses to boot on an unclassified tool; `dispatches` is now a legal class). NO foundation-doc edits expected this stage.

### Conventions that bind every task

- English only; Prettier (`semi:false`, single quotes, `printWidth:100`); ESLint green.
- NEVER `git add -A`/`.` — stage exact paths (the user edits docs in parallel).
- Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- TDD where there's logic to test (the effect grouping, the prompt decode, render-spec parsing); browser E2E is the vehicle for the running-app behavior (the repo's defining bug class is "only the browser catches it").
- Validation sweep from repo root: `yarn typecheck && yarn test && yarn lint`. `yarn format:check` is red on two pre-existing docs — keep YOUR files Prettier-clean (`npx prettier --check <files>`).
- **Before ANY browser work, invoke the `browser-verify` skill** (kills stale dev stacks, frees `:4000`/`:5173`, Playwright-MCP recovery). Always browser-verify before claiming a flow works.

### The seams you build ON (Stage 1 + 2 as-built — all confirmed present)

**`gmail-viewer` integration** (`@platform/integrations/gmail-viewer/*`):
- `listUnread({ sinceHours? })` → `ReadResult<{ emails: EmailRef[] }>`, `EmailRef = { messageId, threadId, from, subject, date, snippet }` (capped 25, metadata only, no bodies).
- `getEmail({ messageId })` → `ReadResult<{ messageId, threadId, from, subject, body }>`.
- `markRead({ messageIds }) / trash({...}) / star({...})` (`modify.mjs`) → `BatchActionResult` (`{ done, failed:[{messageId,error}] } | { error }`), best-effort.
- `checkCredentials()` → `HealthCheck`. Read-only MCP wrapper (`gmail-viewer/index.mjs`) exposes ONLY `list_unread` + `get_email`.

**`gmail-basic`:** `createDraft({ threadId, body })` → `{ ok, draftId } | { error }` (the reply effect).

**Stage-2 capabilities:**
- `defineAgent.dispatches: string[]` (⊆ `tools`) — the machine-dispatch tool class. Boot classifier (`agent-checks.ts`) accepts it.
- `defineWorkflow.prompt?: string` + `composeInstructions(workflowPrompt, agentInstructions)` (core) — the workflow-level prompt. **The claude-cli wiring of this is THIS stage's job** (Stage 2 shipped the helper + the Mastra threading only): the email-inbox `server.ts` builds each agent's PromptStrategy from `composeInstructions(emailInbox.prompt, agent.instructions)`.
- RunObserver machine dispatch: when the model calls a `dispatches` tool, the observer parses `{ to, ...payload }`, validates `to ∈ handoffs`, and dispatches a CHILD work item with `payload` (the tool args minus `to`) and `origin:'agent'`. A bad target → a trace warning, never a crash. **So the sorter's dispatch tool args shape IS the child's work-item payload.**
- `ServerBinding.health?: { name, check }[]` — credential checks surfaced on the board (F3). The greyed-out badge renders in Stage 4; this stage just declares the checks.
- Activity feed (F4), singleton 409 guard (F6), `POST /api/cancel-all` — all server-side, no work needed here (the sorter is `maxInstances:1` so F6 already guards a double START).

### How existing workflow modules are shaped (COPY these patterns)

- **`apps/inbox/workflows/lead-inbox/descriptor.ts`** — `defineAgent(...)` per agent + `defineWorkflow({ id, label, iconName, agents:[{agent,role}], entryAgentId, inputs })`. `role:'input'` = user-startable + cross-workflow target; `role:'worker'` = handoff-only.
- **`apps/inbox/workflows/lead-inbox/server.ts`** — `export const leadInboxServer = (origin: string): ServerBinding[] => [ { agentId, prompts: createXPrompts(agent.instructions, origin), allowedTools: ['mcp__inbox__renderVerdict', 'mcp__gmail__get_latest_email'], effects?: { saveDraft: (form) => createDraft(...) } }, ... ]`. The `allowedTools` are the FULLY-QUALIFIED MCP names (`mcp__<server>__<tool>`). The `effects` map is keyed by the approval tool's BARE name; the function receives the approved/edited `form` and returns the `executedResult`.
- **`apps/inbox/workflows/lead-inbox/client.tsx`** — `export const leadInboxMeta: Record<string, AgentMeta>`, `leadInboxRenders: RenderSpec[]` (one per render tool: `{ toolName, parameters: zodSchema, render: ({parameters}, deliver) => <Card/> }`), `leadInboxHitl: HitlSpec[]` (one per approval tool: `{ toolName, parameters, render: ({form, approve, reject}) => <ApprovalDialog .../> }`). Cards are imported from `apps/inbox/client/src/components/`.
- **Prompts** (`apps/inbox/agents/*.prompts.ts`) — a factory returning a `PromptStrategy`: `{ buildFirst(input): string, buildResume?(args, executedResult?): string | null }`. `buildFirst` decodes the handoff payload from `input` via `decodeHandoff(input, Schema)` and returns the system prompt text; `buildResume` builds the post-approval prompt (it reads `executedResult` — e.g. `draftId`). Look at `reply.prompts.ts` for the canonical shape.
- **MCP servers** are wired in `apps/inbox/server/claude-spawn.ts` (`mcpServers: { inbox, gmail, github }`; the gmail one is `require.resolve('@platform/integrations/gmail-basic')`). The per-agent allow-list (`allowedTools`) is the hard boundary.
- **Three aggregators** (add ONE line each): `apps/inbox/workflows/index.ts` (`workflowDescriptors`), `apps/inbox/server/workflows.ts` (`workflowServers`), `apps/inbox/client/src/workflows.ts` (`workflowsConfig` — merges meta/renders/hitl).
- **Inbox MCP** (`apps/inbox/mcp/inbox-tools.mjs`) — the stdio server exposing our render/propose tools (`renderVerdict`, `renderLead`, `saveDraft`, …) to claude. New render/propose/dispatch tools the model must CALL (renderSort, route_emails, applyActions) are added HERE so claude can call them.

### The dev verification loop

`DEV_RECORD_REPLAY=record yarn dev` runs real `claude` once and writes a cassette per `wf__agent` under `apps/inbox/.cassettes/` (gitignored, REAL data — never commit; the `guard-cassette-share` hook blocks it). `DEV_RECORD_REPLAY=1 yarn dev` replays instantly. The browser E2E runs against replays after one real recording. Postgres is up via `docker compose up -d postgres` (wired into `predev`).

---

## TASK GROUP A — scaffolding: descriptor, payload schemas, aggregator wiring

### Task A1: payload schemas + the descriptor (TDD on the schemas)

**Files:**
- Create: `apps/inbox/workflows/email-inbox/descriptor.ts`
- Test: `apps/inbox/workflows/email-inbox/descriptor.test.ts`

The sorter dispatches two payload shapes: a single email to `reply`, and a batch to `reader`/`spam`/`important`. Define zod schemas for both (used by the prompts' `decodeHandoff` and as the workflow's published `inputs` shape if any).

- [ ] **Step 1: Write the failing test** — assert the descriptor's structure (agents, roles, entry, dispatches classification) and the payload schemas parse the expected shapes:

```ts
import { describe, it, expect } from 'vitest'
import { emailInbox, sorterAgent, replyAgent, EmailRefSchema, EmailBatchSchema } from './descriptor.js'

describe('email-inbox descriptor', () => {
  it('sorter is a singleton input agent that dispatches route_emails to the four workers', () => {
    expect(sorterAgent.dispatches).toEqual(['route_emails'])
    expect(sorterAgent.maxInstances).toBe(1)
    expect(sorterAgent.handoffs).toEqual(['reply', 'reader', 'spam', 'important'])
    expect(emailInbox.entryAgentId).toBe('sorter')
    expect(emailInbox.agents.find((a) => a.agent.id === 'sorter')?.role).toBe('input')
  })

  it('reply reads the body itself (get_email is readonly, not a handoff summary)', () => {
    expect(replyAgent.readonly).toContain('get_email')
    expect(replyAgent.approvals).toEqual(['saveDraft'])
    expect(replyAgent.effects).toEqual(['saveDraft'])
  })

  it('payload schemas parse the dispatch shapes', () => {
    const ref = { messageId: 'm1', threadId: 't1', from: 'a@b.c', subject: 's', date: 'd', snippet: 'x' }
    expect(EmailRefSchema.parse(ref)).toEqual(ref)
    expect(EmailBatchSchema.parse({ emails: [ref] }).emails).toHaveLength(1)
  })

  it('has a workflow-level prompt', () => {
    expect(typeof emailInbox.prompt).toBe('string')
    expect(emailInbox.prompt!.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run it, confirm fail** — `yarn vitest run apps/inbox/workflows/email-inbox/descriptor.test.ts`.

- [ ] **Step 3: Write `descriptor.ts`**

```ts
import { z } from 'zod'
import { defineAgent, defineWorkflow } from '@platform/core'

// The dispatch payload shapes (= the route_emails tool args minus `to`). EmailRef mirrors the
// gmail-viewer EmailRef; defined here as the workflow's own contract (userland), not imported
// from the integration's .d.ts (that is a type, not a runtime zod schema).
export const EmailRefSchema = z.object({
  messageId: z.string(),
  threadId: z.string(),
  from: z.string(),
  subject: z.string(),
  date: z.string(),
  snippet: z.string(),
})
export type EmailRef = z.infer<typeof EmailRefSchema>

// A batch worker (reader/spam/important) receives a list of emails.
export const EmailBatchSchema = z.object({ emails: z.array(EmailRefSchema) })

// A reply worker receives ONE email (it fetches the body itself via get_email).
export const ReplyPayloadSchema = z.object({ email: EmailRefSchema })

export const sorterAgent = defineAgent({
  id: 'sorter',
  name: 'EMAIL SORTER',
  provider: 'claude-cli',
  instructions:
    'Read the unread inbox emails of the last 24 hours and sort each one. For an email that needs a personal reply, dispatch it to the reply agent. Group the rest into: informational (reader), suspected spam (spam), and important-but-no-reply (important). Then surface a short summary.',
  // CONVENTION (matches lead-inbox qualifier): read tools go in `readonly` ONLY, never in `tools`.
  // `tools` holds the surface/render/propose/approval/dispatch tools. The Mastra factory derives
  // render-vs-read from membership in `tools`, so a read tool in `tools` would be misclassified.
  tools: ['route_emails', 'renderSort'],
  readonly: ['list_unread'],
  dispatches: ['route_emails'],
  renders: { renderSort: 'SortSummaryCard' },
  handoffs: ['reply', 'reader', 'spam', 'important'],
  maxInstances: 1,
})

export const replyAgent = defineAgent({
  id: 'reply',
  name: 'REPLY AGENT',
  provider: 'claude-cli',
  instructions:
    'You were handed one email that needs a reply. Read its full body, draft a short reply, and ask the human before saving it as a Gmail draft.',
  tools: ['renderLead', 'saveDraft'],
  readonly: ['get_email'],
  approvals: ['saveDraft'],
  effects: ['saveDraft'],
  renders: { renderLead: 'LeadCard', saveDraft: 'ApprovalDialog' },
})

// reader / spam / important share the SAME shape (one batch gate proposing per-row actions),
// differing only in the proposed default action — that is the prompt's job, not the passport's.
function batchAgent(id: string, name: string): ReturnType<typeof defineAgent> {
  return defineAgent({
    id,
    name,
    provider: 'claude-cli',
    instructions:
      'You were handed a batch of emails. Propose a per-row action for each (read / trash / star / keep) and ask the human to apply them. The human may change any row before approving.',
    tools: ['applyActions'],
    approvals: ['applyActions'],
    effects: ['applyActions'],
    renders: { applyActions: 'EmailBatchCard' },
    handoffs: ['reply'], // a row can be re-routed to a reply
  })
}

export const readerAgent = batchAgent('reader', 'READER')
export const spamAgent = batchAgent('spam', 'SPAM')
export const importantAgent = batchAgent('important', 'IMPORTANT')

export const emailInbox = defineWorkflow({
  id: 'email-inbox',
  label: 'Email inbox',
  iconName: 'inbox',
  prompt:
    'You are part of an email-inbox automation. Be concise and businesslike. NEVER narrate tool plumbing (no "let me load the tools", no schema talk). The human approves every Gmail action — you only propose. Never send email; drafts only.',
  agents: [
    { agent: sorterAgent, role: 'input' },
    { agent: replyAgent, role: 'worker' },
    { agent: readerAgent, role: 'worker' },
    { agent: spamAgent, role: 'worker' },
    { agent: importantAgent, role: 'worker' },
  ],
  entryAgentId: sorterAgent.id,
  inputs: [], // no cross-workflow input contract for the beta (the sorter is human-started)
})

export const emailInboxAgents = [sorterAgent, replyAgent, readerAgent, spamAgent, importantAgent]
```

> Note on `reply.tools`: `renderLead` is reused as the "show the email" card (it already exists as a render tool + LeadCard). If you prefer a dedicated card, add a `renderEmail` render tool instead — but reusing `renderLead` keeps the cassette/MCP surface smaller; the plan assumes reuse. `saveDraft` + `ApprovalDialog` are reused verbatim from lead-inbox.

- [ ] **Step 4: Run the test** → PASS. `yarn typecheck`.

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/workflows/email-inbox/descriptor.ts apps/inbox/workflows/email-inbox/descriptor.test.ts
git commit -m "feat(email-inbox): descriptor — sorter + reply + reader/spam/important + payload schemas (A1)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task A2: register the descriptor in the descriptor aggregator

**Files:** Modify `apps/inbox/workflows/index.ts`

- [ ] **Step 1:** add the import + array entry:

```ts
import { emailInbox } from './email-inbox/descriptor.js'
// …
export const workflowDescriptors: WorkflowDescriptor[] = [leadInbox, githubTriage, emailInbox]
```

- [ ] **Step 2:** `yarn typecheck` (the server/client aggregators don't yet reference email-inbox server/client — those are Tasks C/E; descriptor-only registration is safe). Commit.

```bash
git add apps/inbox/workflows/index.ts
git commit -m "feat(email-inbox): register descriptor in the workflow aggregator (A2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK GROUP B — the batch effect (server-executed Gmail actions)

The effect runs on gate approval. It is pure server logic — TDD it fully BEFORE wiring prompts.

### Task B1: `applyEmailActions` effect (TDD)

**Files:**
- Create: `apps/inbox/workflows/email-inbox/apply-actions.ts`
- Test: `apps/inbox/workflows/email-inbox/apply-actions.test.ts`

The gate `form` is `{ items: [{ messageId, action }] }`, `action ∈ 'read' | 'trash' | 'star' | 'keep'`. The effect groups by action, calls the gmail-viewer batch mutations once per group (`keep` is a no-op), and returns a summary `{ applied: number, failed: { messageId, error }[], byAction: Record<string,number> }`. Best-effort: a per-row failure from `modify` is collected, never thrown. The gmail-viewer functions are INJECTED (`deps`) so the test passes fakes (no network).

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { applyEmailActions } from './apply-actions.js'

function fakes() {
  const calls: Record<string, string[]> = { read: [], trash: [], star: [] }
  return {
    calls,
    deps: {
      markRead: async ({ messageIds }: { messageIds: string[] }) => {
        calls.read.push(...messageIds)
        return { done: messageIds, failed: [] }
      },
      trash: async ({ messageIds }: { messageIds: string[] }) => {
        calls.trash.push(...messageIds)
        return { done: messageIds, failed: [] }
      },
      star: async ({ messageIds }: { messageIds: string[] }) => {
        calls.star.push(...messageIds)
        return { done: messageIds, failed: [] }
      },
    },
  }
}

describe('applyEmailActions', () => {
  it('groups rows by action and calls the matching batch mutation once each', async () => {
    const { calls, deps } = fakes()
    const form = {
      items: [
        { messageId: 'a', action: 'read' },
        { messageId: 'b', action: 'trash' },
        { messageId: 'c', action: 'read' },
        { messageId: 'd', action: 'star' },
        { messageId: 'e', action: 'keep' },
      ],
    }
    const res = await applyEmailActions(form, deps)
    expect(calls.read).toEqual(['a', 'c'])
    expect(calls.trash).toEqual(['b'])
    expect(calls.star).toEqual(['d'])
    expect(res.applied).toBe(4) // keep is not an action
    expect(res.failed).toEqual([])
    expect(res.byAction).toEqual({ read: 2, trash: 1, star: 1 })
  })

  it('is best-effort: a failed row is collected, the rest still applied', async () => {
    const deps = {
      markRead: async ({ messageIds }: { messageIds: string[] }) => ({
        done: messageIds.filter((m) => m !== 'bad'),
        failed: messageIds.filter((m) => m === 'bad').map((m) => ({ messageId: m, error: 'boom' })),
      }),
      trash: async ({ messageIds }: { messageIds: string[] }) => ({ done: messageIds, failed: [] }),
      star: async ({ messageIds }: { messageIds: string[] }) => ({ done: messageIds, failed: [] }),
    }
    const res = await applyEmailActions(
      { items: [{ messageId: 'a', action: 'read' }, { messageId: 'bad', action: 'read' }] },
      deps
    )
    expect(res.applied).toBe(1)
    expect(res.failed).toEqual([{ messageId: 'bad', error: 'boom' }])
  })

  it('returns a wholesale error if a batch mutation reports one (client unavailable)', async () => {
    const deps = {
      markRead: async () => ({ error: 'no creds' }),
      trash: async () => ({ done: [], failed: [] }),
      star: async () => ({ done: [], failed: [] }),
    }
    const res = await applyEmailActions({ items: [{ messageId: 'a', action: 'read' }] }, deps)
    expect(res.error).toMatch(/no creds/)
  })
})
```

- [ ] **Step 2: Run, confirm fail.**

- [ ] **Step 3: Implement `apply-actions.ts`**

```ts
import { markRead as realMarkRead, trash as realTrash, star as realStar } from '@platform/integrations/gmail-viewer/modify'

type Action = 'read' | 'trash' | 'star' | 'keep'
type Row = { messageId: string; action: Action }
type BatchFn = (args: { messageIds: string[] }) => Promise<
  { done: string[]; failed: { messageId: string; error: string }[] } | { error: string }
>
export interface ApplyDeps {
  markRead?: BatchFn
  trash?: BatchFn
  star?: BatchFn
}
export interface ApplyResult {
  applied: number
  failed: { messageId: string; error: string }[]
  byAction: Record<string, number>
  error?: string
}

// The server-executed effect for the batch gate. The approved/edited `form` carries the per-row
// actions; group them, run one batch mutation per action group (keep = no-op), collect per-row
// failures (best-effort). A wholesale `{ error }` from any group aborts with that error (the gate
// resolve route fails the work item — never a false "applied"). gmail functions are injected.
export async function applyEmailActions(
  form: { items?: Row[] } | Record<string, unknown>,
  deps: ApplyDeps = {}
): Promise<ApplyResult> {
  const markRead = deps.markRead ?? realMarkRead
  const trash = deps.trash ?? realTrash
  const star = deps.star ?? realStar
  const items = Array.isArray((form as { items?: Row[] }).items)
    ? ((form as { items: Row[] }).items)
    : []

  const groups: Record<'read' | 'trash' | 'star', string[]> = { read: [], trash: [], star: [] }
  for (const row of items) {
    if (row.action === 'read') groups.read.push(row.messageId)
    else if (row.action === 'trash') groups.trash.push(row.messageId)
    else if (row.action === 'star') groups.star.push(row.messageId)
    // 'keep' → no-op
  }

  const failed: { messageId: string; error: string }[] = []
  let applied = 0
  const byAction: Record<string, number> = {}
  const run = async (fn: BatchFn, ids: string[], label: string): Promise<string | undefined> => {
    if (ids.length === 0) return undefined
    const r = await fn({ messageIds: ids })
    if ('error' in r) return r.error
    applied += r.done.length
    failed.push(...r.failed)
    byAction[label] = r.done.length
    return undefined
  }

  const err =
    (await run(markRead, groups.read, 'read')) ??
    (await run(trash, groups.trash, 'trash')) ??
    (await run(star, groups.star, 'star'))
  if (err) return { applied, failed, byAction, error: err }
  return { applied, failed, byAction }
}
```

- [ ] **Step 4: Run the test** → PASS. `yarn typecheck`.

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/workflows/email-inbox/apply-actions.ts apps/inbox/workflows/email-inbox/apply-actions.test.ts
git commit -m "feat(email-inbox): applyEmailActions batch effect (group rows, best-effort gmail mutations) (B1)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK GROUP C — prompts (claude-cli PromptStrategy) + server bindings

### Task C1: agent prompt strategies

**Files:**
- Create: `apps/inbox/workflows/email-inbox/prompts.ts`
- Test: `apps/inbox/workflows/email-inbox/prompts.test.ts`

Three prompt builders returning `PromptStrategy` (`{ buildFirst, buildResume? }`):
- **sorter** — first turn: instruct it to call `list_unread`, then call `route_emails` ONCE per destination group (`{ to:'reply', email:{…} }` per reply email; `{ to:'reader'|'spam'|'important', emails:[…] }` for each batch), then call `renderSort` with a short summary. No handoff payload (it is the input agent, started empty).
- **reply** — first turn: decode the handed `{ email }` (via `decodeHandoff(input, ReplyPayloadSchema)`); instruct: call `get_email({ messageId })` to read the body, draft a short reply, call `renderLead({ from, subject, summary })` to surface it, then call `saveDraft({ threadId, body })` to ask for approval. `buildResume(args, executedResult)` → confirm the draft was saved (reads `executedResult.draftId`), reusing the lead-inbox reply resume text.
- **batch** (one factory, parameterized by the default action + label) — decode the handed `{ emails }`; instruct: call `applyActions({ items: [{ messageId, from, subject, action }] })` with `action` defaulted to the agent's default (`read` for reader, `trash` for spam, `star` for important) for every email, to ask the human. `buildResume(args, executedResult)` → summarize `executedResult` (`applied`/`failed`/`byAction`).

> The prompt TEXT is iterative — you will tune it against real `claude` runs in Task F. Write a first cut that follows the lead-inbox prompt discipline VERBATIM where it applies ("Calling saveDraft IS how you ask the human… do NOT narrate tools… never send"). The unit test asserts STRUCTURE, not wording.

- [ ] **Step 1: Write the failing test** (structure-level — decode + key instructions present):

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import type { RunAgentInput } from '@ag-ui/client'
import { encodeHandoff } from '@platform/core'
import { createSorterPrompts, createReplyPrompts, createBatchPrompts } from './prompts.js'

const inputWith = (payload: unknown): RunAgentInput =>
  ({ messages: payload ? [encodeHandoff(payload)] : [], threadId: 't', runId: 'r', state: {}, tools: [], context: [], forwardedProps: {} }) as RunAgentInput

describe('email-inbox prompts', () => {
  it('sorter instructs list_unread → route_emails → renderSort', () => {
    const p = createSorterPrompts('SORTER INSTR')
    const t = p.buildFirst(inputWith(null))
    expect(t).toContain('SORTER INSTR')
    expect(t).toMatch(/list_unread/)
    expect(t).toMatch(/route_emails/)
    expect(t).toMatch(/renderSort/)
  })

  it('reply decodes the handed email and instructs get_email → renderLead → saveDraft', () => {
    const p = createReplyPrompts('REPLY INSTR')
    const email = { messageId: 'm1', threadId: 't1', from: 'a@b.c', subject: 'Hi', date: 'd', snippet: 'sn' }
    const t = p.buildFirst(inputWith({ email }))
    expect(t).toMatch(/get_email/)
    expect(t).toMatch(/m1/)
    expect(t).toMatch(/saveDraft/)
    const resume = p.buildResume!({ threadId: 't1', body: 'x' }, { draftId: 'd-9' })
    expect(resume).toMatch(/d-9|saved/i)
  })

  it('batch defaults each row to the agent default action and proposes applyActions', () => {
    const p = createBatchPrompts('READER INSTR', 'read')
    const emails = [{ messageId: 'm1', threadId: 't1', from: 'a', subject: 's', date: 'd', snippet: 'x' }]
    const t = p.buildFirst(inputWith({ emails }))
    expect(t).toMatch(/applyActions/)
    expect(t).toMatch(/read/)
    const resume = p.buildResume!({ items: [] }, { applied: 3, failed: [], byAction: { read: 3 } })
    expect(resume).toMatch(/3/)
  })
})
```

- [ ] **Step 2: Run, confirm fail. Step 3: Implement `prompts.ts`** (follow `reply.prompts.ts` shape; use `decodeHandoff(input, ReplyPayloadSchema)` / `EmailBatchSchema`; build the instruction text per the bullets above). Keep the lead-inbox anti-narration discipline. **Step 4: Run → PASS. Step 5: Commit.**

```bash
git add apps/inbox/workflows/email-inbox/prompts.ts apps/inbox/workflows/email-inbox/prompts.test.ts
git commit -m "feat(email-inbox): agent prompt strategies (sorter/reply/batch) (C1)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task C2: server bindings (allowedTools, effects, health, workflow-prompt composition)

**Files:**
- Create: `apps/inbox/workflows/email-inbox/server.ts`
- Modify: `apps/inbox/server/workflows.ts` (register)

This is where **F1's claude-cli path is finally wired**: build each PromptStrategy from `composeInstructions(emailInbox.prompt, agent.instructions)`.

- [ ] **Step 1: Write `server.ts`**

```ts
import { composeInstructions } from '@platform/core'
import { createDraft } from '@platform/integrations/gmail-basic/create-draft'
import { checkCredentials } from '@platform/integrations/gmail-viewer/check-credentials'
import type { ServerBinding } from '../server-binding.js'
import {
  emailInbox,
  sorterAgent,
  replyAgent,
  readerAgent,
  spamAgent,
  importantAgent,
} from './descriptor.js'
import { createSorterPrompts, createReplyPrompts, createBatchPrompts } from './prompts.js'
import { applyEmailActions } from './apply-actions.js'

const compose = (instructions: string): string => composeInstructions(emailInbox.prompt, instructions)
const gmailHealth = [{ name: 'gmail', check: checkCredentials }]

export const emailInboxServer = (origin: string): ServerBinding[] => [
  {
    agentId: sorterAgent.id,
    prompts: createSorterPrompts(compose(sorterAgent.instructions), origin),
    // list_unread (gmail-viewer MCP) + renderSort/route_emails (inbox MCP). route_emails is a
    // dispatch tool — the model CALLS it; the server turns the call into a child (RunObserver F2).
    allowedTools: [
      'mcp__gmail-viewer__list_unread',
      'mcp__inbox__renderSort',
      'mcp__inbox__route_emails',
    ],
    health: gmailHealth,
  },
  {
    agentId: replyAgent.id,
    prompts: createReplyPrompts(compose(replyAgent.instructions)),
    allowedTools: [
      'mcp__gmail-viewer__get_email',
      'mcp__inbox__renderLead',
      'mcp__inbox__saveDraft',
    ],
    effects: {
      saveDraft: (form) =>
        createDraft({ threadId: String(form.threadId ?? ''), body: String(form.body ?? '') }),
    },
    health: gmailHealth,
  },
  ...[
    { agent: readerAgent, def: 'read' as const },
    { agent: spamAgent, def: 'trash' as const },
    { agent: importantAgent, def: 'star' as const },
  ].map(({ agent, def }) => ({
    agentId: agent.id,
    prompts: createBatchPrompts(compose(agent.instructions), def),
    allowedTools: ['mcp__inbox__applyActions'],
    effects: {
      applyActions: (form: Record<string, unknown>) => applyEmailActions(form),
    },
    health: gmailHealth,
  })),
]
```

> `createSorterPrompts(instructions, origin)` — the `origin` (workflow id) param matches the lead-inbox convention for handoff-emitting prompts; the sorter's prompt does NOT need to weave origin into render tools (it dispatches via `route_emails`, not a render-tool handoff), so `origin` may be unused — keep the param for signature parity or drop it if your `prompts.ts` doesn't use it. Be consistent with what you wrote in C1.

- [ ] **Step 2: Register** in `apps/inbox/server/workflows.ts`:

```ts
import { emailInbox } from '../workflows/email-inbox/descriptor.js'
import { emailInboxServer } from '../workflows/email-inbox/server.js'
// …add to the array:
{ descriptor: emailInbox, bindings: emailInboxServer },
```

- [ ] **Step 3:** `yarn typecheck && yarn lint`. The boot classifier (`agent-checks.ts`) will validate every bare tool name is classified — `list_unread`/`get_email` ∈ `readonly`, `route_emails` ∈ `dispatches`, `renderSort`/`renderLead` ∈ `renders`, `saveDraft`/`applyActions` ∈ `approvals`+`effects`. If it throws at boot, you misclassified — fix the descriptor.

- [ ] **Step 4: Commit**

```bash
git add apps/inbox/workflows/email-inbox/server.ts apps/inbox/server/workflows.ts
git commit -m "feat(email-inbox): server bindings — allow-lists, effects, health, workflow-prompt composition (C2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK GROUP D — MCP tools (so claude can call the new render/propose/dispatch tools)

### Task D1: add `renderSort`, `route_emails`, `applyActions` to the inbox MCP; wire the gmail-viewer MCP server

**Files:**
- Modify: `apps/inbox/mcp/inbox-tools.mjs`
- Modify: `apps/inbox/server/claude-spawn.ts`

- [ ] **Step 1: Read `apps/inbox/mcp/inbox-tools.mjs`** — it registers the existing render/propose tools (`renderVerdict`, `renderLead`, `saveDraft`, …) as stdio MCP tools whose handler just echoes the args (the SERVER fills the card / opens the gate from the args; the tool itself is a no-op surface). Add three tools following that exact pattern:
  - `renderSort` — inputSchema `{ summary: z.string(), counts: z.object({ reply: z.number(), reader: z.number(), spam: z.number(), important: z.number() }).partial() }` (or simpler `{ summary, counts }` passthrough). No-op echo.
  - `route_emails` — inputSchema `{ to: z.string(), email: z.object({...}).optional(), emails: z.array(z.object({...})).optional() }` (the sorter calls it; the SERVER's RunObserver turns the call into a child — the tool handler just echoes). No-op echo.
  - `applyActions` — inputSchema `{ items: z.array(z.object({ messageId: z.string(), from: z.string().optional(), subject: z.string().optional(), action: z.enum(['read','trash','star','keep']) })) }`. No-op echo (it is the approval tool — the SERVER opens the gate from the args and executes the effect on approval).

> IMPORTANT: these MCP tools must NOT perform any Gmail action — they are surfaces. The mutation happens ONLY in the server effect (`applyEmailActions`) after approval. `route_emails` performs no action either (RunObserver dispatches a child from the observed call). Keep the handlers pure echoes, like the existing render tools.

- [ ] **Step 2: Wire the gmail-viewer MCP server** in `claude-spawn.ts`: add `const GMAIL_VIEWER_SERVER = require.resolve('@platform/integrations/gmail-viewer')` and add `'gmail-viewer': { type: 'stdio', command: 'node', args: [GMAIL_VIEWER_SERVER] }` to the `mcpServers` map. (This exposes `list_unread` + `get_email` to claude under the `mcp__gmail-viewer__` prefix — matching the allow-list in C2.)

- [ ] **Step 3:** `yarn typecheck && yarn lint`. (The `.mjs` MCP files are not in the TS graph — eyeball them against the existing tool registrations.) Add/extend the inbox-tools unit test if one exists (`apps/inbox/mcp/*.test.mjs`) for the new tools' echo behavior; otherwise a manual check in Task F covers it.

- [ ] **Step 4: Commit**

```bash
git add apps/inbox/mcp/inbox-tools.mjs apps/inbox/server/claude-spawn.ts
git commit -m "feat(email-inbox): inbox MCP renderSort/route_emails/applyActions + wire gmail-viewer MCP server (D1)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK GROUP E — cards (userland) + client wiring

Cards are USERLAND (built here, NOT in `@platform/react`). They follow the existing `RenderSpec`/`HitlSpec` pattern (see `lead-inbox/client.tsx`). The generic chrome/primitives are Stage 4 — for now the cards reuse the existing Smedja card classes like the lead-inbox cards do.

### Task E1: SortSummaryCard + EmailBatchCard components

**Files:**
- Create: `apps/inbox/client/src/components/SortSummaryCard.tsx`
- Create: `apps/inbox/client/src/components/EmailBatchCard.tsx`
- Test: `apps/inbox/client/src/EmailBatchCard.test.tsx` (the batch card has real interaction logic — test it)

- [ ] **Step 1: SortSummaryCard** — a presentational card: props `{ summary: string, counts?: { reply?, reader?, spam?, important? } }`, renders the summary + a small count row. Follow `VerdictCard`/`LeadCard` styling (head/kicker/badge/body). No interaction.

- [ ] **Step 2: EmailBatchCard (TDD the interaction)** — props `{ data: { items: { messageId, from, subject, action }[] }, onApprove: (editedForm) => void, onReject: () => void }`. Renders one row per email with the proposed `action` and a control to change it among `read|trash|star|keep` (a `<select>` is fine for the beta — the polished UI is Stage 4). Local state holds the edited rows; "Apply N actions" calls `onApprove({ items: <edited rows> })`; "Reject" calls `onReject()`. Write a failing test first: render with two rows, change one row's action via the select, click Apply, assert `onApprove` was called with the edited `items`.

```tsx
// EmailBatchCard.test.tsx sketch (vitest + @testing-library/react)
import { render, screen, fireEvent } from '@testing-library/react'
import { EmailBatchCard } from './components/EmailBatchCard'
it('emits the edited rows on approve', () => {
  const onApprove = vi.fn()
  render(
    <EmailBatchCard
      data={{ items: [
        { messageId: 'a', from: 'x', subject: 's1', action: 'read' },
        { messageId: 'b', from: 'y', subject: 's2', action: 'read' },
      ] }}
      onApprove={onApprove}
      onReject={() => {}}
    />
  )
  fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'trash' } })
  fireEvent.click(screen.getByRole('button', { name: /apply/i }))
  expect(onApprove).toHaveBeenCalledWith({
    items: [
      { messageId: 'a', from: 'x', subject: 's1', action: 'read' },
      { messageId: 'b', from: 'y', subject: 's2', action: 'trash' },
    ],
  })
})
```

- [ ] **Step 3:** implement both. Run the EmailBatchCard test → PASS. `yarn typecheck`.

- [ ] **Step 4: Commit**

```bash
git add apps/inbox/client/src/components/SortSummaryCard.tsx apps/inbox/client/src/components/EmailBatchCard.tsx apps/inbox/client/src/EmailBatchCard.test.tsx
git commit -m "feat(email-inbox): SortSummaryCard + interactive EmailBatchCard (E1)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task E2: client render/HITL specs + meta; register in the client aggregator

**Files:**
- Create: `apps/inbox/workflows/email-inbox/client.tsx`
- Modify: `apps/inbox/client/src/workflows.ts`

- [ ] **Step 1: Write `client.tsx`** following `lead-inbox/client.tsx`:
  - `emailInboxMeta: Record<string, AgentMeta>` — subtitle/icon/intro for sorter, reply, reader, spam, important.
  - `emailInboxRenders: RenderSpec[]` — `renderSort` (→ `<SortSummaryCard/>`, parameters `{ summary, counts }`), and `renderLead` is ALREADY registered by lead-inbox (the client aggregator dedupes by toolName, so DON'T re-add it — but the reply agent reuses it, which is fine).
  - `emailInboxHitl: HitlSpec[]` — `applyActions` → `<EmailBatchCard data={{items}} onApprove={(f)=>approve(f)} onReject={()=>reject('no thanks')}/>`, parameters `{ items: z.array(...) }`. `saveDraft` is already registered by lead-inbox (dedup) — the reply agent reuses the `ApprovalDialog` HITL.

> Dedup caveat: `apps/inbox/client/src/workflows.ts` dedupes renders/hitl by `toolName`. `renderLead`/`saveDraft` come from lead-inbox; email-inbox reuses them by NOT re-declaring them. Only declare the NEW tools (`renderSort`, `applyActions`). If you DID re-declare `renderLead`, the lead-inbox one wins (first in the array) — harmless but avoid it.

- [ ] **Step 2: Register** in `apps/inbox/client/src/workflows.ts`:

```ts
import { emailInboxMeta, emailInboxRenders, emailInboxHitl } from '../../workflows/email-inbox/client'
// META spread: { ...leadInboxMeta, ...githubTriageMeta, ...emailInboxMeta }
// renderSpecs: byName([...leadInboxRenders, ...githubTriageRenders, ...emailInboxRenders])
// hitlSpecs: byName([...leadInboxHitl, ...emailInboxHitl])
```

- [ ] **Step 3:** `yarn typecheck && yarn test && yarn lint && yarn build` (the client build must stay green). Commit.

```bash
git add apps/inbox/workflows/email-inbox/client.tsx apps/inbox/client/src/workflows.ts
git commit -m "feat(email-inbox): render/HITL specs + meta; register in the client aggregator (E2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK GROUP F — record cassettes + browser E2E (the real proof)

This is where the workflow is proven. Invoke the **`browser-verify`** skill before any browser work (kill stale dev stacks, free ports, Playwright-MCP recovery). The repo's defining bug class is "only the browser catches it" — unit tests + typecheck pass while the app is broken.

### Task F1: record cassettes against real claude + real Gmail (read path)

- [ ] **Step 1:** ensure Postgres is up (`docker compose up -d postgres`) and the DB is clean (`yarn workspace inbox db:reset` if leftovers). Confirm Gmail creds exist (`~/.gmail-mcp/`).

- [ ] **Step 2:** `DEV_RECORD_REPLAY=record yarn dev`, open `http://localhost:5173`, switch to the **Email inbox** workflow tab, START the sorter. Watch it: `list_unread` → several `route_emails` calls → children appear in the pipeline (reply instances + reader/spam/important) → `renderSort` summary. Let each child run to its gate (reply → saveDraft gate; batch → applyActions gate). This records `email-inbox__sorter`, `email-inbox__reply`, `email-inbox__reader`, etc. cassettes.

> Tune the prompts (Task C1) here if the sorter mis-groups, narrates tools, or calls `route_emails` with the wrong shape. Re-record (`=record`) after each prompt edit. The cassettes hold REAL email data — gitignored, NEVER commit (the `guard-cassette-share` hook blocks it).

- [ ] **Step 3:** confirm the recorded cassettes exist under `apps/inbox/.cassettes/email-inbox__*.jsonl`. Note in the task which scenarios recorded.

### Task F2: browser E2E on replay (every flow)

- [ ] Run `DEV_RECORD_REPLAY=1 yarn dev` and browser-verify EACH flow (drive with Playwright-MCP; `db:reset` between runs as needed). PASS criteria:
  1. **Sort + machine dispatch:** START sorter → the four child types appear nested under it in the pipeline (machine dispatch visible); the sorter shows "Delegating" (Stage-2 F7 is Stage 4 UI — if the label still says "Working", that's a Stage-4 item, note it, don't fix here) → `renderSort` summary card renders.
  2. **Batch approve with edited rows:** open a reader/spam/important child → EmailBatchCard shows the proposed rows → change ≥1 row's action → "Apply" → the gate resolves; verify in the DB the gate `resolved` with the edited `form`, the `action_ledger` has one row, the item `finished`; **verify via the Gmail API that the actions actually happened** (a message marked read / trashed / starred), then UNDO them (un-trash, un-star, restore UNREAD where feasible — this is real mail).
  3. **Reply approve → real draft:** open a reply child → it read the body (get_email) + drafted → edit the draft body in ApprovalDialog → Approve → **fetch the real Gmail draft by id → the edited body is present** → ledger one row, item finished. Delete the test draft.
  4. **Re-route a row to reply:** from a batch card, use the row's "Draft reply" (the `deliver` seam) → a reply child appears under the batch item, dedup by `gmail:<messageId>`.
  5. **Reject:** reject a batch gate → `finished`/`rejected`, zero ledger rows, no Gmail change.
  6. **Stop:** Stop a running child and the whole workflow (`POST /api/cancel-all` via the API or the Stage-4 button if present) → items `finished`/`cancelled`.
  7. **Singleton guard:** START the sorter while one is active → 409 (the START is rejected; UI disable is Stage 4 — verify the 409 via the network or a second START attempt).

- [ ] Record the PASS/FAIL of each in the task report. A FAIL is a STOP — fix and re-verify (don't claim done on unit tests alone).

### Task F3: full sweep + commit any fixes found by the browser

- [ ] `yarn typecheck && yarn test && yarn lint && yarn build` green. Commit any browser-surfaced fixes with clear messages (these are the bugs unit tests miss — the valuable ones).

---

## TASK GROUP G — wrap-up

### Task G1: foundation check + docs

- [ ] **check-foundation** on the whole stage diff. Assert explicitly: the sorter dispatches children but performs NO Gmail action (I2/I9); every Gmail mutation runs ONLY in the server effect after approval (the MCP `route_emails`/`applyActions` tools are pure echoes, not actions); every allow-listed tool is classified (I15 — the app booted, which proves it). A WARN is a STOP.

- [ ] **HANDOFF.md** — mark Stage 3 ✅ BUILT with an as-built note (agents, the batch gate = one `applyActions` approval whose args are the editable form, the `applyEmailActions` effect, machine dispatch via `route_emails`, F1's claude-cli path wired, MCP additions, cards). Note the browser E2E results. Note Stage 3b (Mastra) is deferred (below) and Stage 4 (UI chrome) is next.

- [ ] **`docs/AGENTIC.md`** if anything skill/contract-relevant emerged (likely not — no new skill).

- [ ] Commit docs (exact paths).

### Task G2: final whole-branch review

- [ ] Dispatch a final reviewer over the stage's commits: the workflow is coherent (descriptor ↔ server ↔ client ↔ MCP tools all agree on tool names + classification); the batch effect is best-effort and never falsely reports success; machine dispatch produces children only (I2); cassettes are NOT committed. Ready-to-merge or issues-first.

---

## SELF-REVIEW NOTES (applied)

- **Spec coverage:** §5 agents = Group A; §4 batch gate (form = approval-tool args, edited, one effect) = Groups B + E; machine dispatch (§1, §2 F2) = the sorter's `route_emails` + RunObserver (Stage 2, reused); reply draft = Group C/D/E reusing gmail-basic createDraft; workflow prompt (F1 claude-cli path) = Group C2; cards = Group E; verification = Group F.
- **Reuse over rebuild:** `renderLead` + `saveDraft` + `ApprovalDialog` are reused from lead-inbox (the client aggregator dedupes by tool name). The three batch agents share ONE descriptor factory, ONE card, ONE effect — differing only by the default action (the prompt's job).
- **No React chrome here:** SortSummaryCard/EmailBatchCard are workflow cards (userland), built on existing Smedja classes. The generic primitives/header/tabs/ActivityLog/badges are Stage 4.
- **Mastra deferred** (below) — flagged, not silently skipped.

---

## STAGE 3b (MANDATORY — the public demo runs on Mastra) — Mastra support for email-inbox

> **Decided 2026-06-11 by the user: Mastra is NOT optional — the public/beta demo ships on the Mastra production provider, so email-inbox MUST run on Mastra.** Stage 3b is its own plan (`docs/superpowers/plans/2026-06-11-email-inbox-stage3b-mastra.md`) and is the next step AFTER Stage 3. It is split out only because it depends on the Stage-3 workflow existing first (descriptor/prompts/cards), not because it is skippable. (The `DEMO=1` zero-cred path still uses the mock provider + synthetic cassettes for a key-less clone; that is a separate packaging concern and does not remove the Mastra requirement.)

The current Mastra runner (`apps/inbox/server/mastra/runner.ts`) is hardcoded to the lead-inbox reply shape. To run email-inbox on the production provider, generalize it:
- `buildPrompt` must dispatch per-agent (sorter / reply / batch) instead of always decoding `HandoffPayloadSchema` and emitting the reply prompt — ideally delegate to the same `PromptStrategy` builders from `prompts.ts` (today Mastra ignores `PromptStrategy` and rebuilds the prompt server-side; the cleanest fix is to thread the agent's `PromptStrategy.buildFirst`/`buildResume` into the runner so claude-cli and Mastra share ONE prompt source).
- `ALL_TOOLS` must include `list_unread`, `get_email`, `route_emails`, `renderSort`, `applyActions` as Mastra tools (reads call the gmail-viewer functions; render/propose/dispatch are no-op capture tools — `route_emails` must surface as a tool-call so the mastra-stream maps it to AG-UI `TOOL_CALL_*` and RunObserver dispatches the child, exactly like claude-cli).
- The gate suspend already keys on the approval tool — `applyActions` works as the approval; verify the batch form (`{items:[...]}`) flows through `proposedArtifact`.
- DoD: the conformance suite already passes; add a live Mastra E2E (`PROVIDER=mastra`, `ANTHROPIC_API_KEY`) of sort→dispatch→batch approve→real Gmail action + reply approve→real draft, mirroring the beta step-5 Mastra E2E.

**Why deferred:** the demo/eval path is claude-cli (dev) + mock (DEMO=1 packaging); Mastra email-inbox is needed only for a real production deploy of this flagship, which is post-beta-demo. Surface it to the user before the packaging tail so they can choose to pull it forward.

## Subsequent stages (unchanged from the Stage-2 plan's map)

- **Stage 4 — React/UI chrome:** primitives kit, global header (Chrome-style tabs + Stop-all + activity toggle), the F3 health badge (greyed-out agent + disabled START reading `board.agentHealth`), F6 START-disable, F7 pipeline "Delegating"/"Done" states, the ActivityLog panel (reads `/api/activity` + SSE). Browser-verify every flow through the new chrome.
- **Stage 5 — polish + full-scenario E2E:** fresh cassette set; HANDOFF/AGENTIC/CLAUDE.md gotchas; reword the HANDOFF "draft-only is a product law" line (the `draft-only-is-integration-scoped` decision).
- **Packaging tail (7c):** bearer-token auth; `DEMO=1` (PGlite + mock provider + SYNTHETIC cassettes + scanCassette CI gate); golden-set eval; README; LICENSE + `@platform/*` scope rename (ASK THE USER for both). Plus the two carried cleanups (`WorkerPool.resumeAcquire` log; `.env.local` auto-load).
