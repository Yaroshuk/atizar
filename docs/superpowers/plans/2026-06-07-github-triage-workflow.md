# GitHub triage workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second, read-only **GitHub triage** workflow beside the existing Lead inbox — a TRIAGE agent reads the user's tickets off the real Magma Board via `gh`, buckets them, and routes each to FEATURE / BUG-FIX / REPLY-DRAFT downstream agents — and generalize the desktop to N agents with a workflow switcher.

**Architecture:** A read-only stdio MCP adapter (`github-tools.mjs`) shells out to `gh` (the model has no Bash — Bash is in the spawn deny-list, so the adapter is the only GitHub path). Only TRIAGE touches GitHub; downstream agents work purely off a self-contained `TicketHandoffPayload` carried through the existing `handoff.ts` seam. The client `InboxView` is generalized into a `WorkflowView` that maps over a `workflows` registry, with each agent owning a child `AgentRuntime` that calls the CopilotKit hooks once (sidestepping rules-of-hooks).

**Tech Stack:** yarn-classic workspace; `@atizar/core` (zod, `@ag-ui/client`); MCP via `@modelcontextprotocol/sdk`; `gh` CLI; CopilotKit v2 + AG-UI; Vite/React/TS; Hono server; vitest.

**Spec:** `docs/superpowers/specs/2026-06-07-github-triage-workflow-design.md`

**Read-only is a hard constraint:** the adapter exposes NO write tool; no agent gets one. Never `gh issue comment` / `edit` / `item-edit` anywhere.

---

## File Structure

**Create:**
- `packages/core/src/handoff.ts` — extend with `TicketHandoffPayloadSchema` + generic `decodeHandoff` (modify).
- `apps/inbox/mcp/github-format.mjs` — pure `mapItems()` (parse/scope/trim `gh project item-list` JSON). No I/O.
- `apps/inbox/mcp/github-format.test.mjs` — unit tests for `mapItems`.
- `apps/inbox/mcp/github-tools.mjs` — read-only MCP adapter (shells `gh`; render-tool acks).
- `apps/inbox/agents/github.agent.ts` — `triageAgent`, `featureAgent`, `bugfixAgent`, `replyDraftAgent`, `githubAgents`.
- `apps/inbox/agents/triage.prompts.ts` + `.test.ts`
- `apps/inbox/agents/ticket.prompts.ts` + `.test.ts` — shared builder for feature/bugfix/reply-draft (decode ticket payload).
- `apps/inbox/client/src/buckets.ts` + `buckets.test.ts` — group tickets by Status, status order.
- `apps/inbox/client/src/components/TriageCard.tsx`
- `apps/inbox/client/src/components/TicketResultCard.tsx`
- `apps/inbox/client/src/components/ReplyDraftCard.tsx`
- `apps/inbox/client/src/components/WorkflowSwitcher.tsx`
- `apps/inbox/client/src/components/AgentRuntime.tsx` — per-agent hook owner.
- `apps/inbox/client/src/workflows.ts` — workflow registry + per-agent META.
- `apps/inbox/client/src/githubActions.tsx` — `useGithubActions` (render_triage/result/reply-draft).

**Modify:**
- `packages/core/src/handoff.test.ts` — add ticket-payload cases.
- `apps/inbox/agents/reply.prompts.ts:53` — pass `HandoffPayloadSchema` to `decodeHandoff`.
- `apps/inbox/server/claude-spawn.ts` — add `github` MCP server to mcp-config.
- `apps/inbox/server/index.ts` — wire 4 agents + allow-lists.
- `apps/inbox/client/src/InboxView.tsx` — generalize into N-agent `WorkflowView`.
- `apps/inbox/client/src/App.tsx` — keep a valid default agent (no behavior change needed).
- `apps/inbox/client/src/renderRegistry.tsx` — register the 3 new cards.
- `apps/inbox/client/src/components/Icon.tsx` — add `git` / `bug` / `wrench` icon names.

---

## Phase 1 — Core: generalize the handoff payload

### Task 1: `decodeHandoff` takes a schema; add `TicketHandoffPayloadSchema`

**Files:**
- Modify: `packages/core/src/handoff.ts`
- Modify: `packages/core/src/handoff.test.ts`
- Modify: `apps/inbox/agents/reply.prompts.ts:1-2,53`

- [ ] **Step 1: Add failing tests for the ticket payload + schema-parameterized decode**

Append to `packages/core/src/handoff.test.ts`:

```ts
import { TicketHandoffPayloadSchema, type TicketHandoffPayload } from './handoff.js'

const ticket: TicketHandoffPayload = {
  repo: 'matteappen/teachers-web',
  number: 5381,
  title: 'Instructions Tab 2.0 --> Launch tab',
  status: 'In progress',
  priority: 'High',
  body: 'Some description',
  lastComment: { author: 'someone', body: 'any update?' },
  recommendation: 'feature',
  url: 'https://github.com/matteappen/teachers-web/issues/5381',
}

describe('ticket handoff', () => {
  it('round-trips a ticket payload using its schema', () => {
    const seed = encodeHandoff(ticket)
    expect(decodeHandoff(input([seed]), TicketHandoffPayloadSchema)).toEqual(ticket)
  })

  it('allows a null lastComment', () => {
    const t = { ...ticket, lastComment: null }
    const seed = encodeHandoff(t)
    expect(decodeHandoff(input([seed]), TicketHandoffPayloadSchema)).toEqual(t)
  })

  it('returns null when a ticket seed is validated against the lead schema', () => {
    const seed = encodeHandoff(ticket)
    expect(decodeHandoff(input([seed]), HandoffPayloadSchema)).toBeNull()
  })
})
```

Also update the existing lead tests at the top of the file to pass the schema:
`decodeHandoff(input([seed]))` → `decodeHandoff(input([seed]), HandoffPayloadSchema)` (4 call sites: lines 17, 22, 26, 31), and import `HandoffPayloadSchema` on line 2:
```ts
import {
  encodeHandoff,
  decodeHandoff,
  HandoffPayloadSchema,
  type HandoffPayload,
} from './handoff.js'
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `yarn test packages/core/src/handoff.test.ts`
Expected: FAIL — `TicketHandoffPayloadSchema` is not exported; `decodeHandoff` ignores the 2nd arg / wrong arity.

- [ ] **Step 3: Generalize `handoff.ts`**

Replace the body of `packages/core/src/handoff.ts` (keep the top comment + `HandoffPayloadSchema`/`HandoffPayload`/`MARKER`):

```ts
export const TicketHandoffPayloadSchema = z.object({
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
  body: z.string(),
  lastComment: z.object({ author: z.string(), body: z.string() }).nullable(),
  recommendation: z.string(),
  url: z.string(),
})

export type TicketHandoffPayload = z.infer<typeof TicketHandoffPayloadSchema>

const MARKER = '[handoff]'

// Encode any payload as the seed user message the target run will carry. The shape
// is the caller's concern; decode validates it back with the matching schema.
export function encodeHandoff(payload: unknown): Message {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: `${MARKER} ${JSON.stringify(payload)}`,
  } as Message
}

// Decode the most recent handoff payload from a run input, validated against the
// passed schema, or null if there is no seed / it does not match the schema.
export function decodeHandoff<T>(input: RunAgentInput, schema: z.ZodType<T>): T | null {
  const messages = (input?.messages ?? []) as Message[]
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'user' && typeof m.content === 'string' && m.content.startsWith(MARKER)) {
      const parsed = schema.safeParse(JSON.parse(m.content.slice(MARKER.length).trim()))
      return parsed.success ? parsed.data : null
    }
  }
  return null
}
```
(Note: `JSON.parse` can throw on non-JSON — keep the malformed-input test green by wrapping the parse: change the `if` body to:
```ts
      try {
        const parsed = schema.safeParse(JSON.parse(m.content.slice(MARKER.length).trim()))
        return parsed.success ? parsed.data : null
      } catch {
        return null
      }
```
)

- [ ] **Step 4: Update the one existing caller**

`apps/inbox/agents/reply.prompts.ts` line 2 — import the schema:
```ts
import {
  decodeHandoff,
  HandoffPayloadSchema,
  type PromptStrategy,
  type HandoffPayload,
} from '@atizar/core'
```
Line 53 (`const h = decodeHandoff(input)`):
```ts
      const h = decodeHandoff(input, HandoffPayloadSchema)
```

- [ ] **Step 5: Run tests, verify pass**

Run: `yarn test packages/core/src/handoff.test.ts apps/inbox/agents/reply.prompts.test.ts && yarn typecheck`
Expected: PASS; tsc green.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/handoff.ts packages/core/src/handoff.test.ts apps/inbox/agents/reply.prompts.ts
git commit -m "feat(core): generalize decodeHandoff to a schema + add TicketHandoffPayload"
```

---

## Phase 2 — Read-only GitHub MCP adapter

### Task 2: Pure `mapItems` parser/scoper

**Files:**
- Create: `apps/inbox/mcp/github-format.mjs`
- Create: `apps/inbox/mcp/github-format.test.mjs`

- [ ] **Step 1: Write the failing test**

`apps/inbox/mcp/github-format.test.mjs`:
```js
import { describe, it, expect } from 'vitest'
import { mapItems } from './github-format.mjs'

const fixture = {
  items: [
    {
      assignees: ['Yaroshuk'],
      status: 'In progress',
      priority: 'High',
      content: {
        type: 'Issue',
        number: 5381,
        repository: 'matteappen/teachers-web',
        title: 'Launch tab',
        body: 'x'.repeat(3000),
        url: 'https://github.com/matteappen/teachers-web/issues/5381',
      },
    },
    {
      assignees: ['Yaroshuk'],
      status: 'Done',
      priority: null,
      content: { type: 'Issue', number: 1, repository: 'm/r', title: 'old', body: 'b', url: 'u' },
    },
    {
      assignees: ['someoneElse'],
      status: 'Todo',
      priority: 'Low',
      content: { type: 'Issue', number: 2, repository: 'm/r', title: 'theirs', body: 'b', url: 'u' },
    },
    {
      assignees: ['Yaroshuk'],
      status: 'Todo',
      priority: 'Low',
      content: { type: 'DraftIssue', title: 'draft, no number' },
    },
  ],
}

describe('mapItems', () => {
  const opts = { assignee: 'Yaroshuk', excludeStatuses: ['Done'], bodyMax: 1500 }

  it('keeps only the assignee’s real issues, excluding Done and draft (no number)', () => {
    const out = mapItems(fixture, opts)
    expect(out.map((t) => t.number)).toEqual([5381])
  })

  it('maps fields and truncates the body', () => {
    const [t] = mapItems(fixture, opts)
    expect(t).toMatchObject({
      repo: 'matteappen/teachers-web',
      number: 5381,
      title: 'Launch tab',
      status: 'In progress',
      priority: 'High',
      url: 'https://github.com/matteappen/teachers-web/issues/5381',
    })
    expect(t.body.length).toBe(1500)
  })

  it('defaults a null priority to empty string', () => {
    const out = mapItems(
      { items: [{ ...fixture.items[2], assignees: ['Yaroshuk'], priority: null }] },
      opts
    )
    expect(out[0].priority).toBe('')
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `yarn test apps/inbox/mcp/github-format.test.mjs`
Expected: FAIL — `mapItems` not found.

- [ ] **Step 3: Implement `github-format.mjs`**

```js
// Pure transforms over `gh project item-list --format json` output. No I/O, so it is
// unit-tested; the MCP adapter (github-tools.mjs) does the gh shelling + comment
// enrichment around this. Scopes to one assignee, drops draft items (no issue number)
// and excluded statuses, and trims bodies so the couriered handoff stays bounded.
export function mapItems(itemList, { assignee, excludeStatuses = [], bodyMax = 1500 }) {
  const exclude = new Set(excludeStatuses)
  const me = assignee.toLowerCase()
  return (itemList.items ?? [])
    .filter((it) => (it.assignees ?? []).some((a) => a.toLowerCase() === me))
    .filter((it) => !exclude.has(it.status))
    .filter((it) => typeof it.content?.number === 'number')
    .map((it) => ({
      repo: it.content.repository,
      number: it.content.number,
      title: it.content.title ?? '',
      status: it.status ?? '',
      priority: it.priority ?? '',
      body: (it.content.body ?? '').slice(0, bodyMax),
      url: it.content.url ?? '',
      lastComment: null,
      needsReply: false,
    }))
}
```

- [ ] **Step 4: Run, verify pass**

Run: `yarn test apps/inbox/mcp/github-format.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/mcp/github-format.mjs apps/inbox/mcp/github-format.test.mjs
git commit -m "feat(github): pure mapItems scoper for gh project item-list"
```

### Task 3: The read-only MCP adapter (`github-tools.mjs`)

**Files:**
- Create: `apps/inbox/mcp/github-tools.mjs`

Not unit-tested (it shells out to `gh`); verified live in Phase 6. Mirror `inbox-tools.mjs` + the real adapter style of `packages/integrations/src/gmail-basic/index.mjs` (lazy errors as `{error}` JSON, never crash the server).

- [ ] **Step 1: Implement the adapter**

```js
// stdio MCP server launched by the `claude` CLI (--mcp-config). READ-ONLY: it shells
// out to `gh` for the GitHub Projects v2 board + issue reads, and exposes render-tool
// acks for generative UI. It contains NO mutating gh call (no `comment`/`edit`/
// `item-edit`) — read-only by construction. The model has no Bash (deny-list in
// claude-spawn.ts), so this adapter is the ONLY path to GitHub.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mapItems } from './github-format.mjs'

const execFileP = promisify(execFile)

const PROJECT = process.env.GH_PROJECT || '8'
const OWNER = process.env.GH_OWNER || 'matteappen'
const ASSIGNEE = process.env.GH_ASSIGNEE || 'Yaroshuk'
const BODY_MAX = 1500
const COMMENT_MAX = 600

const gh = async (args) => {
  const { stdout } = await execFileP('gh', args, { maxBuffer: 32 * 1024 * 1024 })
  return stdout
}

const errText = (err) => err?.stderr?.toString?.() || err?.message || String(err)

// Read the last comment of one issue (author + trimmed body), or null.
async function lastComment(repo, number) {
  try {
    const out = await gh(['issue', 'view', String(number), '-R', repo, '--json', 'comments'])
    const comments = JSON.parse(out).comments ?? []
    if (!comments.length) return null
    const last = comments[comments.length - 1]
    return { author: last.author?.login ?? '', body: (last.body ?? '').slice(0, COMMENT_MAX) }
  } catch {
    return null // a single unreadable issue must not fail the whole list
  }
}

const server = new McpServer({ name: 'github', version: '1.0.0' })

// list_my_tickets — the board read. TRIAGE only. Scopes to ASSIGNEE, excludes Done,
// enriches each ticket with its last comment + a needsReply flag (someone other than
// me commented last). Returns { tickets: [...] }.
server.registerTool(
  'list_my_tickets',
  {
    description:
      'List the current user’s open tickets on the GitHub project board (excludes Done), each with status, priority, a trimmed body, and the last comment. Read-only.',
    inputSchema: {},
  },
  async () => {
    try {
      const out = await gh([
        'project', 'item-list', PROJECT, '--owner', OWNER, '--format', 'json', '--limit', '2000',
      ])
      const tickets = mapItems(JSON.parse(out), {
        assignee: ASSIGNEE,
        excludeStatuses: ['Done'],
        bodyMax: BODY_MAX,
      })
      for (const t of tickets) {
        t.lastComment = await lastComment(t.repo, t.number)
        t.needsReply = !!(
          t.lastComment && t.lastComment.author.toLowerCase() !== ASSIGNEE.toLowerCase()
        )
      }
      return { content: [{ type: 'text', text: JSON.stringify({ tickets }) }] }
    } catch (err) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: errText(err) }) }] }
    }
  }
)

// get_ticket — full single-issue read (body + comments). TRIAGE only (downstream
// agents never fetch; they get the ticket via the handoff payload).
server.registerTool(
  'get_ticket',
  {
    description: 'Read one GitHub issue in full (body + comments). Read-only.',
    inputSchema: { repo: z.string(), number: z.number() },
  },
  async ({ repo, number }) => {
    try {
      const out = await gh([
        'issue', 'view', String(number), '-R', repo, '--json', 'number,title,body,state,comments',
      ])
      return { content: [{ type: 'text', text: out }] }
    } catch (err) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: errText(err) }) }] }
    }
  }
)

// Generative-UI render tools — trivial acks; the UI is driven by the provider stream.
const ticketShape = {
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
  body: z.string(),
  url: z.string(),
  lastComment: z.object({ author: z.string(), body: z.string() }).nullable(),
  needsReply: z.boolean(),
  recommendation: z.string(),
}

server.registerTool(
  'render_triage',
  {
    description: 'Surface the triaged ticket list (grouped by status) as a card in the UI.',
    inputSchema: { tickets: z.array(z.object(ticketShape)) },
  },
  async () => ({ content: [{ type: 'text', text: 'Triage surfaced to the user.' }] })
)

server.registerTool(
  'render_ticket_result',
  {
    description: 'Surface a feature/bug analysis of one ticket as a card in the UI.',
    inputSchema: { title: z.string(), kind: z.string(), analysis: z.string() },
  },
  async () => ({ content: [{ type: 'text', text: 'Analysis surfaced to the user.' }] })
)

server.registerTool(
  'render_reply_draft',
  {
    description: 'Surface a suggested reply comment (draft only — never posted) as a card.',
    inputSchema: { title: z.string(), draft: z.string() },
  },
  async () => ({ content: [{ type: 'text', text: 'Suggested reply surfaced to the user.' }] })
)

await server.connect(new StdioServerTransport())
```

- [ ] **Step 2: Smoke-test the adapter against the real board (read-only)**

Run:
```bash
node -e "import('./apps/inbox/mcp/github-format.mjs').then(async ({mapItems})=>{const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const e=promisify(execFile);const {stdout}=await e('gh',['project','item-list','8','--owner','matteappen','--format','json','--limit','2000'],{maxBuffer:32*1024*1024});const t=mapItems(JSON.parse(stdout),{assignee:'Yaroshuk',excludeStatuses:['Done'],bodyMax:1500});console.log('scoped tickets:',t.length);console.log(t.slice(0,3).map(x=>x.status+' #'+x.number+' '+x.title))})"
```
Expected: prints a non-zero count (~15–20 after excluding Done) and a few `status #number title` lines. **No writes occur.**

- [ ] **Step 3: Commit**

```bash
git add apps/inbox/mcp/github-tools.mjs
git commit -m "feat(github): read-only stdio MCP adapter over gh (list/get/render tools)"
```

---

## Phase 3 — Agents, prompts, server wiring

### Task 4: Triage + ticket prompt strategies

**Files:**
- Create: `apps/inbox/agents/triage.prompts.ts` + `apps/inbox/agents/triage.prompts.test.ts`
- Create: `apps/inbox/agents/ticket.prompts.ts` + `apps/inbox/agents/ticket.prompts.test.ts`

- [ ] **Step 1: Failing test for triage prompt**

`apps/inbox/agents/triage.prompts.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createTriagePrompts } from './triage.prompts.js'

describe('triage prompts', () => {
  it('first turn instructs to list then render, and names the route options', () => {
    const p = createTriagePrompts('TRIAGE.')
    const first = p.buildFirst({ messages: [] } as never)
    expect(first).toContain('list_my_tickets')
    expect(first).toContain('render_triage')
    expect(first).toMatch(/feature.*bugfix.*reply/s)
  })
})
```

- [ ] **Step 2: Failing test for ticket (downstream) prompt**

`apps/inbox/agents/ticket.prompts.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { encodeHandoff, type TicketHandoffPayload } from '@atizar/core'
import { createTicketPrompts } from './ticket.prompts.js'

const ticket: TicketHandoffPayload = {
  repo: 'm/r', number: 7, title: 'Crash on save', status: 'Todo', priority: 'High',
  body: 'It crashes', lastComment: null, recommendation: 'bugfix',
  url: 'https://github.com/m/r/issues/7',
}

describe('ticket prompts', () => {
  it('builds from the handoff payload and targets render_ticket_result', () => {
    const p = createTicketPrompts('BUGFIX.', { renderTool: 'render_ticket_result', kind: 'bug' })
    const out = p.buildFirst({ messages: [encodeHandoff(ticket)] } as never)
    expect(out).toContain('Crash on save')
    expect(out).toContain('It crashes')
    expect(out).toContain('render_ticket_result')
    expect(out).toContain('bug')
  })

  it('tells the user to start from triage when there is no handoff', () => {
    const p = createTicketPrompts('FEATURE.', { renderTool: 'render_ticket_result', kind: 'feature' })
    const out = p.buildFirst({ messages: [] } as never)
    expect(out).toMatch(/triage/i)
  })
})
```

- [ ] **Step 3: Run, verify fail**

Run: `yarn test apps/inbox/agents/triage.prompts.test.ts apps/inbox/agents/ticket.prompts.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement `triage.prompts.ts`**

```ts
import type { PromptStrategy } from '@atizar/core'

function triageFirst(instructions: string): string {
  return [
    instructions,
    '',
    'Call list_my_tickets to read the user’s open board tickets. Each ticket has',
    '{ repo, number, title, status, priority, body, url, lastComment, needsReply }.',
    'For EACH ticket, decide a routing recommendation — one of:',
    '- "feature": a feature/enhancement request to analyze,',
    '- "bugfix": a bug to investigate,',
    '- "reply": needsReply is true / the last comment asks the user something.',
    'Then call render_triage with { tickets } — pass every ticket through UNCHANGED',
    'and add a "recommendation" field to each. Do not drop or invent tickets.',
    'Do not narrate your tool usage or mention tools/schemas — keep any text brief.',
  ].join('\n')
}

export function createTriagePrompts(instructions: string): PromptStrategy {
  return {
    buildFirst(): string {
      return triageFirst(instructions)
    },
    // No buildResume: triage has no approvals.
  }
}
```

- [ ] **Step 5: Implement `ticket.prompts.ts`** (shared by feature / bugfix / reply-draft)

```ts
import type { RunAgentInput } from '@ag-ui/client'
import {
  decodeHandoff,
  TicketHandoffPayloadSchema,
  type PromptStrategy,
  type TicketHandoffPayload,
} from '@atizar/core'

type TicketPromptConfig = {
  renderTool: 'render_ticket_result' | 'render_reply_draft'
  kind: 'feature' | 'bug' | 'reply'
}

function noTicketFirst(instructions: string): string {
  return [
    instructions,
    '',
    'No ticket has been routed to you. You do not read the board — the Triage agent',
    'does that. Reply with ONE short sentence telling the user to start from Triage',
    'and route a ticket to you. Do not call any tool and do not narrate tool usage.',
  ].join('\n')
}

function resultFirst(instructions: string, t: TicketHandoffPayload, kind: string): string {
  return [
    instructions,
    '',
    `A ticket was routed to you (recommendation "${t.recommendation}").`,
    `Repo ${t.repo}, issue #${t.number}, status "${t.status}", priority "${t.priority}".`,
    `Title: ${t.title}`,
    `Description: ${t.body}`,
    t.lastComment ? `Last comment by ${t.lastComment.author}: ${t.lastComment.body}` : 'No comments.',
    'Do NOT fetch anything — use only the context above (you have no GitHub access).',
    `Produce a concise ${kind} analysis/plan, then call render_ticket_result with`,
    `{ title, kind: "${kind}", analysis } where title is the ticket title and analysis`,
    'is your write-up. Do not narrate tool usage — keep text brief and user-facing.',
  ].join('\n')
}

function replyFirst(instructions: string, t: TicketHandoffPayload): string {
  return [
    instructions,
    '',
    `A ticket was routed to you for a suggested reply. Repo ${t.repo}, issue #${t.number}.`,
    `Title: ${t.title}`,
    `Description: ${t.body}`,
    t.lastComment ? `Last comment by ${t.lastComment.author}: ${t.lastComment.body}` : 'No comments.',
    'Do NOT fetch anything and do NOT post anything (you have no GitHub access — this is',
    'a DRAFT only). Draft a short, helpful reply comment answering the last comment, then',
    'call render_reply_draft with { title, draft } where title is the ticket title and',
    'draft is your suggested reply. Do not narrate tool usage — keep text brief.',
  ].join('\n')
}

export function createTicketPrompts(instructions: string, cfg: TicketPromptConfig): PromptStrategy {
  return {
    buildFirst(input: RunAgentInput): string {
      const t = decodeHandoff(input, TicketHandoffPayloadSchema)
      if (!t) return noTicketFirst(instructions)
      return cfg.renderTool === 'render_reply_draft'
        ? replyFirst(instructions, t)
        : resultFirst(instructions, t, cfg.kind)
    },
    // No buildResume: no approvals in the read-only GitHub flow.
  }
}
```

- [ ] **Step 6: Run, verify pass + typecheck**

Run: `yarn test apps/inbox/agents/triage.prompts.test.ts apps/inbox/agents/ticket.prompts.test.ts && yarn typecheck`
Expected: PASS; tsc green.

- [ ] **Step 7: Commit**

```bash
git add apps/inbox/agents/triage.prompts.ts apps/inbox/agents/triage.prompts.test.ts apps/inbox/agents/ticket.prompts.ts apps/inbox/agents/ticket.prompts.test.ts
git commit -m "feat(github): triage + downstream ticket prompt strategies"
```

### Task 5: GitHub agent passports

**Files:**
- Create: `apps/inbox/agents/github.agent.ts`
- Create: `apps/inbox/agents/github.agent.test.ts`

- [ ] **Step 1: Failing test**

`apps/inbox/agents/github.agent.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { triageAgent, featureAgent, bugfixAgent, replyDraftAgent, githubAgents } from './github.agent.js'

describe('github agents', () => {
  it('only triage reads the board', () => {
    expect(triageAgent.tools).toContain('list_my_tickets')
    for (const a of [featureAgent, bugfixAgent, replyDraftAgent]) {
      expect(a.tools).not.toContain('list_my_tickets')
      expect(a.tools).not.toContain('get_ticket')
    }
  })

  it('no agent has any approval (read-only flow has no write to pause)', () => {
    for (const a of githubAgents) expect(a.approvals).toEqual([])
  })

  it('triage hands off to the three downstream agents', () => {
    expect(triageAgent.handoffs).toEqual(['feature', 'bugfix', 'reply-draft'])
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `yarn test apps/inbox/agents/github.agent.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `github.agent.ts`**

```ts
import { defineAgent } from '@atizar/core'

// TRIAGE — the ONLY board reader (single entry point). Reads the user’s open tickets,
// buckets them, surfaces a routing recommendation per ticket. Read-only.
export const triageAgent = defineAgent({
  id: 'triage',
  name: 'TRIAGE',
  provider: 'claude-cli',
  instructions:
    'Read the user’s open tickets on the project board and recommend how to route each.',
  tools: ['list_my_tickets', 'get_ticket', 'render_triage'],
  approvals: [],
  renders: { render_triage: 'TriageCard' },
  handoffs: ['feature', 'bugfix', 'reply-draft'],
})

// FEATURE — analyzes a routed feature ticket from the handoff payload (no GitHub access).
export const featureAgent = defineAgent({
  id: 'feature',
  name: 'FEATURE AGENT',
  provider: 'claude-cli',
  instructions: 'Analyze a feature-request ticket routed to you and produce a short plan.',
  tools: ['render_ticket_result'],
  approvals: [],
  renders: { render_ticket_result: 'TicketResultCard' },
})

// BUG-FIX — same shape, bug-oriented.
export const bugfixAgent = defineAgent({
  id: 'bugfix',
  name: 'BUG-FIX AGENT',
  provider: 'claude-cli',
  instructions: 'Investigate a bug ticket routed to you and produce a short analysis.',
  tools: ['render_ticket_result'],
  approvals: [],
  renders: { render_ticket_result: 'TicketResultCard' },
})

// REPLY-DRAFT — drafts a SUGGESTED reply comment (never posted; read-only flow).
export const replyDraftAgent = defineAgent({
  id: 'reply-draft',
  name: 'REPLY DRAFT',
  provider: 'claude-cli',
  instructions: 'Draft a suggested reply to the last comment on a routed ticket. Never post.',
  tools: ['render_reply_draft'],
  approvals: [],
  renders: { render_reply_draft: 'ReplyDraftCard' },
})

export const githubAgents = [triageAgent, featureAgent, bugfixAgent, replyDraftAgent]
```

- [ ] **Step 4: Run, verify pass**

Run: `yarn test apps/inbox/agents/github.agent.test.ts`
Expected: PASS (3 tests). (`defineAgent` validates `renders` keys ⊆ `tools` and `approvals` ⊆ `tools` — all hold.)

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/agents/github.agent.ts apps/inbox/agents/github.agent.test.ts
git commit -m "feat(github): triage/feature/bugfix/reply-draft agent passports"
```

### Task 6: Wire the GitHub MCP into the spawn config

**Files:**
- Modify: `apps/inbox/server/claude-spawn.ts:13-14,66-71`

- [ ] **Step 1: Add the server path + register it**

After line 14 (`const GMAIL_SERVER = …`):
```ts
const GITHUB_SERVER = fileURLToPath(new URL('../mcp/github-tools.mjs', import.meta.url))
```
In the `mcpServers` object (currently lines 66-70), add the `github` entry:
```ts
      mcpServers: {
        inbox: { type: 'stdio', command: 'node', args: [MCP_SERVER] },
        gmail: { type: 'stdio', command: 'node', args: [GMAIL_SERVER] },
        github: { type: 'stdio', command: 'node', args: [GITHUB_SERVER] },
      },
```

- [ ] **Step 2: Typecheck**

Run: `yarn typecheck`
Expected: PASS. (No test — this path is exercised live in Phase 6.)

- [ ] **Step 3: Commit**

```bash
git add apps/inbox/server/claude-spawn.ts
git commit -m "feat(github): register the github stdio MCP in the claude spawn config"
```

### Task 7: Register the 4 agents + allow-lists in the server

**Files:**
- Modify: `apps/inbox/server/index.ts`

- [ ] **Step 1: Imports + combined agent registry for handoff validation**

Replace line 4 and add the new imports below it:
```ts
import { qualifierAgent, replyAgent, agents as inboxAgents } from '../agents/inbox.agent.js'
import {
  triageAgent,
  featureAgent,
  bugfixAgent,
  replyDraftAgent,
  githubAgents,
} from '../agents/github.agent.js'
import { createTriagePrompts } from '../agents/triage.prompts.js'
import { createTicketPrompts } from '../agents/ticket.prompts.js'
```
Change the validation loop source (lines 11-12) to validate ALL agents:
```ts
const allAgents = [...inboxAgents, ...githubAgents]
const knownIds = new Set(allAgents.map((a) => a.id))
for (const a of allAgents) {
```
(Leave the rest of the loop body unchanged.)

- [ ] **Step 2: Add the GitHub allow-lists**

After `REPLY_TOOLS` (line 26):
```ts
const TRIAGE_TOOLS = [
  'mcp__github__list_my_tickets',
  'mcp__github__get_ticket',
  'mcp__github__render_triage',
]
const FEATURE_TOOLS = ['mcp__github__render_ticket_result']
const BUGFIX_TOOLS = ['mcp__github__render_ticket_result']
const REPLY_DRAFT_TOOLS = ['mcp__github__render_reply_draft']
```

- [ ] **Step 3: Register the agents**

In the `CopilotRuntime` `agents` map (after the `replyAgent` entry, before the closing `}`):
```ts
    [triageAgent.id]: buildAgent(
      triageAgent,
      createTriagePrompts(triageAgent.instructions),
      providerRegistry,
      TRIAGE_TOOLS
    ),
    [featureAgent.id]: buildAgent(
      featureAgent,
      createTicketPrompts(featureAgent.instructions, {
        renderTool: 'render_ticket_result',
        kind: 'feature',
      }),
      providerRegistry,
      FEATURE_TOOLS
    ),
    [bugfixAgent.id]: buildAgent(
      bugfixAgent,
      createTicketPrompts(bugfixAgent.instructions, {
        renderTool: 'render_ticket_result',
        kind: 'bug',
      }),
      providerRegistry,
      BUGFIX_TOOLS
    ),
    [replyDraftAgent.id]: buildAgent(
      replyDraftAgent,
      createTicketPrompts(replyDraftAgent.instructions, {
        renderTool: 'render_reply_draft',
        kind: 'reply',
      }),
      providerRegistry,
      REPLY_DRAFT_TOOLS
    ),
```

- [ ] **Step 4: Typecheck + boot the server**

Run: `yarn typecheck`
Expected: PASS.
Run: `yarn dev:server` (then Ctrl-C after it logs `server on http://localhost:4000` with no MODULE_NOT_FOUND).
Expected: server boots clean.

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/server/index.ts
git commit -m "feat(github): register triage workflow agents + per-agent allow-lists"
```

---

## Phase 4 — Client render layer

### Task 8: `buckets.ts` — group tickets by Status

**Files:**
- Create: `apps/inbox/client/src/buckets.ts` + `apps/inbox/client/src/buckets.test.ts`

- [ ] **Step 1: Failing test**

`apps/inbox/client/src/buckets.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { groupByStatus, type TriageTicket } from './buckets'

const t = (over: Partial<TriageTicket>): TriageTicket => ({
  repo: 'm/r', number: 1, title: 't', status: 'Todo', priority: 'Low',
  body: '', url: 'u', lastComment: null, needsReply: false, recommendation: 'feature',
  ...over,
})

describe('groupByStatus', () => {
  it('groups tickets under their status in board order', () => {
    const groups = groupByStatus([
      t({ number: 1, status: 'Todo' }),
      t({ number: 2, status: 'In progress' }),
      t({ number: 3, status: 'Todo' }),
    ])
    expect(groups.map((g) => g.status)).toEqual(['In progress', 'Todo'])
    expect(groups.find((g) => g.status === 'Todo')!.tickets.map((x) => x.number)).toEqual([1, 3])
  })

  it('omits empty status groups', () => {
    const groups = groupByStatus([t({ status: 'Backlog' })])
    expect(groups.map((g) => g.status)).toEqual(['Backlog'])
  })

  it('puts unknown statuses last', () => {
    const groups = groupByStatus([t({ status: 'Weird' }), t({ status: 'Todo' })])
    expect(groups.map((g) => g.status)).toEqual(['Todo', 'Weird'])
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `yarn test apps/inbox/client/src/buckets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `buckets.ts`**

```ts
// The triage ticket shape the TriageCard renders (the model couriers this from
// list_my_tickets through render_triage; see github-tools.mjs). Mirrors
// TicketHandoffPayload minus `recommendation` being optional at render time.
export type TriageTicket = {
  repo: string
  number: number
  title: string
  status: string
  priority: string
  body: string
  url: string
  lastComment: { author: string; body: string } | null
  needsReply: boolean
  recommendation: string
}

export type TicketGroup = { status: string; tickets: TriageTicket[] }

// Board Status order (matches the Magma board’s single-select options). Unknown
// statuses sort after all known ones, in first-seen order.
const STATUS_ORDER = [
  'Backlog', 'Todo', 'In progress', 'On pluto', 'Ready for mars', 'On mars',
  'Ready for venus', 'On venus', 'Ready for prod', 'Verify on prod', 'Done',
]

export function groupByStatus(tickets: TriageTicket[]): TicketGroup[] {
  const byStatus = new Map<string, TriageTicket[]>()
  for (const ticket of tickets) {
    const list = byStatus.get(ticket.status) ?? []
    list.push(ticket)
    byStatus.set(ticket.status, list)
  }
  const rank = (s: string) => {
    const i = STATUS_ORDER.indexOf(s)
    return i === -1 ? STATUS_ORDER.length : i
  }
  return [...byStatus.entries()]
    .map(([status, list]) => ({ status, tickets: list }))
    .sort((a, b) => rank(a.status) - rank(b.status))
}
```

- [ ] **Step 4: Run, verify pass**

Run: `yarn test apps/inbox/client/src/buckets.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/client/src/buckets.ts apps/inbox/client/src/buckets.test.ts
git commit -m "feat(github): groupByStatus bucketing helper for the triage card"
```

### Task 9: New icons

**Files:**
- Modify: `apps/inbox/client/src/components/Icon.tsx:6-14,22`

- [ ] **Step 1: Add icon names + paths**

Extend the `IconName` union (after `'close'`):
```ts
  | 'git'
  | 'bug'
  | 'wrench'
```
Add to the `PATHS` record (before the closing `}` on line 70):
```ts
  git: (
    <>
      <circle cx='12' cy='6' r='3' />
      <circle cx='6' cy='18' r='3' />
      <circle cx='18' cy='18' r='3' />
      <path d='M12 9v3a6 6 0 0 1-6 6M12 12a6 6 0 0 0 6 6' />
    </>
  ),
  bug: (
    <>
      <rect x='8' y='6' width='8' height='14' rx='4' />
      <path d='M19 7l-3 2M5 7l3 2M3 13h3M18 13h3M19 19l-3-2M5 19l3-2M12 2v4' />
    </>
  ),
  wrench: (
    <path d='M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2-2 2.6-2.6z' />
  ),
```

- [ ] **Step 2: Typecheck**

Run: `yarn typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/inbox/client/src/components/Icon.tsx
git commit -m "feat(client): add git/bug/wrench icons for the GitHub workflow"
```

### Task 10: The three GitHub cards

**Files:**
- Create: `apps/inbox/client/src/components/TriageCard.tsx`
- Create: `apps/inbox/client/src/components/TicketResultCard.tsx`
- Create: `apps/inbox/client/src/components/ReplyDraftCard.tsx`
- Modify: `apps/inbox/client/src/renderRegistry.tsx`

No unit tests (presentational; verified in the browser, consistent with the re-skin's existing cards). Reuse the existing `.lead-card` / `.pill` / `.btn` classes from `styles.css`.

- [ ] **Step 1: `TriageCard.tsx`**

```tsx
import { Icon } from './Icon'
import { groupByStatus, type TriageTicket } from '../buckets'

type Route = 'feature' | 'bugfix' | 'reply-draft'

type TriageCardProps = {
  tickets: TriageTicket[]
  onRoute: (target: Route, ticket: TriageTicket) => void
}

const RECO_TO_ROUTE: Record<string, Route> = {
  feature: 'feature',
  bugfix: 'bugfix',
  bug: 'bugfix',
  reply: 'reply-draft',
}

export const TriageCard = ({ tickets, onRoute }: TriageCardProps) => {
  const groups = groupByStatus(tickets)
  return (
    <div className='lead-card'>
      <div className='lead-top'>
        <div className='lead-env'>
          <Icon name='git' size={16} />
        </div>
        <span className='lead-from'>Your tickets · {tickets.length}</span>
      </div>
      {groups.map((group) => (
        <div key={group.status} className='triage-group'>
          <div className='triage-status'>{group.status}</div>
          {group.tickets.map((ticket) => {
            const suggested = RECO_TO_ROUTE[ticket.recommendation] ?? 'feature'
            return (
              <div key={`${ticket.repo}#${ticket.number}`} className='triage-row'>
                <div className='triage-row-title'>
                  {ticket.needsReply && <span className='pill amber'>needs reply</span>}#
                  {ticket.number} {ticket.title}
                </div>
                <div className='triage-routes'>
                  {(['feature', 'bugfix', 'reply-draft'] as Route[]).map((route) => (
                    <button
                      key={route}
                      className={route === suggested ? 'btn btn-primary' : 'btn'}
                      onClick={() => onRoute(route, ticket)}
                    >
                      {route === 'reply-draft' ? 'reply' : route}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: `TicketResultCard.tsx`**

```tsx
import { Icon } from './Icon'

type TicketResultCardProps = { data: { title: string; kind: string; analysis: string } }

export const TicketResultCard = ({ data }: TicketResultCardProps) => {
  return (
    <div className='lead-card'>
      <div className='lead-top'>
        <div className='lead-env'>
          <Icon name={data.kind === 'bug' ? 'bug' : 'wrench'} size={16} />
        </div>
        <span className='lead-from'>{data.kind === 'bug' ? 'Bug analysis' : 'Feature plan'}</span>
      </div>
      <div className='lead-subject'>{data.title}</div>
      <div className='lead-reason' style={{ whiteSpace: 'pre-wrap' }}>
        {data.analysis}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: `ReplyDraftCard.tsx`**

```tsx
import { Icon } from './Icon'

type ReplyDraftCardProps = { data: { title: string; draft: string } }

export const ReplyDraftCard = ({ data }: ReplyDraftCardProps) => {
  return (
    <div className='approval'>
      <span className='approval-badge'>
        <Icon name='pen' size={12} /> Suggested reply (draft — not posted)
      </span>
      <div className='lead-subject'>{data.title}</div>
      <div className='approval-preview' style={{ whiteSpace: 'pre-wrap' }}>
        {data.draft}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Register in `renderRegistry.tsx`**

```tsx
import type { ComponentType } from 'react'
import { LeadCard } from './components/LeadCard'
import { ApprovalDialog } from './components/ApprovalDialog'
import { VerdictCard } from './components/VerdictCard'
import { TriageCard } from './components/TriageCard'
import { TicketResultCard } from './components/TicketResultCard'
import { ReplyDraftCard } from './components/ReplyDraftCard'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const renderRegistry: Record<string, ComponentType<any>> = {
  LeadCard,
  ApprovalDialog,
  VerdictCard,
  TriageCard,
  TicketResultCard,
  ReplyDraftCard,
}
```

- [ ] **Step 5: Typecheck**

Run: `yarn typecheck`
Expected: PASS.

- [ ] **Step 6: Add the triage card styles**

Append to `apps/inbox/client/src/styles.css`:
```css
.triage-group { margin-top: 12px; }
.triage-status {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--muted); margin-bottom: 6px;
}
.triage-row {
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
  padding: 8px 0; border-top: 1px solid #eee;
}
.triage-row-title { font-size: 13px; display: flex; align-items: center; gap: 6px; }
.triage-routes { display: flex; gap: 6px; flex-shrink: 0; }
.triage-routes .btn { padding: 3px 10px; font-size: 12px; }
```

- [ ] **Step 7: Commit**

```bash
git add apps/inbox/client/src/components/TriageCard.tsx apps/inbox/client/src/components/TicketResultCard.tsx apps/inbox/client/src/components/ReplyDraftCard.tsx apps/inbox/client/src/renderRegistry.tsx apps/inbox/client/src/styles.css
git commit -m "feat(client): TriageCard, TicketResultCard, ReplyDraftCard + styles"
```

### Task 11: `useGithubActions` — register the GitHub render tools

**Files:**
- Create: `apps/inbox/client/src/githubActions.tsx`

No unit test (CopilotKit hook; verified in the browser). Mirrors `actions.tsx`, but all three are pure `useRenderTool` (no approvals). `render_triage` forwards route clicks to `onHandoff`.

- [ ] **Step 1: Implement**

```tsx
import { useRenderTool } from '@copilotkit/react-core/v2'
import { z } from 'zod'
import type { TicketHandoffPayload } from '@atizar/core'
import { renderRegistry } from './renderRegistry'
import type { TriageTicket } from './buckets'

const lastCommentSchema = z.object({ author: z.string(), body: z.string() }).nullable()
const ticketSchema = z.object({
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
  body: z.string(),
  url: z.string(),
  lastComment: lastCommentSchema,
  needsReply: z.boolean(),
  recommendation: z.string(),
})

// Build the self-contained handoff payload a routed ticket carries downstream.
const toPayload = (t: TriageTicket): TicketHandoffPayload => ({
  repo: t.repo,
  number: t.number,
  title: t.title,
  status: t.status,
  priority: t.priority,
  body: t.body,
  lastComment: t.lastComment,
  recommendation: t.recommendation,
  url: t.url,
})

// Generative-UI registration for the GitHub workflow. All three are pure renders
// (no approvals — read-only flow). render_triage forwards a route click to onHandoff.
export const useGithubActions = (
  onHandoff?: (targetId: string, payload: TicketHandoffPayload) => void
) => {
  useRenderTool(
    {
      name: 'render_triage',
      parameters: z.object({ tickets: z.array(ticketSchema) }),
      render: ({ parameters }) => {
        const tickets = parameters.tickets
        if (tickets === undefined) return <></>
        const Triage = renderRegistry['TriageCard']
        return (
          <Triage
            tickets={tickets}
            onRoute={(target: string, ticket: TriageTicket) => onHandoff?.(target, toPayload(ticket))}
          />
        )
      },
    },
    [onHandoff]
  )

  useRenderTool(
    {
      name: 'render_ticket_result',
      parameters: z.object({ title: z.string(), kind: z.string(), analysis: z.string() }),
      render: ({ parameters }) => {
        const { title, kind, analysis } = parameters
        if (title === undefined || kind === undefined || analysis === undefined) return <></>
        const Result = renderRegistry['TicketResultCard']
        return <Result data={{ title, kind, analysis }} />
      },
    },
    []
  )

  useRenderTool(
    {
      name: 'render_reply_draft',
      parameters: z.object({ title: z.string(), draft: z.string() }),
      render: ({ parameters }) => {
        const { title, draft } = parameters
        if (title === undefined || draft === undefined) return <></>
        const Reply = renderRegistry['ReplyDraftCard']
        return <Reply data={{ title, draft }} />
      },
    },
    []
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `yarn typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/inbox/client/src/githubActions.tsx
git commit -m "feat(client): useGithubActions render tools + ticket handoff forwarding"
```

---

## Phase 5 — N-agent desktop + workflow switcher

### Task 12: Workflow registry + per-agent META

**Files:**
- Create: `apps/inbox/client/src/workflows.ts`

- [ ] **Step 1: Implement the registry**

```ts
import type { AgentDefinition } from '@atizar/core'
import type { IconName } from './components/Icon'
import { agents as inboxAgents, qualifierAgent, replyAgent } from '../../agents/inbox.agent'
import {
  githubAgents,
  triageAgent,
  featureAgent,
  bugfixAgent,
  replyDraftAgent,
} from '../../agents/github.agent'

export type AgentMeta = { subtitle: string; iconName: IconName }

export type Workflow = {
  id: string
  label: string
  iconName: IconName
  agents: AgentDefinition[]
  entryAgentId: string
}

// Per-agent display chrome (icon + one-line subtitle), keyed by agent id. Lives
// client-side for now (adding it to the core passport is deferred to the framework phase).
export const META: Record<string, AgentMeta> = {
  [qualifierAgent.id]: { subtitle: 'Reads inbox, qualifies the lead', iconName: 'inbox' },
  [replyAgent.id]: { subtitle: 'Drafts a reply for your approval', iconName: 'pen' },
  [triageAgent.id]: { subtitle: 'Reads your board, recommends routing', iconName: 'git' },
  [featureAgent.id]: { subtitle: 'Plans a routed feature ticket', iconName: 'wrench' },
  [bugfixAgent.id]: { subtitle: 'Analyzes a routed bug ticket', iconName: 'bug' },
  [replyDraftAgent.id]: { subtitle: 'Drafts a suggested reply (never posts)', iconName: 'pen' },
}

export const workflows: Workflow[] = [
  {
    id: 'lead-inbox',
    label: 'Lead inbox',
    iconName: 'inbox',
    agents: inboxAgents,
    entryAgentId: qualifierAgent.id,
  },
  {
    id: 'github-triage',
    label: 'GitHub triage',
    iconName: 'git',
    agents: githubAgents,
    entryAgentId: triageAgent.id,
  },
]
```

- [ ] **Step 2: Typecheck**

Run: `yarn typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/inbox/client/src/workflows.ts
git commit -m "feat(client): workflow registry (Lead inbox + GitHub triage) + agent META"
```

### Task 13: `AgentRuntime` — per-agent hook owner

**Files:**
- Create: `apps/inbox/client/src/components/AgentRuntime.tsx`

This is the rules-of-hooks fix: one component instance per agent calls `useAgent` +
`useAgentStatus` exactly once and publishes `{ agent, status }` to the parent via a
stable callback. Mounting/unmounting on a workflow switch resets the hooks cleanly.

- [ ] **Step 1: Implement**

```tsx
import { useEffect } from 'react'
import { useAgent, UseAgentUpdate } from '@copilotkit/react-core/v2'
import type { AgentDefinition } from '@atizar/core'
import { useAgentStatus } from '../useAgentStatus'
import type { Status } from '../status'

// The live runtime object an AgentRuntime publishes upward for one agent id.
export type AgentHandle = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: any
  status: Status
}

type AgentRuntimeProps = {
  def: AgentDefinition
  onChange: (id: string, handle: AgentHandle) => void
}

// Renders nothing — it exists only to own one agent’s hooks and report state up.
export const AgentRuntime = ({ def, onChange }: AgentRuntimeProps) => {
  const { agent } = useAgent({ agentId: def.id, updates: [UseAgentUpdate.OnMessagesChanged] })
  const status = useAgentStatus(agent, def.approvals)

  useEffect(() => {
    onChange(def.id, { agent, status })
  }, [def.id, agent, status, onChange])

  return null
}
```

- [ ] **Step 2: Typecheck**

Run: `yarn typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/inbox/client/src/components/AgentRuntime.tsx
git commit -m "feat(client): AgentRuntime — per-agent hook owner (rules-of-hooks safe)"
```

### Task 14: `WorkflowSwitcher`

**Files:**
- Create: `apps/inbox/client/src/components/WorkflowSwitcher.tsx`

- [ ] **Step 1: Implement**

```tsx
import { Icon } from './Icon'
import type { Workflow } from '../workflows'

type WorkflowSwitcherProps = {
  workflows: Workflow[]
  activeId: string
  onSelect: (id: string) => void
}

export const WorkflowSwitcher = ({ workflows, activeId, onSelect }: WorkflowSwitcherProps) => {
  return (
    <div className='workflow-tabs'>
      {workflows.map((wf) => (
        <button
          key={wf.id}
          className={wf.id === activeId ? 'workflow-tab active' : 'workflow-tab'}
          onClick={() => onSelect(wf.id)}
        >
          <Icon name={wf.iconName} size={14} />
          {wf.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Add styles to `styles.css`**

```css
.workflow-tabs { display: flex; gap: 6px; padding: 10px 16px; }
.workflow-tab {
  display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px;
  border: 1px solid #e5e5e5; border-radius: 999px; background: #fff;
  font-size: 13px; cursor: pointer; color: var(--muted);
}
.workflow-tab.active { background: #111; color: #fff; border-color: #111; }
```

- [ ] **Step 3: Typecheck + commit**

Run: `yarn typecheck`
```bash
git add apps/inbox/client/src/components/WorkflowSwitcher.tsx apps/inbox/client/src/styles.css
git commit -m "feat(client): WorkflowSwitcher tabs"
```

### Task 15: Generalize `InboxView` → `WorkflowView` (N agents)

**Files:**
- Modify: `apps/inbox/client/src/InboxView.tsx` (full rewrite)

This replaces the two hardcoded `useAgent` calls with: render one `AgentRuntime` per
agent in the active workflow, collect their handles into state, and map over the agent
list for the pipeline / grid / modals. Register BOTH workflows' actions unconditionally
(tool names are globally unique → stable hook count).

- [ ] **Step 1: Rewrite `InboxView.tsx`**

```tsx
import { useCallback, useState } from 'react'
import { useCopilotKit, useRenderToolCall } from '@copilotkit/react-core/v2'
import { useInboxActions } from './actions'
import { useGithubActions } from './githubActions'
import { AgentCard } from './components/AgentCard'
import { AgentModal } from './components/AgentModal'
import { AgentRuntime, type AgentHandle } from './components/AgentRuntime'
import { PipelineColumn } from './components/PipelineColumn'
import { WorkflowSwitcher } from './components/WorkflowSwitcher'
import { Icon } from './components/Icon'
import type { PipelineNode } from './pipeline'
import type { Status } from './status'
import { workflows, META } from './workflows'
import { encodeHandoff, type Message } from '@atizar/core'

export const InboxView = () => {
  const { copilotkit } = useCopilotKit()
  const [activeWorkflowId, setActiveWorkflowId] = useState(workflows[0].id)
  const [openId, setOpenId] = useState<string | null>(null)
  const [handles, setHandles] = useState<Record<string, AgentHandle>>({})

  const workflow = workflows.find((w) => w.id === activeWorkflowId) ?? workflows[0]

  // Agents that are some other agent's handoff target are launched BY that agent —
  // they get no START button. Computed over the active workflow only.
  const handoffTargets = new Set(workflow.agents.flatMap((a) => a.handoffs ?? []))
  const canStart = (id: string) => !handoffTargets.has(id)

  const onAgentChange = useCallback((id: string, handle: AgentHandle) => {
    setHandles((prev) => {
      const cur = prev[id]
      if (cur && cur.agent === handle.agent && cur.status === handle.status) return prev
      return { ...prev, [id]: handle }
    })
  }, [])

  // The handoff seam (human trigger). Seed the target run with the payload, launch it,
  // open its modal. Works for both payload shapes — encode is schema-agnostic.
  const requestHandoff = useCallback(
    (targetId: string, payload: unknown) => {
      const target = handles[targetId]?.agent
      if (!target) return
      const seed = encodeHandoff(payload) as Message
      target.messages.splice(0, target.messages.length, seed)
      void copilotkit.runAgent({ agent: target })
      setOpenId(targetId)
    },
    [copilotkit, handles]
  )

  // Both workflows' render tools register unconditionally (globally-unique tool names,
  // stable hook order). Each forwards its own handoff payload shape to requestHandoff.
  useInboxActions((id, payload) => requestHandoff(id, payload))
  useGithubActions((id, payload) => requestHandoff(id, payload))

  const renderToolCall = useRenderToolCall()

  const statusOf = (id: string): Status => handles[id]?.status ?? 'idle'
  const agentOf = (id: string) => handles[id]?.agent

  const pipelineNodes: PipelineNode[] = workflow.agents.map((a) => ({
    id: a.id,
    name: a.name,
    subtitle: META[a.id].subtitle,
    iconName: META[a.id].iconName,
    status: statusOf(a.id),
    handoffsTo: a.handoffs ?? [],
  }))

  const openAgentDef = openId ? workflow.agents.find((a) => a.id === openId) : undefined

  return (
    <>
      {/* Hidden hook owners — one per agent in the active workflow. Keyed by id so a
          workflow switch unmounts the old set and mounts the new (hooks reset cleanly). */}
      {workflow.agents.map((a) => (
        <AgentRuntime key={`${workflow.id}:${a.id}`} def={a} onChange={onAgentChange} />
      ))}

      <WorkflowSwitcher
        workflows={workflows}
        activeId={activeWorkflowId}
        onSelect={(id) => {
          setOpenId(null)
          setActiveWorkflowId(id)
        }}
      />

      <div className='workspace-body'>
        <PipelineColumn nodes={pipelineNodes} onOpen={setOpenId} />

        <div className='main'>
          <div className='comp-head'>
            <span className='ch-label'>
              <Icon name='layers' size={14} />
              Your agents
            </span>
            <span className='ch-spacer' />
            <span className='legend'>
              <span className='legend-item'>
                <span className='dot idle' />
                Idle
              </span>
              <span className='legend-item'>
                <span className='dot done' />
                Running / done
              </span>
              <span className='legend-item'>
                <span className='dot awaiting_approval' />
                Awaiting approval
              </span>
            </span>
          </div>

          <div className='main-scroll'>
            <div className='agent-grid'>
              {workflow.agents.map((a) => {
                const agent = agentOf(a.id)
                return (
                  <AgentCard
                    key={a.id}
                    name={a.name}
                    subtitle={META[a.id].subtitle}
                    iconName={META[a.id].iconName}
                    status={statusOf(a.id)}
                    canStart={canStart(a.id)}
                    onStart={() => agent && void copilotkit.runAgent({ agent })}
                    onOpen={() => setOpenId(a.id)}
                  />
                )
              })}
            </div>
          </div>
        </div>

        {openAgentDef && agentOf(openAgentDef.id) && (
          <AgentModal
            agent={agentOf(openAgentDef.id)}
            title={openAgentDef.name}
            iconName={META[openAgentDef.id].iconName}
            status={statusOf(openAgentDef.id)}
            renderToolCall={renderToolCall}
            loading={statusOf(openAgentDef.id) === 'running'}
            canStart={canStart(openAgentDef.id)}
            onStart={() => {
              const agent = agentOf(openAgentDef.id)
              if (agent) void copilotkit.runAgent({ agent })
            }}
            onClose={() => setOpenId(null)}
          />
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 2: Verify nothing else imports the removed exports**

Run: `grep -rn "qualifierAgent\|replyAgent" apps/inbox/client/src/InboxView.tsx`
Expected: no matches (the file no longer references them directly).
Run: `yarn typecheck`
Expected: PASS.

- [ ] **Step 3: Run the existing client unit tests**

Run: `yarn test apps/inbox/client/src`
Expected: PASS — `pipeline.test.ts`, `renderLead.test.tsx`, `renderVerdict.test.tsx`, `useAgentStatus.test.ts`, `buckets.test.ts` all green. (These don't render `InboxView` directly.)

- [ ] **Step 4: Commit**

```bash
git add apps/inbox/client/src/InboxView.tsx
git commit -m "feat(client): generalize InboxView to N agents + workflow switcher"
```

---

## Phase 6 — Full verification

### Task 16: Whole-suite gate + browser E2E on the real board

**Files:** none (verification only).

- [ ] **Step 1: Full static gate**

Run: `yarn typecheck && yarn lint && yarn format:check && yarn test && yarn build`
Expected: all green; test count = previous 88 + new core/format/prompts/agent/buckets tests. If lint flags an unavoidable `any` (heterogeneous registry / agent handle), add a scoped `// eslint-disable-next-line` with a one-line reason (per CLAUDE.md).

- [ ] **Step 2: Launch the app**

Run: `yarn dev`
Open `http://localhost:5173`.

- [ ] **Step 3: Gmail workflow still works (regression)**

On the **Lead inbox** tab: START the LEAD QUALIFIER → a VerdictCard appears → click **Draft reply** → REPLY agent runs → ApprovalDialog → approve → confirms a real Gmail draft id. (No behavior change from before.)

- [ ] **Step 4: GitHub triage on the real board (read-only)**

Switch to the **GitHub triage** tab:
- START **TRIAGE** → it calls `list_my_tickets` → a `TriageCard` shows your real open tickets grouped by Status (In progress / On pluto / Todo / Backlog / …), with **needs reply** pills where someone else commented last.
- On a feature-ish ticket click **feature** → FEATURE agent opens, renders a `TicketResultCard` plan (built only from the payload — confirm in the server logs it makes NO `gh` call).
- On a bug-ish ticket click **bugfix** → BUG-FIX renders a bug analysis card.
- On a ticket with a question in the last comment click **reply** → REPLY DRAFT renders a `ReplyDraftCard` suggestion (labelled "draft — not posted").

- [ ] **Step 5: Confirm read-only**

Run: `gh issue view <a-routed-ticket-number> -R <repo> --json comments --jq '.comments | length'` before and after the run.
Expected: the count is **unchanged** — nothing was posted. (Also: `git -C <repo> log` is irrelevant; we never touched any repo.)

- [ ] **Step 6: Update living docs**

Update `HANDOFF.md` "Where we are now" to record the GitHub triage workflow as BUILT + browser-verified, and add a `docs/BUILD-LOG.md` §7 narrative. Note the deferred follow-up: a proper workflow-separation pass (the user flagged splitting flows comes later) and tightening the desktop chrome per workflow.

- [ ] **Step 7: Final commit**

```bash
git add HANDOFF.md docs/BUILD-LOG.md
git commit -m "docs: GitHub triage workflow built + browser-verified on real Magma Board"
```

---

## Self-review notes

- **Spec coverage:** adapter (Task 3) · single-board-reader boundary (Tasks 5, 7) · handoff generalization (Task 1) · buckets + needs-reply (Tasks 3, 8) · N-agent desktop + switcher (Tasks 12–15) · 3 cards (Task 10) · read-only (Tasks 3, 5, 16-step5) · tests + E2E (Task 16). All spec sections map to a task.
- **Type consistency:** `TriageTicket` (buckets.ts) and the adapter ticket shape and `render_triage` zod schema (githubActions.tsx) and `ticketShape` (github-tools.mjs) all carry the same 10 fields; `TicketHandoffPayload` (core) is that minus `needsReply`. `decodeHandoff(input, schema)` arity is consistent across reply.prompts.ts and ticket.prompts.ts. Agent ids (`triage`/`feature`/`bugfix`/`reply-draft`) match between `github.agent.ts`, `workflows.ts`, server allow-lists, and TriageCard route values.
- **Read-only:** no task introduces any `gh` write; the adapter has only `item-list`/`issue view`; no agent has approvals or a write tool.
