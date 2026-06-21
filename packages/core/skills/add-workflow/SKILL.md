---
name: add-workflow
description: Scaffold a new workflow in a project that uses @atizar/core — creates the ids/contracts/tools/cards consts, definePrompt blocks, the defineWorkflow/defineAgent descriptor, the ServerBinding + effects, client render/HITL specs, wires the three aggregators, writes tests, browser-verifies the HITL flow, and produces a co-located README. Use when adding, creating, scaffolding, or building a new workflow (a multi-agent automation — an inbound flow, an approval pipeline, or a qualify-and-dispatch loop) on top of the @atizar framework.
---

# Add a workflow (consumer / L2)

Task skill — owns the run end-to-end: from "I want a workflow that does X" to a typechecked,
tested, browser-verified workflow with a co-located README. Self-contained (no dependency on
superpowers or external plugins — stages are inlined below).

**Audience:** you are building a workflow in your own project that installs `@atizar/core`,
`@atizar/server`, `@atizar/react`, and optionally `@atizar/integrations`. You are NOT working
inside the framework repo itself.

**Layout:** this skill uses the **three-aggregator layout**:

- `workflows/<id>/` — the per-workflow module (you create this).
- `workflows/index.ts` — descriptor aggregator.
- `server/workflows.ts` — server-binding aggregator.
- `client/src/workflows.ts` — client render/HITL aggregator.

If these files do not exist yet, Stage 0b bootstraps them for you. If your existing layout differs,
adapt the aggregator-wiring steps at Stage 3 accordingly and leave a note at Stage 7.

---

## The shape of a workflow (read before Stage 0)

A workflow has two halves, kept strictly separate:

| Half          | What                                                | Law                                                   |
| ------------- | --------------------------------------------------- | ----------------------------------------------------- |
| **Structure** | `defineWorkflow` + `defineAgent` in `descriptor.ts` | Pure data — no turn prose, no tool literals           |
| **Words**     | `definePrompt` blocks in `prompts.ts`               | Turn-only — no agent identity, every tool via a const |

File map inside `workflows/<id>/`:

| File            | Holds                                                            |
| --------------- | ---------------------------------------------------------------- |
| `ids.ts`        | Workflow id, agent-id map, roles — all `as const`                |
| `contracts.ts`  | Zod schemas for handoff/dispatch payloads                        |
| `tools.ts`      | Tool-name const map (read tools included)                        |
| `cards.ts`      | Card/component-name const map                                    |
| `prompts.ts`    | `definePrompt` blocks — turn-only prose                          |
| `descriptor.ts` | `defineAgent` + `defineWorkflow` — structure only                |
| `server.ts`     | `ServerBinding[]` factory — prompts, allow-list, effects, health |
| `client.tsx`    | `AgentMeta` + render/HITL specs for this workflow's cards        |
| `*.test.ts`     | Drift-guard + behavior tests (drift guard is mandatory)          |
| `README.md`     | Co-located doc — what/how-to-run/credentials/gates               |

Three laws the whole pattern rests on:

1. **Turn-only prompts.** `definePrompt` returns only the words for the current turn. The agent's
   identity (`defineAgent.instructions`, composed with the workflow `prompt`) is prepended by the
   server at run time via `composeInstructions` — never re-bake it into a prompt.
2. **Consts, not literals (config-as-data).** Every tool name, agent id, and card name goes through
   an `as const` map. A raw string literal in a prompt or descriptor is a drift hazard — the drift
   guard catches it, but writing it right costs nothing.
3. **Server-executed effects.** The model proposes (calls an approval tool); the SERVER runs the
   effect when the human approves. The model never sees a mutating tool — mutation lives in
   `ServerBinding.effects`, not in the tool surface.

---

## Stage 0 — Preflight (probe, don't ask)

Read the public-SDK signatures you will call:

- `defineAgent` / `defineWorkflow` / `definePrompt` — from `@atizar/core`.
- `ServerBindingLike` / `createServer` / `buildAgentProvider` / `deriveConnectionList` — from `@atizar/server`.
- `scope` / `WorkflowsProvider` / `WorkflowsConfig` / `AgentMeta` / `RenderSpec` / `HitlSpec` — from `@atizar/react`.
- Any integration you plan to reuse — from `@atizar/integrations`.

**Read the local self-improvement notes**, if they exist, at
`.claude/atizar/add-workflow-notes.md`. Past runs may have left notes about this project's layout,
credential sources, or aggregator paths that will save time now. If the file does not exist, proceed
— it will be created at Stage 7 if something systemic surfaces.

**Detect the skeleton.** Check whether these five items exist:

| Item                                                 | What to look for                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| `workflows/index.ts`                                 | exports `workflowDescriptors`                                                    |
| `server/workflows.ts`                                | exports `workflowServers`                                                        |
| `client/src/workflows.ts` (or `client/workflows.ts`) | exports `workflowsConfig`                                                        |
| Server entry                                         | any `.ts` under `server/` that imports `createServer` from `@atizar/server`      |
| Client entry                                         | any `.tsx` under `client/` that imports `WorkflowsProvider` from `@atizar/react` |

If **all five exist** → note the actual paths and proceed to Stage 0c.

If **any of the top three aggregators are missing** → run Stage 0b (bootstrap the full skeleton
as a unit; a partial skeleton is risky). Then proceed to Stage 0c.

---

## Stage 0b — Bootstrap skeleton (only if aggregators are absent)

Create the five files below. Use the exact content from
[`references/minimal-skeleton.md`](references/minimal-skeleton.md) — it has the real template for
each file derived from the public SDK. Do NOT copy demo-app internal paths. Do NOT invent API
shapes: if `createServer`'s signature or `WorkflowsProvider`'s props are unclear, read them from
the installed `@atizar/server` and `@atizar/react` packages before writing.

Files to create (relative to the consumer project root):

1. `workflows/index.ts` — empty `workflowDescriptors = []` export.
2. `server/workflows.ts` — empty `workflowServers = []` export with the `WorkflowServer` type.
3. `client/src/workflows.ts` — empty `workflowsConfig` export with `WorkflowsProvider`-compatible
   shape.
4. `server/index.ts` (or `server/server.ts` if an entry already exists under a different name) —
   calls `createServer({ workflowServers, providerRegistry, buildProvider, ... })`. Set up a minimal
   `claude-cli` provider registry; include a `spawn` placeholder with a clear TODO comment.
5. `client/src/main.tsx` (or adapt the existing entry) — mounts `<WorkflowsProvider config={workflowsConfig}>` wrapping the consumer's board layout. Note: `@atizar/react` does NOT export a
   turnkey `BoardApp`; the consumer composes their own chrome from the exported primitives
   (`PipelineColumn`, `AgentCard`, `AgentModal`, `WorkflowSwitcher`, …).

After creating these files, confirm `yarn typecheck` (or `tsc --noEmit`) is clean before Stage 1.
If it is not clean, fix type errors before proceeding — a broken skeleton produces confusing errors
in later stages.

Tell the user what was created and that they will need to wire a real `spawn` (for `claude-cli`)
or add `ANTHROPIC_API_KEY` (for `mastra`) before Stage 5.

---

## Stage 0c — Paths confirmed

Record the actual paths for the three aggregators (they may differ from the defaults if the project
uses a monorepo layout or a `src/` prefix). These paths are used verbatim in Stage 3i.

Do NOT ask the user anything in Stage 0/0b/0c. Probe the code.

---

## Stage 1 — Intent [GATE]

In ONE message, confirm with the user:

- Workflow **id** (kebab-case, e.g. `lead-qualify`), **label** (display name), **icon name**.
- **Agent roster**: which agent is the `input` (human-started entry), which are `worker`s, and
  their plain-language role description.
- Each agent's **tool surface**:
  - Read tools → go in `readonly` (never in `tools`).
  - Surface/render tools → go in `tools` + `renders`.
  - The proposal/approval tool → goes in `tools`, `approvals`, and `effects`.
  - Dispatch tools (spawn a child work item) → go in `tools` + `dispatches`.
- **Where the human gate is** — the irreversible action (the tool that goes into `approvals` +
  `effects`). This is what the human confirms before the server acts.
- **Integrations and credentials** each agent needs.
- **Rerun / reset policy**: `rerun: 'refresh'` (re-START supersedes the prior finished run —
  default for live-source scans) or `resetOnStart: true` (clears terminal items before each
  human START — default for clean-board flows). Ask only if it matters; omit both for a simple
  single-run workflow.

Do NOT ask about file layout, const-vs-enum rules, or identity wiring — those are settled by this
skill. Wait for the user's confirmation before writing any files.

---

## Stage 2 — Integrations & credentials

For each external service the workflow needs:

1. Check if `@atizar/integrations` already has a suitable integration. If yes, import its read
   functions and `auth` spec from the subpath export (e.g. `@atizar/integrations/gmail-basic`).
2. If not, you will need a new integration module. Note what it needs to do — write it after
   the workflow scaffold is complete (this stage is planning only).
3. Establish the credential env vars the workflow uses. Name them `ATIZAR_<SERVICE>_*` (the
   framework convention). Seed your root `.env.example` with each var + a comment explaining
   where to get it.
4. **Ask the user for real credentials** (or a test account) that will be needed during Stage 5
   (browser-verify). Without them the HITL approval path cannot be verified end-to-end.

---

## Stage 3 — Scaffold + wire

Create `workflows/<id>/` with the files below, then wire the three aggregators. Use the public SDK
only — no internal framework paths.

### 3a — `ids.ts`

```ts
export const MY_WF_ID = 'my-workflow' as const

export const MY_WF_AGENTS = {
  qualifier: 'qualifier',
  worker: 'worker',
} as const
export type MyWfAgentId = (typeof MY_WF_AGENTS)[keyof typeof MY_WF_AGENTS]

export const ROLES = { input: 'input', worker: 'worker' } as const
```

`as const` is mandatory — each value must be identical to its wire string.

### 3b — `contracts.ts`

Zod schemas for every handoff/dispatch payload. They live here (not in `descriptor.ts`) so
`prompts.ts` can decode them without importing the descriptor — importing the descriptor would close
a descriptor↔prompts cycle.

```ts
import { z } from 'zod'
export const LeadRefSchema = z.object({ leadId: z.string(), name: z.string() })
export type LeadRef = z.infer<typeof LeadRefSchema>
```

### 3c — `tools.ts`

```ts
export const MY_WF_TOOLS = {
  // read tools (go into `readonly` in the descriptor, never into `tools`)
  get_lead: 'get_lead',
  // surface/render tool
  renderLead: 'renderLead',
  // approval/proposal tool (the human gate)
  submitOutcome: 'submitOutcome',
  // dispatch tool (spawns a child)
  dispatch_worker: 'dispatch_worker',
} as const
export type MyWfToolName = (typeof MY_WF_TOOLS)[keyof typeof MY_WF_TOOLS]
```

Include read tools here too — the descriptor's `readonly` arrays and the prompts both import `t`
from this file so no raw literals slip in.

### 3d — `cards.ts`

```ts
export const MY_WF_CARDS = {
  LeadCard: 'LeadCard',
  OutcomeDialog: 'OutcomeDialog',
} as const
export type MyWfCardName = (typeof MY_WF_CARDS)[keyof typeof MY_WF_CARDS]
```

### 3e — `prompts.ts`

One `definePrompt` block per agent from `@atizar/core`. Rules:

- `onStart` is required. `onInput(payload)` runs when a matching handoff decodes. `onResume(result)`
  narrates the server's executed-effect result — omit for agents that never propose a gated effect.
- Every tool name in the prose is `Call ${t.toolName}` (where `t` is imported from `tools.ts`).
  This is what the drift guard checks.
- TURN-ONLY: no agent name, no workflow rules, no identity prose in the prompt text.

```ts
import { definePrompt } from '@atizar/core'
import { MY_WF_TOOLS as t } from './tools.js'
import { LeadRefSchema, type LeadRef } from './contracts.js'

export const qualifierPrompt = definePrompt<LeadRef>({
  input: LeadRefSchema,
  onInput: (payload) =>
    `You have received lead "${payload.name}" (id: ${payload.leadId}). ` +
    `Call ${t.get_lead} to read their details, then Call ${t.renderLead} to surface a summary card. ` +
    `Finally Call ${t.submitOutcome} to propose a qualification decision for human approval.`,
  onStart: () =>
    `No lead payload received. Ask the user which lead to qualify, ` +
    `then Call ${t.get_lead} to read it, Call ${t.renderLead} to surface it, ` +
    `and Call ${t.submitOutcome} to propose a decision.`,
  onResume: (result) => ({
    prompt: `The human approved. The outcome was recorded: ${JSON.stringify(result)}. Summarize briefly.`,
  }),
})
```

### 3f — `descriptor.ts`

Structure only — `defineAgent` + `defineWorkflow` from `@atizar/core`.

```ts
import { defineAgent, defineWorkflow } from '@atizar/core'
import { MY_WF_ID, MY_WF_AGENTS as a, ROLES } from './ids.js'
import { MY_WF_TOOLS as t } from './tools.js'
import { MY_WF_CARDS as c } from './cards.js'
// Re-export contract schemas for consumers that reach for the descriptor as entry point
export { LeadRefSchema, type LeadRef } from './contracts.js'

export const qualifierAgent = defineAgent({
  id: a.qualifier,
  name: 'QUALIFIER',
  provider: 'claude-cli', // or your registered provider name
  instructions: 'You qualify inbound leads. Be concise and professional.',
  tools: [t.renderLead, t.submitOutcome, t.dispatch_worker],
  readonly: [t.get_lead],
  approvals: [t.submitOutcome],
  effects: [t.submitOutcome],
  dispatches: [t.dispatch_worker],
  renders: { [t.renderLead]: c.LeadCard, [t.submitOutcome]: c.OutcomeDialog },
  handoffs: [a.worker],
  maxInstances: 1, // singleton input agent
})

export const workerAgent = defineAgent({
  id: a.worker,
  name: 'WORKER',
  provider: 'claude-cli',
  instructions: 'You carry out the approved outcome for one lead.',
  tools: [],
  approvals: [],
  renders: {},
  maxInstances: 2,
})

export const myWorkflow = defineWorkflow({
  id: MY_WF_ID,
  label: 'Lead qualify',
  iconName: 'user-check',
  prompt:
    'You are part of a lead-qualification automation. Be concise. The human approves every outward action.',
  agents: [
    { agent: qualifierAgent, role: ROLES.input },
    { agent: workerAgent, role: ROLES.worker },
  ],
  entryAgentId: qualifierAgent.id,
  inputs: [],
  connections: [{ integration: 'crm', provider: 'your-provider' }],
  rerun: 'refresh',
})

export const myWorkflowAgents = [qualifierAgent, workerAgent]
```

### 3g — `server.ts`

Export a `ServerBinding[]` factory. Import from `@atizar/server` and your `@atizar/integrations`
module.

```ts
import { resolveCredential, atizarEnv, isDemo } from '@atizar/server'
import type { ServerBindingLike } from '@atizar/server'
import { qualifierAgent, workerAgent } from './descriptor.js'
import { qualifierPrompt, workerPrompt } from './prompts.js'

export const myWorkflowServer = (): ServerBindingLike[] => [
  {
    agentId: qualifierAgent.id,
    prompts: qualifierPrompt,
    // Fully-qualified MCP tool names: mcp__<server>__<toolName>
    // 'myapp' = your app's stdio MCP server name
    allowedTools: [
      'mcp__crm__get_lead',
      'mcp__myapp__renderLead',
      'mcp__myapp__submitOutcome',
      'mcp__myapp__dispatch_worker',
    ],
    effects: {
      submitOutcome: async (form) => {
        if (isDemo()) return { ok: true, outcomeId: 'demo-1' }
        const cred = await resolveCredential({
          integration: 'crm',
          connectionId: atizarEnv.connection(),
        })
        if (!cred) return { error: 'CRM not connected' }
        // call your integration function with the approved form args
        return { ok: true, outcomeId: String(form.outcomeId ?? '') }
      },
    },
    health: [
      {
        name: 'crm',
        check: async () => {
          const cred = await resolveCredential({
            integration: 'crm',
            connectionId: atizarEnv.connection(),
          })
          return cred
            ? { ok: true }
            : { ok: false, hint: 'Set ATIZAR_CRM_TOKEN and connect via the header' }
        },
      },
    ],
  },
  {
    agentId: workerAgent.id,
    prompts: workerPrompt,
    allowedTools: [],
  },
]
```

Key rules for `server.ts`:

- `allowedTools` is the **fully-qualified MCP tool name** (`mcp__<server>__<toolName>`). This is the
  single-point boundary — a tool not listed here cannot reach the agent.
- `effects` keys match the `approvals` in the descriptor, one-to-one.
- Effects resolve credentials, branch on `isDemo()` for a believable fake result, then call your
  integration function. They never throw — return `{ error }` on failure.

### 3h — `client.tsx`

```tsx
import type { AgentMeta, RenderSpec, HitlSpec } from '@atizar/react'
import { MY_WF_TOOLS as t } from './tools.js'
import { z } from 'zod'
import { LeadCard } from './components/LeadCard.js' // your card component
import { OutcomeDialog } from './components/OutcomeDialog.js' // your approval dialog

export const myWorkflowMeta: Record<string, AgentMeta> = {
  qualifier: {
    subtitle: 'Qualifies inbound leads',
    iconName: 'user-check',
    intro: 'Starting qualification…',
  },
  worker: { subtitle: 'Carries out approved outcomes', iconName: 'check', intro: 'Executing…' },
}

export const myWorkflowRenders: Omit<RenderSpec, 'workflowId'>[] = [
  {
    toolName: t.renderLead,
    parameters: z.object({ leadId: z.string(), name: z.string(), summary: z.string() }),
    render: ({ parameters }) => <LeadCard lead={parameters} />,
  },
]

export const myWorkflowHitl: Omit<HitlSpec, 'workflowId'>[] = [
  {
    toolName: t.submitOutcome,
    parameters: z.object({ outcomeId: z.string(), decision: z.string(), notes: z.string() }),
    render: ({ form, approve, reject }) => (
      <OutcomeDialog form={form} onApprove={approve} onReject={reject} />
    ),
  },
]
```

**The workflow registers its OWN cards.** Never rely on another workflow to register a shared
card — render/HITL resolution is scoped per workflow.

### 3i — Wire the three aggregators

Add one entry to each:

**`workflows/index.ts`**

```ts
import { myWorkflow } from './my-workflow/descriptor.js'
// add to the workflowDescriptors array:
export const workflowDescriptors: WorkflowDescriptor[] = [, /* existing */ myWorkflow]
```

**`server/workflows.ts`**

```ts
import { myWorkflow } from '../workflows/my-workflow/descriptor.js'
import { myWorkflowServer } from '../workflows/my-workflow/server.js'
// add to the workflowServers array:
{ descriptor: myWorkflow, bindings: myWorkflowServer }
```

**`client/src/workflows.ts`**

```ts
import { scope } from '@atizar/react'
import { myWorkflowMeta, myWorkflowRenders, myWorkflowHitl } from '../../workflows/my-workflow/client.js'
import { MY_WF_ID } from '../../workflows/my-workflow/ids.js'
// merge into META, renderSpecs, hitlSpecs:
const META = { /* existing */, ...myWorkflowMeta }
const renderSpecs = [ /* existing */, ...scope<RenderSpec>(MY_WF_ID, myWorkflowRenders) ]
const hitlSpecs = [ /* existing */, ...scope<HitlSpec>(MY_WF_ID, myWorkflowHitl) ]
```

---

## Stage 4 — Tests-first → green

Write the tests RED first, confirm they fail for the right reason, then implement to GREEN. Gate:
`typecheck && test && lint && format:check` all pass before Stage 5.

**Minimum required tests:**

### `descriptor.test.ts` — structure validation

```ts
import { describe, it, expect } from 'vitest'
import { myWorkflow, qualifierAgent } from './descriptor.js'
import { MY_WF_ID, MY_WF_AGENTS as a } from './ids.js'
import { MY_WF_TOOLS as t } from './tools.js'

describe('my-workflow descriptor', () => {
  it('parses without throwing', () => {
    expect(() => myWorkflow).not.toThrow()
  })
  it('entry agent is an input agent', () => {
    const entry = myWorkflow.agents.find((x) => x.agent.id === myWorkflow.entryAgentId)
    expect(entry?.role).toBe('input')
  })
  it('approvals ⊆ tools', () => {
    for (const name of qualifierAgent.approvals) {
      expect(qualifierAgent.tools).toContain(name)
    }
  })
  it('effects ⊆ approvals', () => {
    for (const name of qualifierAgent.effects) {
      expect(qualifierAgent.approvals).toContain(name)
    }
  })
})
```

### `prompts.drift.test.ts` — drift guard (mandatory)

The drift guard scans all prompt prose for tool-shaped tokens and asserts every one is a value in
the tools const. A renamed const that left a hand-typed copy behind fails here immediately.

```ts
import { describe, it, expect } from 'vitest'
import { MY_WF_TOOLS } from './tools.js'
import { MY_WF_AGENTS } from './ids.js'
import { qualifierPrompt } from './prompts.js'

const TOOL_TOKEN = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g // snake_case tokens
const VALID_TOOLS = new Set(Object.values(MY_WF_TOOLS))
const VALID_AGENTS = new Set(Object.values(MY_WF_AGENTS))

function collectProse(strategy: { buildFirst?: Function; buildResume?: Function }): string {
  const parts: string[] = []
  // definePrompt({onStart,...}) returns a strategy with buildFirst()/buildResume() — the test inspects those.
  try {
    parts.push(String(strategy.buildFirst?.({ messages: [], context: [] }) ?? ''))
  } catch {}
  try {
    parts.push(String(strategy.buildResume?.({}, {}) ?? ''))
  } catch {}
  return parts.join(' ')
}

describe('prompts drift guard — my-workflow', () => {
  it('qualifier: every snake_case token is a known tool or agent id', () => {
    const prose = collectProse(qualifierPrompt)
    for (const [token] of prose.matchAll(TOOL_TOKEN)) {
      if (!VALID_TOOLS.has(token as any) && !VALID_AGENTS.has(token as any)) {
        throw new Error(`Raw literal "${token}" in qualifier prompts — use MY_WF_TOOLS.${token}`)
      }
    }
  })
})
```

Adapt the regex if your tool names use a prefix pattern the default doesn't cover.

### `prompts.test.ts` — behavior

```ts
import { describe, it, expect } from 'vitest'
import { qualifierPrompt } from './prompts.js'
import { LeadRefSchema } from './contracts.js'
import { MY_WF_TOOLS as t } from './tools.js'

describe('qualifierPrompt', () => {
  it('onStart routes to the correct tools', () => {
    const text = qualifierPrompt.buildFirst({ messages: [], context: [] })
    expect(text).toContain(t.renderLead)
    expect(text).toContain(t.submitOutcome)
  })
  it('onInput decodes payload and includes lead name', () => {
    const payload = { leadId: 'l1', name: 'Alice' }
    const input = { messages: [{ role: 'user', content: JSON.stringify(payload) }], context: [] }
    const text = qualifierPrompt.buildFirst(input as any)
    expect(text).toContain('Alice')
  })
})
```

**Green gate:** run `yarn typecheck && yarn test && yarn lint && yarn format:check`. Fix all failures
before proceeding to Stage 5. Include **ESLint** (not just Prettier) — a passing format check with
a lint error is not green.

---

## Stage 5 — Browser-verify [GATE]

Unit tests pass. Now prove the workflow actually works in the running app.

**Start the dev server** (from your project root):

```bash
yarn dev  # or npm run dev
```

Confirm ONE server on `:4000` and ONE Vite dev server on `:5173` (or your configured ports).
If you see `EADDRINUSE`, kill stale processes first:

```bash
lsof -tiTCP:4000,5173 | xargs kill -9
```

**Drive the flow in the browser** (use the Playwright-MCP tools or your browser):

1. Navigate to `http://localhost:5173` (add `?dev=1` to reveal raw tool-call chips for debugging).
2. Start the input agent (the `input`-role agent for your workflow).
3. Wait for a dispatch to spawn a worker — confirm it appears in the pipeline.
4. Open the worker; confirm its card renders correctly.
5. **Run the HITL approval end-to-end**: edit the approval form if applicable, approve → server
   effect → confirm the worker reaches `finished`.
6. Run the **reject path**: reject the approval → confirm the worker reaches `finished`/`rejected`.

**One flow is not "done."** Verify both approve AND reject. Reserve the word "verified" for a flow
that actually ran in the browser in front of you.

If real credentials are not available, use `isDemo()` mode and verify the fake-result path.

---

## Stage 6 — Co-located workflow README

Write **`workflows/<id>/README.md`** using the template in
[`references/workflow-readme-template.md`](references/workflow-readme-template.md).

Required sections:

- **What it is** — one-line + what the workflow decides or does.
- **Agents & roles** — which is the input (startable) agent, which are workers, what each does.
- **How to run** — which agent to start and how (button/trigger), where it appears in the UI.
- **Credentials / integrations** — which services + which `ATIZAR_*` env vars are required.
- **Gates** — what the human approves (the irreversible action and its effect).

This README is a first-class output. When deployed, it lets a developer (or an agent) understand
"what is this workflow and how do I run it" from one file without reading the code.

---

## Stage 7 — Self-improvement (local, silent-skip default)

The packaged skill lives in `node_modules` and is read-only — never try to edit it.

After the run: did the user correct the same thing twice? Did a stage not match your project's
layout? If nothing systemic surfaced, write one sentence and exit.

If a finding holds, append a short dated note to **`.claude/atizar/add-workflow-notes.md`** in your
project root (create it if it does not exist). Format:

```
# add-workflow notes
<!-- append-only; read at Stage 0 of the next add-workflow run -->

2026-06-21: aggregator paths differ from defaults — this project uses `src/server/workflows.ts`
not `server/workflows.ts`. Updated Stage 3i accordingly.
```

Stage 0 reads this file on the next run, so the skill learns in your project without touching the
package.

---

## Red flags — STOP, you are rationalizing

| Thought                                                                    | Reality                                                                                                                                           |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Tests pass, so the browser is fine."                                      | The framework's worst bugs pass all tests. Not verified until the browser showed it — text bubble splits, frozen HITL closures, stuck tool chips. |
| "I'll skip the reject path — approve works."                               | Reject/cancel failures are silent. One flow is not done — verify approve AND reject.                                                              |
| "I'll put identity prose into the prompt."                                 | The provider prepends identity. Prose in `definePrompt` is turn-only; identity in `defineAgent.instructions` + the workflow `prompt`.             |
| "I'll put a read tool into `tools` — it's a tool, isn't it."               | Read tools go in `readonly` ONLY. A read tool in `tools` is misclassified by the Mastra factory and will break tool routing.                      |
| "I'll use a string literal for the tool name in the prompt."               | A raw literal drifts silently when the const is renamed. Use `${t.toolName}` — the drift guard will catch it if you don't.                        |
| "One aggregator line is already there from a paste — I'll skip the check." | One missing `scope()` call means the workflow's cards never resolve. Verify all three aggregator wires before Stage 5.                            |
| "The approval HITL closes immediately — must be a product bug."            | Check dev server hygiene first: stale dev stacks cause Vite ws-disconnect → page reload → state wipe. Kill stale processes, then retest.          |

---

## References

- [`references/minimal-skeleton.md`](references/minimal-skeleton.md) — minimal skeleton templates (empty aggregators, server entry, client entry) used by Stage 0b when bootstrapping a fresh project.
- [`references/workflow-readme-template.md`](references/workflow-readme-template.md) — the co-located README template (What / Agents&roles / How-to-run / Credentials / Gates).
