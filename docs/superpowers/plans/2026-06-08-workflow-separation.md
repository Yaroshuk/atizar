# Workflow Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn each workflow into a self-contained, isolated module — its own agents (reusable as independent copies), a published typed input contract for safe cross-workflow delivery, and all agents mounted idle so delivery runs in the background without ever auto-switching the view.

**Architecture:** A new `@atizar/core` `defineWorkflow` validates a pure-data `WorkflowDescriptor` (agent placements with `input`/`worker` roles + a published `inputs` contract). The client shell mounts every workflow × agent as an invisible `AgentRuntime` keyed by `instanceId(workflowId, agentId)`, keeps a global handle map, and exposes one `deliver(origin, dest, payload)` seam (intra-workflow by agent id, cross-workflow by contract). Handoff-emitting render cards carry an `origin` param (injected by the per-instance prompt) so a single shared render registration routes the handoff to the correct copy. The server registers each placement under its instance id.

**Tech Stack:** TypeScript, zod v3, React + CopilotKit v2 (`@copilotkit/react-core/v2`), Hono + `@copilotkit/runtime/v2`, Vitest, yarn-classic workspace. Run everything from the repo root (`yarn test`, `yarn typecheck`, `yarn lint`).

**Spec:** `docs/superpowers/specs/2026-06-08-workflow-separation-design.md`

---

## File structure

**Create:**
- `packages/core/src/defineWorkflow.ts` — workflow types, `instanceId`, `defineWorkflow` validator.
- `packages/core/src/defineWorkflow.test.ts`
- `apps/inbox/workflows/lead-inbox/descriptor.ts` — lead-inbox descriptor + its agent defs.
- `apps/inbox/workflows/lead-inbox/server.ts` — per-agent prompts + allow-lists.
- `apps/inbox/workflows/lead-inbox/client.tsx` — render specs (data) + META + optional view.
- `apps/inbox/workflows/github-triage/descriptor.ts`
- `apps/inbox/workflows/github-triage/server.ts`
- `apps/inbox/workflows/github-triage/client.tsx`
- `apps/inbox/workflows/index.ts` — descriptor registry (core layer).
- `apps/inbox/server/workflows.ts` — server-bindings registry.
- `apps/inbox/client/src/deliver.ts` — `deliver` resolution helpers (pure, testable).
- `apps/inbox/client/src/deliver.test.ts`
- `apps/inbox/client/src/useWorkflowRenders.tsx` — single dedup render registration.

**Modify:**
- `packages/core/src/index.ts` — export `defineWorkflow`.
- `apps/inbox/mcp/inbox-tools.mjs` — add `origin` to `renderVerdict`.
- `apps/inbox/mcp/github-tools.mjs` — add `origin` to `render_triage`.
- `apps/inbox/agents/qualifier.prompts.ts` — inject `origin`; use a handed-off lead if present.
- `apps/inbox/agents/triage.prompts.ts` — inject `origin`.
- `apps/inbox/server/index.ts` — iterate the registry; register per instance id.
- `apps/inbox/client/src/workflows.ts` — re-export the client-side registry (descriptors + META + renders + views).
- `apps/inbox/client/src/InboxView.tsx` — the shell: all-mounted, global handles, `deliver`, no auto-open, badge.
- `apps/inbox/client/src/components/WorkflowSwitcher.tsx` — unread badge per tab.
- `apps/inbox/client/src/components/AgentModal.tsx` — `HandoffNote` gains optional `targetWorkflow` + an "Open in" button.

**Delete (after migration):**
- `apps/inbox/agents/inbox.agent.ts`, `apps/inbox/agents/github.agent.ts` (defs move into descriptors).
- `apps/inbox/client/src/actions.tsx`, `apps/inbox/client/src/githubActions.tsx` (folded into render specs).

---

## Task 1: Core — workflow types, `instanceId`, `defineWorkflow`

**Files:**
- Create: `packages/core/src/defineWorkflow.ts`
- Test: `packages/core/src/defineWorkflow.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/defineWorkflow.test.ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineAgent } from './defineAgent.js'
import { defineWorkflow, instanceId } from './defineWorkflow.js'

const reader = defineAgent({
  id: 'reader', name: 'Reader', provider: 'mock', instructions: 'x',
  tools: ['t'], approvals: [], renders: {},
})
const worker = defineAgent({
  id: 'worker', name: 'Worker', provider: 'mock', instructions: 'x',
  tools: ['t'], approvals: [], renders: {}, handoffs: [],
})

const base = {
  id: 'wf', label: 'WF', iconName: 'inbox',
  agents: [{ agent: reader, role: 'input' as const }, { agent: worker, role: 'worker' as const }],
  entryAgentId: 'reader',
  inputs: [{ name: 'lead', schema: z.object({ x: z.string() }), agentId: 'reader' }],
}

describe('instanceId', () => {
  it('namespaces an agent by workflow', () => {
    expect(instanceId('wf', 'reader')).toBe('wf__reader')
  })
})

describe('defineWorkflow', () => {
  it('accepts a valid descriptor', () => {
    expect(defineWorkflow(base).id).toBe('wf')
  })
  it('rejects an entryAgentId that is not a role:input agent', () => {
    expect(() => defineWorkflow({ ...base, entryAgentId: 'worker' })).toThrow(/entry/i)
  })
  it('rejects an input bound to a non-input agent', () => {
    expect(() =>
      defineWorkflow({ ...base, inputs: [{ name: 'lead', schema: z.object({}), agentId: 'worker' }] })
    ).toThrow(/input "lead"/i)
  })
  it('rejects duplicate published input names', () => {
    const dup = { name: 'lead', schema: z.object({}), agentId: 'reader' }
    expect(() => defineWorkflow({ ...base, inputs: [dup, dup] })).toThrow(/duplicate/i)
  })
  it('rejects a handoff that leaves the workflow', () => {
    const stray = defineAgent({
      id: 'reader', name: 'R', provider: 'mock', instructions: 'x',
      tools: ['t'], approvals: [], renders: {}, handoffs: ['nope'],
    })
    expect(() =>
      defineWorkflow({ ...base, agents: [{ agent: stray, role: 'input' }, { agent: worker, role: 'worker' }] })
    ).toThrow(/hands off to "nope"/i)
  })
  it('rejects duplicate agent ids', () => {
    expect(() =>
      defineWorkflow({ ...base, agents: [{ agent: reader, role: 'input' }, { agent: reader, role: 'input' }] })
    ).toThrow(/duplicate agent/i)
  })
})
```

- [ ] **Step 2: Run it; verify it fails**

Run: `yarn test packages/core/src/defineWorkflow.test.ts`
Expected: FAIL — `Cannot find module './defineWorkflow.js'`.

- [ ] **Step 3: Implement `defineWorkflow.ts`**

```ts
// packages/core/src/defineWorkflow.ts
import { z } from 'zod'
import type { AgentDefinition } from './defineAgent.js'

export type AgentRole = 'input' | 'worker'

export type WorkflowAgent = {
  agent: AgentDefinition
  role: AgentRole
}

// Published contract entry. Public face is { name, schema }; agentId is the PRIVATE
// binding to the input agent that receives a cross-workflow parcel of this shape.
export type WorkflowInput = {
  name: string
  schema: z.ZodTypeAny
  agentId: string
}

export type WorkflowDescriptor = {
  id: string
  label: string
  iconName: string
  agents: WorkflowAgent[]
  entryAgentId: string
  inputs: WorkflowInput[]
}

// A delivery destination: an internal worker (same workflow) or another workflow's
// published input contract. The model never produces these — only the human does.
export type Destination =
  | { kind: 'agent'; agentId: string }
  | { kind: 'contract'; workflow: string; input: string }

// The single place that namespaces an agent placement so the same agent reused in
// two workflows becomes two independent CopilotKit instances.
export function instanceId(workflowId: string, agentId: string): string {
  return `${workflowId}__${agentId}`
}

// Structure-only validation (mirrors defineAgent): provider/registry existence is
// checked at wiring time, not here.
export function defineWorkflow(def: WorkflowDescriptor): WorkflowDescriptor {
  const ids = def.agents.map((a) => a.agent.id)
  const dupId = ids.find((id, i) => ids.indexOf(id) !== i)
  if (dupId) throw new Error(`workflow "${def.id}": duplicate agent id "${dupId}"`)

  const inputAgentIds = new Set(def.agents.filter((a) => a.role === 'input').map((a) => a.agent.id))
  const allIds = new Set(ids)

  if (!inputAgentIds.has(def.entryAgentId)) {
    throw new Error(`workflow "${def.id}": entry agent "${def.entryAgentId}" is not a role:input agent`)
  }

  for (const a of def.agents) {
    for (const target of a.agent.handoffs ?? []) {
      if (!allIds.has(target)) {
        throw new Error(`workflow "${def.id}": agent "${a.agent.id}" hands off to "${target}" which is not in this workflow`)
      }
    }
  }

  const names = def.inputs.map((i) => i.name)
  const dupName = names.find((n, i) => names.indexOf(n) !== i)
  if (dupName) throw new Error(`workflow "${def.id}": duplicate published input name "${dupName}"`)

  for (const input of def.inputs) {
    if (!inputAgentIds.has(input.agentId)) {
      throw new Error(`workflow "${def.id}": input "${input.name}" is bound to "${input.agentId}" which is not a role:input agent`)
    }
  }

  return def
}
```

- [ ] **Step 4: Export from the core barrel**

```ts
// packages/core/src/index.ts — add this line
export * from './defineWorkflow.js'
```

- [ ] **Step 5: Run tests; verify they pass**

Run: `yarn test packages/core/src/defineWorkflow.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/defineWorkflow.ts packages/core/src/defineWorkflow.test.ts packages/core/src/index.ts
git commit -m "feat(core): defineWorkflow + instanceId + workflow/Destination types"
```

---

## Task 2: lead-inbox workflow module (descriptor + server + client)

Move the qualifier/reply agent defs into the workflow folder and add roles + a published `lead`
contract (bound to the qualifier — it becomes the receptionist for a handed-off lead).

**Files:**
- Create: `apps/inbox/workflows/lead-inbox/descriptor.ts`, `.../server.ts`, `.../client.tsx`

- [ ] **Step 1: Create the descriptor (agent defs move here)**

```ts
// apps/inbox/workflows/lead-inbox/descriptor.ts
import { defineAgent, defineWorkflow, HandoffPayloadSchema } from '@atizar/core'

export const replyAgent = defineAgent({
  id: 'reply',
  name: 'REPLY AGENT',
  provider: 'claude-cli',
  instructions:
    'Read the latest email in the inbox, draft a reply, and ask the human before saving it as a draft.',
  tools: ['renderLead', 'saveDraft'],
  approvals: ['saveDraft'],
  renders: { renderLead: 'LeadCard', saveDraft: 'ApprovalDialog' },
})

export const qualifierAgent = defineAgent({
  id: 'qualifier',
  name: 'LEAD QUALIFIER',
  provider: 'claude-cli',
  instructions:
    'Read the latest email in the inbox and qualify the lead: category, priority, and a one-line reason.',
  tools: ['renderVerdict'],
  approvals: [],
  renders: { renderVerdict: 'VerdictCard' },
  handoffs: ['reply'],
})

export const leadInbox = defineWorkflow({
  id: 'lead-inbox',
  label: 'Lead inbox',
  iconName: 'inbox',
  agents: [
    { agent: qualifierAgent, role: 'input' },
    { agent: replyAgent, role: 'worker' },
  ],
  entryAgentId: qualifierAgent.id,
  // Published contract: another workflow may deliver a lead here; the qualifier
  // (re-)qualifies it. Shape = the existing lead handoff payload.
  inputs: [{ name: 'lead', schema: HandoffPayloadSchema, agentId: qualifierAgent.id }],
})

export const leadInboxAgents = [qualifierAgent, replyAgent]
```

- [ ] **Step 2: Create the server bindings**

```ts
// apps/inbox/workflows/lead-inbox/server.ts
import type { PromptStrategy } from '@atizar/core'
import { createQualifierPrompts } from '../../agents/qualifier.prompts.js'
import { createReplyPrompts } from '../../agents/reply.prompts.js'
import { qualifierAgent, replyAgent } from './descriptor.js'

// Per-agent server runtime bindings: the prompt strategy + the fully-qualified MCP
// allow-list (the single-entry-point boundary). `origin` is the workflow id, woven
// into handoff-emitting render prompts so reused copies route correctly (see spec §5).
export type ServerBinding = { agentId: string; prompts: PromptStrategy; allowedTools: string[] }

export const leadInboxServer = (origin: string): ServerBinding[] => [
  {
    agentId: qualifierAgent.id,
    prompts: createQualifierPrompts(qualifierAgent.instructions, origin),
    allowedTools: ['mcp__inbox__renderVerdict', 'mcp__gmail__get_latest_email'],
  },
  {
    agentId: replyAgent.id,
    prompts: createReplyPrompts(replyAgent.instructions),
    allowedTools: ['mcp__inbox__renderLead', 'mcp__inbox__saveDraft', 'mcp__gmail__create_draft'],
  },
]
```

- [ ] **Step 3: Create the client render specs + META**

```tsx
// apps/inbox/workflows/lead-inbox/client.tsx
import { z } from 'zod'
import type { RenderSpec, HitlSpec, AgentMeta } from '../../client/src/renderSpecs'
import { qualifierAgent, replyAgent } from './descriptor'

export const leadInboxMeta: Record<string, AgentMeta> = {
  [qualifierAgent.id]: {
    subtitle: 'Reads inbox, qualifies the lead',
    iconName: 'inbox',
    intro: 'Reading your inbox and qualifying the latest lead…',
  },
  [replyAgent.id]: {
    subtitle: 'Drafts a reply for your approval',
    iconName: 'pen',
    intro: 'Drafting a reply to the qualified lead for your approval…',
  },
}

export const leadInboxRenders: RenderSpec[] = [
  {
    toolName: 'renderLead',
    parameters: z.object({ from: z.string(), subject: z.string(), summary: z.string() }),
    render: ({ parameters }, _deliver, registry) => {
      const { from, subject, summary } = parameters
      if (from === undefined || subject === undefined || summary === undefined) return <></>
      const Lead = registry['LeadCard']
      return <Lead lead={{ from, subject, summary }} />
    },
  },
  {
    toolName: 'renderVerdict',
    parameters: z.object({
      origin: z.string(),
      threadId: z.string(), from: z.string(), subject: z.string(), summary: z.string(),
      category: z.string(), priority: z.string(), reason: z.string(),
    }),
    render: ({ parameters }, deliver, registry) => {
      const { origin, threadId, from, subject, summary, category, priority, reason } = parameters
      if (origin === undefined || threadId === undefined || from === undefined) return <></>
      const data = { threadId, from, subject, summary, category, priority, reason }
      const Verdict = registry['VerdictCard']
      return (
        <Verdict
          data={data}
          onDraftReply={() =>
            deliver(origin, { kind: 'agent', agentId: 'reply' },
              { threadId, from, subject, summary, category, priority })
          }
        />
      )
    },
  },
]

export const leadInboxHitl: HitlSpec[] = [
  {
    toolName: 'saveDraft',
    parameters: z.object({ threadId: z.string(), body: z.string() }),
    render: ({ args, status, respond }, registry) => {
      if (args.threadId === undefined || args.body === undefined) return <></>
      const Approval = registry['ApprovalDialog']
      return (
        <Approval
          data={{ threadId: args.threadId, body: args.body }}
          onApprove={() => { if (status === 'executing' && respond) void respond('approved') }}
        />
      )
    },
  },
]
```

- [ ] **Step 4: Typecheck (will fail until Task 4 defines `renderSpecs`)**

Run: `yarn typecheck`
Expected: FAIL — `Cannot find module '../../client/src/renderSpecs'`. This is expected; Task 4
creates it. Do not fix here.

- [ ] **Step 5: Commit (WIP — compiles after Task 4)**

```bash
git add apps/inbox/workflows/lead-inbox
git commit -m "feat(lead-inbox): workflow module — descriptor, server bindings, render specs"
```

---

## Task 3: github-triage workflow module

**Files:**
- Create: `apps/inbox/workflows/github-triage/descriptor.ts`, `.../server.ts`, `.../client.tsx`

- [ ] **Step 1: Create the descriptor (defs move here)**

```ts
// apps/inbox/workflows/github-triage/descriptor.ts
import { defineAgent, defineWorkflow } from '@atizar/core'

export const triageAgent = defineAgent({
  id: 'triage', name: 'TRIAGE', provider: 'claude-cli',
  instructions: 'Read the user’s open tickets on the project board and recommend how to route each.',
  tools: ['list_my_tickets', 'get_ticket', 'render_triage'],
  approvals: [], renders: { render_triage: 'TriageCard' },
  handoffs: ['feature', 'bugfix', 'reply-draft'],
})
export const featureAgent = defineAgent({
  id: 'feature', name: 'FEATURE AGENT', provider: 'claude-cli',
  instructions: 'Analyze a feature-request ticket routed to you and produce a short plan.',
  tools: ['render_ticket_result'], approvals: [], renders: { render_ticket_result: 'TicketResultCard' },
})
export const bugfixAgent = defineAgent({
  id: 'bugfix', name: 'BUG-FIX AGENT', provider: 'claude-cli',
  instructions: 'Investigate a bug ticket routed to you and produce a short analysis.',
  tools: ['render_ticket_result'], approvals: [], renders: { render_ticket_result: 'TicketResultCard' },
})
export const replyDraftAgent = defineAgent({
  id: 'reply-draft', name: 'REPLY DRAFT', provider: 'claude-cli',
  instructions: 'Draft a suggested reply to the last comment on a routed ticket. Never post.',
  tools: ['render_reply_draft'], approvals: [], renders: { render_reply_draft: 'ReplyDraftCard' },
})

export const githubTriage = defineWorkflow({
  id: 'github-triage', label: 'GitHub triage', iconName: 'git',
  agents: [
    { agent: triageAgent, role: 'input' },
    { agent: featureAgent, role: 'worker' },
    { agent: bugfixAgent, role: 'worker' },
    { agent: replyDraftAgent, role: 'worker' },
  ],
  entryAgentId: triageAgent.id,
  inputs: [], // triage reads the board itself; no cross-workflow inbound parcel
})

export const githubTriageAgents = [triageAgent, featureAgent, bugfixAgent, replyDraftAgent]
```

- [ ] **Step 2: Create the server bindings**

```ts
// apps/inbox/workflows/github-triage/server.ts
import { createTriagePrompts } from '../../agents/triage.prompts.js'
import { createTicketPrompts } from '../../agents/ticket.prompts.js'
import type { ServerBinding } from '../lead-inbox/server.js'
import { triageAgent, featureAgent, bugfixAgent, replyDraftAgent } from './descriptor.js'

export const githubTriageServer = (origin: string): ServerBinding[] => [
  {
    agentId: triageAgent.id,
    prompts: createTriagePrompts(triageAgent.instructions, origin),
    allowedTools: ['mcp__github__list_my_tickets', 'mcp__github__get_ticket', 'mcp__github__render_triage'],
  },
  {
    agentId: featureAgent.id,
    prompts: createTicketPrompts(featureAgent.instructions, { renderTool: 'render_ticket_result', kind: 'feature' }),
    allowedTools: ['mcp__github__render_ticket_result'],
  },
  {
    agentId: bugfixAgent.id,
    prompts: createTicketPrompts(bugfixAgent.instructions, { renderTool: 'render_ticket_result', kind: 'bug' }),
    allowedTools: ['mcp__github__render_ticket_result'],
  },
  {
    agentId: replyDraftAgent.id,
    prompts: createTicketPrompts(replyDraftAgent.instructions, { renderTool: 'render_reply_draft', kind: 'reply' }),
    allowedTools: ['mcp__github__render_reply_draft'],
  },
]
```

- [ ] **Step 3: Create the client render specs + META**

```tsx
// apps/inbox/workflows/github-triage/client.tsx
import { z } from 'zod'
import type { RenderSpec, AgentMeta } from '../../client/src/renderSpecs'
import type { TriageTicket } from '../../client/src/buckets'
import type { TicketHandoffPayload } from '@atizar/core'
import { triageAgent, featureAgent, bugfixAgent, replyDraftAgent } from './descriptor'

export const githubTriageMeta: Record<string, AgentMeta> = {
  [triageAgent.id]: { subtitle: 'Reads your board, recommends routing', iconName: 'git', intro: 'Reading your board and triaging your open tickets…' },
  [featureAgent.id]: { subtitle: 'Plans a routed feature ticket', iconName: 'wrench', intro: 'Analyzing the routed ticket as a feature and drafting a plan…' },
  [bugfixAgent.id]: { subtitle: 'Analyzes a routed bug ticket', iconName: 'bug', intro: 'Investigating the routed ticket as a bug…' },
  [replyDraftAgent.id]: { subtitle: 'Drafts a suggested reply (never posts)', iconName: 'pen', intro: 'Drafting a suggested reply to the routed ticket…' },
}

const lastCommentSchema = z.object({ author: z.string(), body: z.string() }).nullable()
const ticketSchema = z.object({
  repo: z.string(), number: z.number(), title: z.string(), status: z.string(),
  priority: z.string(), body: z.string(), url: z.string(), lastComment: lastCommentSchema,
  needsReply: z.boolean(), recommendation: z.string(),
})

const toPayload = (t: TriageTicket): TicketHandoffPayload => ({
  repo: t.repo, number: t.number, title: t.title, status: t.status, priority: t.priority,
  body: t.body, lastComment: t.lastComment, recommendation: t.recommendation, url: t.url,
})

export const githubTriageRenders: RenderSpec[] = [
  {
    toolName: 'render_triage',
    parameters: z.object({ origin: z.string(), tickets: z.array(ticketSchema) }),
    render: ({ parameters }, deliver, registry) => {
      const { origin, tickets } = parameters
      if (origin === undefined || tickets === undefined) return <></>
      const Triage = registry['TriageCard']
      return (
        <Triage
          tickets={tickets}
          onRoute={(target: string, ticket: TriageTicket) =>
            deliver(origin, { kind: 'agent', agentId: target }, toPayload(ticket))
          }
        />
      )
    },
  },
  {
    toolName: 'render_ticket_result',
    parameters: z.object({ title: z.string(), kind: z.string(), analysis: z.string() }),
    render: ({ parameters }, _deliver, registry) => {
      const { title, kind, analysis } = parameters
      if (title === undefined || kind === undefined || analysis === undefined) return <></>
      const Result = registry['TicketResultCard']
      return <Result data={{ title, kind, analysis }} />
    },
  },
  {
    toolName: 'render_reply_draft',
    parameters: z.object({ title: z.string(), draft: z.string() }),
    render: ({ parameters }, _deliver, registry) => {
      const { title, draft } = parameters
      if (title === undefined || draft === undefined) return <></>
      const Reply = registry['ReplyDraftCard']
      return <Reply data={{ title, draft }} />
    },
  },
]
```

- [ ] **Step 4: Commit (WIP)**

```bash
git add apps/inbox/workflows/github-triage
git commit -m "feat(github-triage): workflow module — descriptor, server bindings, render specs"
```

---

## Task 4: render-spec types + the descriptor/client registries

Define the `RenderSpec`/`HitlSpec`/`AgentMeta` contract the modules import, and the two registries
that aggregate the workflow modules.

**Files:**
- Create: `apps/inbox/client/src/renderSpecs.ts`, `apps/inbox/workflows/index.ts`
- Modify: `apps/inbox/client/src/workflows.ts`

- [ ] **Step 1: Create the render-spec contract**

```ts
// apps/inbox/client/src/renderSpecs.ts
import type { ReactElement } from 'react'
import type { z } from 'zod'
import type { Destination } from '@atizar/core'
import type { IconName } from './components/Icon'
import { renderRegistry } from './renderRegistry'

export type AgentMeta = { subtitle: string; iconName: IconName; intro: string }
export type DeliverFn = (origin: string, dest: Destination, payload: unknown) => void
export type Registry = typeof renderRegistry

// A pure render tool (generative UI). `render` may call `deliver` for handoff cards.
export type RenderSpec = {
  toolName: string
  parameters: z.ZodTypeAny
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render: (ctx: { parameters: any }, deliver: DeliverFn, registry: Registry) => ReactElement
}

// A human-in-the-loop tool (pauses the run for approval).
export type HitlSpec = {
  toolName: string
  parameters: z.ZodTypeAny
  render: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ctx: { args: any; status: string; respond?: (v: string) => void | Promise<void> },
    registry: Registry
  ) => ReactElement
}
```

- [ ] **Step 2: Create the core-layer descriptor registry**

```ts
// apps/inbox/workflows/index.ts
import type { WorkflowDescriptor } from '@atizar/core'
import { leadInbox } from './lead-inbox/descriptor.js'
import { githubTriage } from './github-triage/descriptor.js'

// Add a workflow = import its descriptor and add it here. Nothing else in this file.
export const workflowDescriptors: WorkflowDescriptor[] = [leadInbox, githubTriage]
```

- [ ] **Step 3: Replace the client workflows registry**

```ts
// apps/inbox/client/src/workflows.ts
import type { ComponentType } from 'react'
import type { WorkflowDescriptor } from '@atizar/core'
import { workflowDescriptors } from '../../workflows'
import type { AgentMeta, RenderSpec, HitlSpec } from './renderSpecs'
import { leadInboxMeta, leadInboxRenders, leadInboxHitl } from '../../workflows/lead-inbox/client'
import { githubTriageMeta, githubTriageRenders } from '../../workflows/github-triage/client'

export type { AgentMeta }

// Optional per-workflow view override; default shell view is used when absent.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WorkflowView = ComponentType<any>

export const workflows: WorkflowDescriptor[] = workflowDescriptors

// Client chrome, keyed by agent id, merged across modules (ids are globally unique).
export const META: Record<string, AgentMeta> = { ...leadInboxMeta, ...githubTriageMeta }

// Render specs, deduped by tool name (a reused agent registers its render only once).
const allRenders: RenderSpec[] = [...leadInboxRenders, ...githubTriageRenders]
const allHitl: HitlSpec[] = [...leadInboxHitl]
const byName = <T extends { toolName: string }>(specs: T[]): T[] => {
  const seen = new Set<string>()
  return specs.filter((s) => (seen.has(s.toolName) ? false : (seen.add(s.toolName), true)))
}
export const renderSpecs: RenderSpec[] = byName(allRenders)
export const hitlSpecs: HitlSpec[] = byName(allHitl)

// Optional view overrides per workflow id (none yet — all use the shared two-panel view).
export const workflowViews: Record<string, WorkflowView> = {}
```

- [ ] **Step 4: Typecheck**

Run: `yarn typecheck`
Expected: errors only in `server/index.ts`, `InboxView.tsx`, `actions.tsx`, `githubActions.tsx`
(still referencing the old `inbox.agent`/`github.agent`). Those are rewired in Tasks 6–10. The
`workflows/*` and `renderSpecs.ts` files must typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/client/src/renderSpecs.ts apps/inbox/workflows/index.ts apps/inbox/client/src/workflows.ts
git commit -m "feat(client): render-spec contract + descriptor/client workflow registries"
```

---

## Task 5: `origin` plumbing — MCP schemas + prompt injection

Add `origin` to the two handoff-emitting render tools and inject it from the per-instance prompt.

**Files:**
- Modify: `apps/inbox/mcp/inbox-tools.mjs:34-42`, `apps/inbox/mcp/github-tools.mjs:156-160`
- Modify: `apps/inbox/agents/qualifier.prompts.ts`, `apps/inbox/agents/triage.prompts.ts`

- [ ] **Step 1: Add `origin` to `renderVerdict` MCP input schema**

```js
// apps/inbox/mcp/inbox-tools.mjs — inside registerTool('renderVerdict', { inputSchema: {...} })
    inputSchema: {
      origin: z.string(),
      threadId: z.string(),
      from: z.string(),
      subject: z.string(),
      summary: z.string(),
      category: z.string(),
      priority: z.string(),
      reason: z.string(),
    },
```

- [ ] **Step 2: Add `origin` to `render_triage` MCP input schema**

```js
// apps/inbox/mcp/github-tools.mjs — render_triage
    inputSchema: { origin: z.string(), tickets: z.array(z.object(ticketShape)) },
```

- [ ] **Step 3: Inject `origin` from the triage prompt**

```ts
// apps/inbox/agents/triage.prompts.ts
function triageFirst(instructions: string, origin: string): string {
  return [
    instructions,
    '',
    'Call list_my_tickets to read the user’s open board tickets. Each ticket has',
    '{ repo, number, title, status, priority, body, url, lastComment, needsReply }.',
    'For EACH ticket, decide a routing recommendation — one of:',
    '- "feature": a feature/enhancement request to analyze,',
    '- "bugfix": a bug to investigate,',
    '- "reply": needsReply is true / the last comment asks the user something.',
    `Then call render_triage with { origin: "${origin}", tickets } — set origin to`,
    `EXACTLY "${origin}", pass every ticket through UNCHANGED, and add a`,
    '"recommendation" field to each. Do not drop or invent tickets.',
    'After render_triage, STOP: reply with at most ONE short sentence. Do NOT list or',
    'summarize the tickets again (the card already shows them) and do not narrate tools —',
    'repeating them wastes time and can stall the run.',
  ].join('\n')
}

export function createTriagePrompts(instructions: string, origin: string): PromptStrategy {
  return { buildFirst: () => triageFirst(instructions, origin) }
}
```

- [ ] **Step 4: Inject `origin` from the qualifier prompt + accept a handed-off lead**

```ts
// apps/inbox/agents/qualifier.prompts.ts
import type { RunAgentInput } from '@ag-ui/client'
import { decodeHandoff, HandoffPayloadSchema, type PromptStrategy } from '@atizar/core'

function fromInbox(instructions: string, origin: string): string {
  return [
    instructions,
    '',
    'Call get_latest_email to read the single most recent email in the inbox',
    '(it returns { threadId, from, subject, body }). Classify the lead, then call',
    `renderVerdict with { origin: "${origin}", threadId, from, subject, summary, category, priority, reason }:`,
    `- origin: EXACTLY "${origin}"`,
    '- category: one of "sales", "support", "spam", "other"',
    '- priority: one of "hot", "warm", "cold"',
    '- summary: one sentence on what the email asks for',
    '- reason: one sentence on why you classified it this way.',
    'threadId, from and subject come from get_latest_email. Do NOT draft a reply and',
    'do NOT save anything. Do not narrate your tool usage or mention tools/schemas —',
    'keep any text brief and user-facing.',
  ].join('\n')
}

function fromHandedLead(
  instructions: string, origin: string,
  lead: { threadId: string; from: string; subject: string; summary: string; category: string; priority: string }
): string {
  return [
    instructions,
    '',
    'A lead was routed to you from another workflow — do NOT read the inbox.',
    `Lead: from ${lead.from}, subject "${lead.subject}". Context: ${lead.summary}.`,
    'Re-qualify it, then call renderVerdict with',
    `{ origin: "${origin}", threadId: "${lead.threadId}", from, subject, summary, category, priority, reason }.`,
    `Set origin to EXACTLY "${origin}". Keep any text brief and user-facing; do not narrate tools.`,
  ].join('\n')
}

export function createQualifierPrompts(instructions: string, origin: string): PromptStrategy {
  return {
    buildFirst(input: RunAgentInput): string {
      const lead = decodeHandoff(input, HandoffPayloadSchema)
      return lead ? fromHandedLead(instructions, origin, lead) : fromInbox(instructions, origin)
    },
  }
}
```

- [ ] **Step 5: Update the qualifier prompt test signature**

Open `apps/inbox/agents/qualifier.prompts.test.ts`; every `createQualifierPrompts(x)` call becomes
`createQualifierPrompts(x, 'lead-inbox')`, and assert the first-prompt text contains
`origin: "lead-inbox"`. Same shape for `triage.prompts.test.ts`
(`createTriagePrompts(x, 'github-triage')`).

- [ ] **Step 6: Run the affected tests**

Run: `yarn test apps/inbox/agents/qualifier.prompts.test.ts apps/inbox/agents/triage.prompts.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/inbox/mcp/inbox-tools.mjs apps/inbox/mcp/github-tools.mjs apps/inbox/agents/qualifier.prompts.ts apps/inbox/agents/triage.prompts.ts apps/inbox/agents/qualifier.prompts.test.ts apps/inbox/agents/triage.prompts.test.ts
git commit -m "feat: thread origin through renderVerdict/render_triage; qualifier accepts a handed lead"
```

---

## Task 6: Server — register per instance id from the registry

**Files:**
- Create: `apps/inbox/server/workflows.ts`
- Modify: `apps/inbox/server/index.ts`
- Delete: `apps/inbox/agents/inbox.agent.ts`, `apps/inbox/agents/github.agent.ts`

- [ ] **Step 1: Create the server-bindings registry**

```ts
// apps/inbox/server/workflows.ts
import { leadInbox } from '../workflows/lead-inbox/descriptor.js'
import { githubTriage } from '../workflows/github-triage/descriptor.js'
import { leadInboxServer } from '../workflows/lead-inbox/server.js'
import { githubTriageServer } from '../workflows/github-triage/server.js'
import type { ServerBinding } from '../workflows/lead-inbox/server.js'
import type { WorkflowDescriptor } from '@atizar/core'

export type WorkflowServer = { descriptor: WorkflowDescriptor; bindings: (origin: string) => ServerBinding[] }

// Add a workflow = add one entry here.
export const workflowServers: WorkflowServer[] = [
  { descriptor: leadInbox, bindings: leadInboxServer },
  { descriptor: githubTriage, bindings: githubTriageServer },
]
```

- [ ] **Step 2: Rewrite `server/index.ts`**

```ts
// apps/inbox/server/index.ts
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { CopilotRuntime, createCopilotEndpoint, InMemoryAgentRunner } from '@copilotkit/runtime/v2'
import { instanceId } from '@atizar/core'
import { providerRegistry } from './providers.js'
import { buildAgent } from './build-agent.js'
import { workflowServers } from './workflows.js'

// Wiring-time check: a passport must not hand off to an agent absent from its own workflow.
for (const { descriptor } of workflowServers) {
  const ids = new Set(descriptor.agents.map((a) => a.agent.id))
  for (const { agent } of descriptor.agents) {
    for (const target of agent.handoffs ?? []) {
      if (!ids.has(target)) {
        throw new Error(`Agent "${agent.id}" in "${descriptor.id}" hands off to unknown agent "${target}"`)
      }
    }
  }
}

// Register EVERY workflow × agent under its instance id. The same agent placed in
// two workflows becomes two independently routable runtime agents (stateless re-prime,
// no server session — so they never share state).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const agents: Record<string, any> = {}
for (const { descriptor, bindings } of workflowServers) {
  const byId = new Map(descriptor.agents.map((a) => [a.agent.id, a.agent]))
  for (const b of bindings(descriptor.id)) {
    const def = byId.get(b.agentId)
    if (!def) throw new Error(`server binding for unknown agent "${b.agentId}" in "${descriptor.id}"`)
    agents[instanceId(descriptor.id, b.agentId)] = buildAgent(def, b.prompts, providerRegistry, b.allowedTools)
  }
}

const runtime = new CopilotRuntime({ agents, runner: new InMemoryAgentRunner() })

const copilot = createCopilotEndpoint({ runtime, basePath: '/api/copilotkit', mode: 'single-route' })
const app = new Hono()
app.route('/', copilot)
serve({ fetch: app.fetch, port: 4000 })
console.log('server on http://localhost:4000')
```

- [ ] **Step 3: Delete the old flat agent files**

```bash
git rm apps/inbox/agents/inbox.agent.ts apps/inbox/agents/github.agent.ts
```

Then fix any test that imported them: `apps/inbox/agents/inbox.agent.test.ts` and
`github.agent.test.ts` should import the defs from the new descriptors
(`../workflows/lead-inbox/descriptor` / `../workflows/github-triage/descriptor`) — update the import
paths only; the assertions are unchanged.

- [ ] **Step 4: Run server-side tests + typecheck the server project**

Run: `yarn test apps/inbox/agents` then `yarn typecheck`
Expected: agent tests PASS; typecheck still fails only in the client (`InboxView.tsx`,
`actions.tsx`, `githubActions.tsx`) — rewired next.

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/server apps/inbox/agents
git commit -m "feat(server): register agents per instance id from the workflow registry"
```

---

## Task 7: Client — `deliver` resolution helpers (pure, TDD)

The pure part of delivery: resolve a `Destination` + `origin` to a target instance id, validating
cross-workflow contracts. The shell (Task 9) wraps this with the seed+run side effects.

**Files:**
- Create: `apps/inbox/client/src/deliver.ts`, `apps/inbox/client/src/deliver.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/inbox/client/src/deliver.test.ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineAgent, defineWorkflow } from '@atizar/core'
import { resolveDelivery } from './deliver'

const mk = (id: string, role: 'input' | 'worker', handoffs: string[] = []) => ({
  agent: defineAgent({ id, name: id, provider: 'mock', instructions: 'x', tools: ['t'], approvals: [], renders: {}, handoffs }),
  role,
})
const A = defineWorkflow({
  id: 'a', label: 'A', iconName: 'inbox',
  agents: [mk('q', 'input', ['r']), mk('r', 'worker')], entryAgentId: 'q', inputs: [],
})
const B = defineWorkflow({
  id: 'b', label: 'B', iconName: 'git',
  agents: [mk('in', 'input')], entryAgentId: 'in',
  inputs: [{ name: 'lead', schema: z.object({ x: z.string() }), agentId: 'in' }],
})
const wfs = [A, B]

describe('resolveDelivery', () => {
  it('resolves an intra-workflow agent destination to an instance id', () => {
    const r = resolveDelivery(wfs, 'a', { kind: 'agent', agentId: 'r' }, { any: 1 })
    expect(r).toEqual({ ok: true, instanceId: 'a__r' })
  })
  it('resolves a valid cross-workflow contract to the bound input instance', () => {
    const r = resolveDelivery(wfs, 'a', { kind: 'contract', workflow: 'b', input: 'lead' }, { x: 'hi' })
    expect(r).toEqual({ ok: true, instanceId: 'b__in', targetWorkflow: 'b' })
  })
  it('rejects an unknown contract input name', () => {
    const r = resolveDelivery(wfs, 'a', { kind: 'contract', workflow: 'b', input: 'nope' }, { x: 'hi' })
    expect(r.ok).toBe(false)
  })
  it('rejects a payload that fails the contract schema', () => {
    const r = resolveDelivery(wfs, 'a', { kind: 'contract', workflow: 'b', input: 'lead' }, { x: 123 })
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run it; verify it fails**

Run: `yarn test apps/inbox/client/src/deliver.test.ts`
Expected: FAIL — `resolveDelivery` is not exported.

- [ ] **Step 3: Implement**

```ts
// apps/inbox/client/src/deliver.ts
import type { Destination, WorkflowDescriptor } from '@atizar/core'
import { instanceId } from '@atizar/core'

export type DeliveryResult =
  | { ok: true; instanceId: string; targetWorkflow?: string }
  | { ok: false; error: string }

// Pure resolution of a delivery. Intra-workflow → instance in the origin workflow.
// Cross-workflow → the target's published input contract, validated by its schema;
// resolves to the PRIVATE bound input agent (the caller never names it).
export function resolveDelivery(
  workflows: WorkflowDescriptor[],
  origin: string,
  dest: Destination,
  payload: unknown
): DeliveryResult {
  if (dest.kind === 'agent') {
    return { ok: true, instanceId: instanceId(origin, dest.agentId) }
  }
  const wf = workflows.find((w) => w.id === dest.workflow)
  if (!wf) return { ok: false, error: `unknown workflow "${dest.workflow}"` }
  const input = wf.inputs.find((i) => i.name === dest.input)
  if (!input) return { ok: false, error: `workflow "${dest.workflow}" has no input "${dest.input}"` }
  if (!input.schema.safeParse(payload).success) {
    return { ok: false, error: `payload does not match contract "${dest.workflow}.${dest.input}"` }
  }
  return { ok: true, instanceId: instanceId(wf.id, input.agentId), targetWorkflow: wf.id }
}
```

- [ ] **Step 4: Run; verify pass**

Run: `yarn test apps/inbox/client/src/deliver.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/client/src/deliver.ts apps/inbox/client/src/deliver.test.ts
git commit -m "feat(client): pure deliver resolution (intra + cross-workflow contract)"
```

---

## Task 8: Client — single dedup render registration hook

Replace `useInboxActions`/`useGithubActions` with one hook that registers each unique render/HITL
tool once, reading `origin` from params and calling `deliver`.

**Files:**
- Create: `apps/inbox/client/src/useWorkflowRenders.tsx`
- Delete: `apps/inbox/client/src/actions.tsx`, `apps/inbox/client/src/githubActions.tsx`

- [ ] **Step 1: Implement the hook**

```tsx
// apps/inbox/client/src/useWorkflowRenders.tsx
import { useRenderTool, useHumanInTheLoop } from '@copilotkit/react-core/v2'
import { renderRegistry } from './renderRegistry'
import { renderSpecs, hitlSpecs } from './workflows'
import type { DeliverFn } from './renderSpecs'

// Registers every unique render/HITL tool ONCE (specs are module-static, so the hook
// order is stable across renders — safe to loop). The shared closure reads origin from
// the tool params, so a reused agent's card routes its handoff to the right copy.
export const useWorkflowRenders = (deliver: DeliverFn) => {
  renderSpecs.forEach((spec) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useRenderTool(
      {
        name: spec.toolName,
        parameters: spec.parameters,
        render: (ctx) => spec.render(ctx, deliver, renderRegistry),
      },
      [deliver]
    )
  })
  hitlSpecs.forEach((spec) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useHumanInTheLoop(
      {
        name: spec.toolName,
        parameters: spec.parameters,
        render: (ctx) => spec.render(ctx, renderRegistry),
      },
      []
    )
  })
}
```

Note: the `forEach` loop calls hooks, but `renderSpecs`/`hitlSpecs` are module-level constants of
fixed length/order, so hook order is stable — the `rules-of-hooks` disable is correct and safe here.

- [ ] **Step 2: Delete the old action hooks**

```bash
git rm apps/inbox/client/src/actions.tsx apps/inbox/client/src/githubActions.tsx
```

- [ ] **Step 3: Typecheck**

Run: `yarn typecheck`
Expected: errors now only in `InboxView.tsx` (still imports the deleted hooks / old registry shape)
— fixed in Task 9.

- [ ] **Step 4: Commit**

```bash
git add apps/inbox/client/src/useWorkflowRenders.tsx apps/inbox/client/src/actions.tsx apps/inbox/client/src/githubActions.tsx
git commit -m "feat(client): single dedup render registration via workflow render specs"
```

---

## Task 9: Client — the shell (all-mounted, global handles, deliver, no auto-open)

**Files:**
- Modify: `apps/inbox/client/src/InboxView.tsx`
- Modify: `apps/inbox/client/src/components/AgentModal.tsx` (HandoffNote + Open-in button)

- [ ] **Step 1: Extend `HandoffNote` with an optional target workflow**

```tsx
// apps/inbox/client/src/components/AgentModal.tsx — update the type and the note row
export type HandoffNote = {
  dir: 'sent' | 'received'
  otherName: string
  label: string
  targetWorkflow?: string // present on a cross-workflow 'sent' note
}
```

Add an `onOpenWorkflow?: (id: string) => void` prop to `AgentModal`. In the note row, when
`note.dir === 'sent' && note.targetWorkflow`, render a button
`<button onClick={() => onOpenWorkflow?.(note.targetWorkflow!)}>Open in {note.targetWorkflow}</button>`.
(Match the existing note markup/classnames in the file.)

- [ ] **Step 2: Rewrite `InboxView.tsx` as the shell**

```tsx
// apps/inbox/client/src/InboxView.tsx
import { useCallback, useMemo, useRef, useState } from 'react'
import { useCopilotKit, useRenderToolCall } from '@copilotkit/react-core/v2'
import { instanceId, encodeHandoff, type Destination, type Message } from '@atizar/core'
import { useWorkflowRenders } from './useWorkflowRenders'
import { resolveDelivery } from './deliver'
import { AgentCard } from './components/AgentCard'
import { AgentModal, type HandoffNote } from './components/AgentModal'
import { AgentRuntime, type AgentHandle } from './components/AgentRuntime'
import { PipelineColumn } from './components/PipelineColumn'
import { WorkflowSwitcher } from './components/WorkflowSwitcher'
import { Icon } from './components/Icon'
import type { PipelineNode } from './pipeline'
import type { Status } from './status'
import { workflows, META } from './workflows'

export const InboxView = () => {
  const { copilotkit } = useCopilotKit()
  const [activeWorkflowId, setActiveWorkflowId] = useState(workflows[0].id)
  const [openId, setOpenId] = useState<string | null>(null) // instance id
  const [handles, setHandles] = useState<Record<string, AgentHandle>>({}) // keyed by instance id
  const [handoffNotes, setHandoffNotes] = useState<Record<string, HandoffNote[]>>({})
  const [unread, setUnread] = useState<Record<string, number>>({}) // workflow id -> badge count

  const workflow = workflows.find((w) => w.id === activeWorkflowId) ?? workflows[0]

  const onAgentChange = useCallback((id: string, handle: AgentHandle) => {
    setHandles((prev) => {
      const cur = prev[id]
      if (cur && cur.agent === handle.agent && cur.status === handle.status) return prev
      return { ...prev, [id]: handle }
    })
  }, [])

  const handlesRef = useRef(handles)
  handlesRef.current = handles
  // Mirror the active workflow so the STABLE deliver callback can read it without a
  // dep. CRITICAL: useRenderTool captures its render closure (and thus deliver) ONCE
  // — a deliver with `activeWorkflowId` in deps would freeze the initial value and the
  // badge check would always compare against the first workflow. Read it via this ref.
  const activeRef = useRef(activeWorkflowId)
  activeRef.current = activeWorkflowId

  // The one delivery seam. MUST be stable (empty-ish deps): useRenderTool captures it
  // once. Resolves the target, seeds + runs it in the BACKGROUND. Never opens a modal;
  // never switches the workflow.
  const deliver = useCallback(
    (origin: string, dest: Destination, payload: unknown) => {
      const r = resolveDelivery(workflows, origin, dest, payload)
      if (!r.ok) {
        console.warn('delivery rejected:', r.error)
        return
      }
      const target = handlesRef.current[r.instanceId]?.agent
      if (!target) return
      target.messages.splice(0, target.messages.length, encodeHandoff(payload) as Message)
      void copilotkit.runAgent({ agent: target })

      // Record the note on the source side (target side gets a 'received' note too).
      const p = payload as { number?: number; title?: string; subject?: string }
      const label =
        typeof p.number === 'number' ? `#${p.number} ${p.title ?? ''}`.trim() : (p.subject ?? 'item')
      const sourceInstance = instanceId(origin, sourceAgentOf(origin, dest))
      setHandoffNotes((prev) => ({
        ...prev,
        [sourceInstance]: [
          ...(prev[sourceInstance] ?? []),
          { dir: 'sent', otherName: r.instanceId, label, targetWorkflow: r.targetWorkflow },
        ],
        [r.instanceId]: [
          ...(prev[r.instanceId] ?? []),
          { dir: 'received', otherName: origin, label },
        ],
      }))
      if (r.targetWorkflow && r.targetWorkflow !== activeRef.current) {
        setUnread((u) => ({ ...u, [r.targetWorkflow!]: (u[r.targetWorkflow!] ?? 0) + 1 }))
      }
    },
    [copilotkit]
  )

  useWorkflowRenders(deliver)
  const renderToolCall = useRenderToolCall()

  const iid = (agentId: string) => instanceId(workflow.id, agentId)
  const statusOf = (instId: string): Status => handles[instId]?.status ?? 'idle'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agentOf = (instId: string): any => handles[instId]?.agent
  const canStart = (agentId: string) =>
    workflow.agents.find((a) => a.agent.id === agentId)?.role === 'input'

  const pipelineNodes: PipelineNode[] = workflow.agents.map(({ agent }) => ({
    id: agent.id,
    name: agent.name,
    subtitle: META[agent.id].subtitle,
    iconName: META[agent.id].iconName,
    status: statusOf(iid(agent.id)),
    handoffsTo: agent.handoffs ?? [],
  }))

  const openAgent = openId ? workflow.agents.find((a) => iid(a.agent.id) === openId) : undefined

  // Every workflow × agent is mounted idle for the whole session (keyed by instance id),
  // so a cross-workflow delivery target always exists — no mount-then-run race.
  const allRuntimes = useMemo(
    () =>
      workflows.flatMap((wf) =>
        wf.agents.map(({ agent }) => ({ id: instanceId(wf.id, agent.id), def: agent }))
      ),
    []
  )

  const switchWorkflow = (id: string) => {
    setOpenId(null)
    setUnread((u) => ({ ...u, [id]: 0 }))
    setActiveWorkflowId(id)
  }

  return (
    <>
      {allRuntimes.map(({ id, def }) => (
        <AgentRuntime key={id} def={{ ...def, id }} onChange={onAgentChange} />
      ))}

      <WorkflowSwitcher workflows={workflows} activeId={activeWorkflowId} unread={unread} onSelect={switchWorkflow} />

      <div className='workspace-body'>
        <PipelineColumn nodes={pipelineNodes} onOpen={(agentId) => setOpenId(iid(agentId))} />
        <div className='main'>
          <div className='comp-head'>
            <span className='ch-label'><Icon name='layers' size={14} />Your agents</span>
            <span className='ch-spacer' />
          </div>
          <div className='main-scroll'>
            <div className='agent-grid'>
              {workflow.agents.map(({ agent }) => {
                const a = agentOf(iid(agent.id))
                return (
                  <AgentCard
                    key={agent.id}
                    name={agent.name}
                    subtitle={META[agent.id].subtitle}
                    iconName={META[agent.id].iconName}
                    status={statusOf(iid(agent.id))}
                    canStart={canStart(agent.id)}
                    onStart={() => a && void copilotkit.runAgent({ agent: a })}
                    onOpen={() => setOpenId(iid(agent.id))}
                  />
                )
              })}
            </div>
          </div>
        </div>

        {openAgent && agentOf(iid(openAgent.agent.id)) && (
          <AgentModal
            agent={agentOf(iid(openAgent.agent.id))}
            title={openAgent.agent.name}
            iconName={META[openAgent.agent.id].iconName}
            status={statusOf(iid(openAgent.agent.id))}
            renderToolCall={renderToolCall}
            loading={statusOf(iid(openAgent.agent.id)) === 'running'}
            canStart={canStart(openAgent.agent.id)}
            intro={META[openAgent.agent.id].intro}
            notes={handoffNotes[iid(openAgent.agent.id)] ?? []}
            onOpenWorkflow={switchWorkflow}
            onStart={() => {
              const a = agentOf(iid(openAgent.agent.id))
              if (a) void copilotkit.runAgent({ agent: a })
            }}
            onClose={() => setOpenId(null)}
          />
        )}
      </div>
    </>
  )
}

// The source agent for a destination: for an intra handoff it is the agent in the
// origin workflow whose handoffs include the target; for a contract it is the origin's
// entry agent (the card that emitted the delivery lives there).
function sourceAgentOf(origin: string, dest: Destination): string {
  const wf = workflows.find((w) => w.id === origin)!
  if (dest.kind === 'agent') {
    return wf.agents.find((a) => (a.agent.handoffs ?? []).includes(dest.agentId))?.agent.id ?? wf.entryAgentId
  }
  return wf.entryAgentId
}
```

Note the `AgentRuntime` receives `def={{ ...def, id }}` so its `useAgent({ agentId })` uses the
instance id — this is what makes a reused agent two independent CopilotKit instances.

- [ ] **Step 3: Update `App.tsx` default agent to the first workflow's entry instance**

```tsx
// apps/inbox/client/src/App.tsx
import { CopilotKit } from '@copilotkit/react-core/v2'
import { instanceId } from '@atizar/core'
import { InboxView } from './InboxView'
import { workflows } from './workflows'

export const App = () => {
  // CopilotKit binds its internal listeners to this default agent id; it must be one
  // we actually register. Use the first workflow's entry agent INSTANCE id.
  const defaultAgent = instanceId(workflows[0].id, workflows[0].entryAgentId)
  return (
    <CopilotKit runtimeUrl='/api/copilotkit' agent={defaultAgent}>
      <InboxView />
    </CopilotKit>
  )
}
```

- [ ] **Step 4: Typecheck + run all unit tests**

Run: `yarn typecheck && yarn test`
Expected: typecheck clean; all unit tests PASS (fix any remaining import paths in tests that
referenced the deleted `inbox.agent`/`github.agent`/`actions`).

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/client/src/InboxView.tsx apps/inbox/client/src/App.tsx apps/inbox/client/src/components/AgentModal.tsx
git commit -m "feat(client): shell — all agents mounted idle, global handles, deliver seam, no auto-open"
```

---

## Task 10: WorkflowSwitcher — unread badge per tab

**Files:**
- Modify: `apps/inbox/client/src/components/WorkflowSwitcher.tsx`

- [ ] **Step 1: Add the badge**

```tsx
// apps/inbox/client/src/components/WorkflowSwitcher.tsx
import { Icon } from './Icon'
import type { WorkflowDescriptor } from '@atizar/core'

type WorkflowSwitcherProps = {
  workflows: WorkflowDescriptor[]
  activeId: string
  unread: Record<string, number>
  onSelect: (id: string) => void
}

export const WorkflowSwitcher = ({ workflows, activeId, unread, onSelect }: WorkflowSwitcherProps) => (
  <div className='workflow-tabs'>
    {workflows.map((wf) => {
      const count = unread[wf.id] ?? 0
      return (
        <button
          key={wf.id}
          className={wf.id === activeId ? 'workflow-tab active' : 'workflow-tab'}
          onClick={() => onSelect(wf.id)}
        >
          <Icon name={wf.iconName as never} size={14} />
          {wf.label}
          {count > 0 && <span className='workflow-badge'>{count}</span>}
        </button>
      )
    })}
  </div>
)
```

- [ ] **Step 2: Add minimal badge styling**

In the client CSS (where `.workflow-tab` is styled), add a small `.workflow-badge` rule (a tinted
pill: inline-block, rounded, small font, left margin). Match the existing token palette.

- [ ] **Step 3: Typecheck + lint**

Run: `yarn typecheck && yarn lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/inbox/client/src/components/WorkflowSwitcher.tsx apps/inbox/client/src
git commit -m "feat(client): cross-workflow unread badge on the switcher"
```

---

## Task 11: Concrete cross-workflow link — route a ticket to Lead inbox

Add the real cross-workflow demo: the triage card can treat a ticket as a customer lead and deliver
it to the Lead-inbox `lead` contract. This exercises `deliver`'s contract path end to end.

**Files:**
- Modify: `apps/inbox/workflows/github-triage/client.tsx` (map ticket → lead, add destination)
- Modify: `apps/inbox/client/src/components/TriageCard.tsx` (a "Treat as lead" route option)

- [ ] **Step 1: Add a lead mapping + contract destination in the triage render**

In `github-triage/client.tsx`, extend the `render_triage` render so the card can also route to the
lead contract. Add a mapper and pass a second handler:

```tsx
import { HandoffPayloadSchema } from '@atizar/core'

const toLead = (t: TriageTicket) => ({
  threadId: t.url,
  from: t.lastComment?.author ?? 'github',
  subject: t.title,
  summary: t.recommendation,
  category: 'support',
  priority: t.priority,
})

// inside render(...) for render_triage, after computing origin/tickets:
return (
  <Triage
    tickets={tickets}
    onRoute={(target, ticket) => deliver(origin, { kind: 'agent', agentId: target }, toPayload(ticket))}
    onTreatAsLead={(ticket) =>
      deliver(origin, { kind: 'contract', workflow: 'lead-inbox', input: 'lead' }, toLead(ticket))
    }
  />
)
```

`toLead` must satisfy `HandoffPayloadSchema` (threadId, from, subject, summary, category, priority).

- [ ] **Step 2: Add the route option to `TriageCard`**

Add an optional `onTreatAsLead?: (t: TriageTicket) => void` prop and, per ticket, a small button
"Treat as lead → Lead inbox" that calls it. Match the existing route-button markup.

- [ ] **Step 3: Typecheck + lint + unit tests**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: all clean / green.

- [ ] **Step 4: Commit**

```bash
git add apps/inbox/workflows/github-triage/client.tsx apps/inbox/client/src/components/TriageCard.tsx
git commit -m "feat: cross-workflow demo — route a GitHub ticket to the Lead inbox contract"
```

---

## Task 12: Full verification — suite green + browser E2E

**Files:** none (verification only).

- [ ] **Step 1: Full suite**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: typecheck clean, lint green, all unit tests pass (the original 103 plus the new
`defineWorkflow`, `deliver` tests).

- [ ] **Step 2: Kill stale dev servers, then start fresh**

```bash
pkill -9 -f "apps/inbox/node_modules/.bin/(tsx|vite|concurrently)" || true
lsof -tiTCP:4000,:5173 | xargs kill -9 2>/dev/null || true
yarn dev
```

Confirm the boot log shows `server on http://localhost:4000` from THIS run (no `EADDRINUSE`).

- [ ] **Step 3: Browser E2E (drive the real app — mandatory per project rule)**

Verify each, in the browser:
1. **Lead inbox intra-handoff, no auto-open:** Start LEAD QUALIFIER → it qualifies → click "draft
   reply" on the verdict card. The REPLY agent must **run** (its card shows running/done) but its
   modal must **not** auto-open. Open it manually; approve a draft (Gmail draft created, never sent).
2. **GitHub triage on the real board (read-only):** Start TRIAGE → route a ticket to
   feature/bugfix/reply-draft. Target runs; **no** auto-open. Confirm the ticket's comment count is
   unchanged (read-only intact).
3. **Cross-workflow delivery:** On a triage ticket click "Treat as lead → Lead inbox". The
   LEAD QUALIFIER must run **in the background**, the active view must **stay** on GitHub triage, a
   **badge** appears on the Lead inbox tab, and the triage thread shows an "Open in lead-inbox"
   button. Click it → view switches to Lead inbox with the qualifier showing the re-qualified lead.
4. **State persistence:** switch GitHub triage ↔ Lead inbox repeatedly; each agent's conversation
   persists across switches (no reset).

- [ ] **Step 4: Update the docs**

- `HANDOFF.md`: move "workflow separation" from PLANNED to a BUILT entry (modules, roles, contract
  door, all-mounted, instance reuse, no auto-open/auto-switch, the ticket→lead demo).
- `docs/BUILD-LOG.md`: add §8 with the per-feature narrative.
- If any new gotcha surfaced (e.g. CopilotKit instance-id behavior), add a one-liner to
  `.claude/skills/rules/copilotkit-v2.md` and the CLAUDE.md "Don't-rediscover gotchas".

- [ ] **Step 5: Commit + finish the branch**

```bash
git add HANDOFF.md docs/BUILD-LOG.md .claude CLAUDE.md
git commit -m "docs: workflow separation built — modules, roles, cross-workflow contract"
```

Then use **superpowers:finishing-a-development-branch** to decide merge/PR.

---

## Notes for the implementer

- **Run from repo root** with yarn. `yarn install` may need `--ignore-engines` on Node 20.14.
- **`vitest` path filters** work from root: `yarn test path/to/file.test.ts`.
- **Do not set `allowJs`** in `apps/inbox/tsconfig.json` and keep `.mjs` files out of the TS
  `include` (documented boot-crash gotcha).
- **Subagents must not switch git branches** to inspect history — use `git show <sha>:path`.
- **GitHub stays strictly read-only** — this work adds no GitHub write path; the ticket→lead mapping
  only reads ticket fields already in hand.
- The render-registration loop in Task 8 calls hooks inside `forEach`; this is safe **only** because
  `renderSpecs`/`hitlSpecs` are module-level constants of fixed length and order.
