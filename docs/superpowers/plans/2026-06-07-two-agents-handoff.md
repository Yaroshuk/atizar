# Two Agents + Manual Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lead-qualifier agent beside the reply agent and let a manager hand off the qualifier's verdict to the reply agent through a single core handoff seam.

**Architecture:** Generalize the `claude-cli` provider to per-agent prompt strategies; turn the provider registry into factories; add a pure `core/handoff` contract (encode/decode); register two agents server-side; render a two-agent desktop where the qualifier's `VerdictCard` triggers `handoff('reply', payload)`. The handoff *mechanism* lives in `core/` so a future agent-initiated/server trigger reuses it; only the human *trigger* is client-side.

**Tech Stack:** TypeScript, Zod, Vitest, React (Vite), CopilotKit v2 + AG-UI, Hono, stdio MCP, the real `claude` CLI.

**Reference spec:** `docs/superpowers/specs/2026-06-07-two-agents-handoff-design.md`

**Run all commands from `apps/inbox/`.**

---

## Phase 1 — Core (pure, isomorphic; full TDD)

### Task 1: `core/handoff.ts` — the handoff contract

**Files:**
- Create: `apps/inbox/core/handoff.ts`
- Test: `apps/inbox/core/handoff.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/inbox/core/handoff.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { encodeHandoff, decodeHandoff, type HandoffPayload } from './handoff.js'

const payload: HandoffPayload = {
  threadId: 't_1',
  from: 'a@b.c',
  subject: 'Hi',
  summary: 'wants X',
  category: 'sales',
  priority: 'hot',
}
const input = (messages: unknown[]) => ({ messages }) as never

describe('handoff encode/decode', () => {
  it('round-trips a payload through a seed message', () => {
    const seed = encodeHandoff(payload)
    expect(decodeHandoff(input([seed]))).toEqual(payload)
  })

  it('returns null when there is no handoff seed', () => {
    expect(decodeHandoff(input([{ role: 'user', content: 'hello' }]))).toBeNull()
  })

  it('returns null for a malformed handoff payload', () => {
    expect(decodeHandoff(input([{ role: 'user', content: '[handoff] not json' }]))).toBeNull()
  })

  it('decodes the most recent seed when several are present', () => {
    const older = encodeHandoff({ ...payload, threadId: 'old' })
    const newer = encodeHandoff({ ...payload, threadId: 'new' })
    expect(decodeHandoff(input([older, newer]))?.threadId).toBe('new')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- handoff`
Expected: FAIL — cannot find module `./handoff.js`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/inbox/core/handoff.ts`:

```ts
import { z } from 'zod'
import type { RunAgentInput } from '@ag-ui/client'
import type { Message } from './messages.js'

// One agent's output becomes another's input. This module is the SINGLE place that
// knows HOW a payload rides on a run input (here: a seed user message with a marker).
// Both the human trigger (client) and any future agent/server trigger call these —
// no consumer hand-rolls the transport. Pure & isomorphic: no React, no Node.
export const HandoffPayloadSchema = z.object({
  threadId: z.string(),
  from: z.string(),
  subject: z.string(),
  summary: z.string(),
  category: z.string(),
  priority: z.string(),
})

export type HandoffPayload = z.infer<typeof HandoffPayloadSchema>

const MARKER = '[handoff]'

// Encode a payload as the seed user message the target run will carry.
export function encodeHandoff(payload: HandoffPayload): Message {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: `${MARKER} ${JSON.stringify(payload)}`,
  } as Message
}

// Decode the most recent handoff payload from a run input, or null if there is no
// seed / it is unparseable. The reply prompt strategy calls this — it never sniffs
// the marker string itself.
export function decodeHandoff(input: RunAgentInput): HandoffPayload | null {
  const messages = (input?.messages ?? []) as Message[]
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'user' && typeof m.content === 'string' && m.content.startsWith(MARKER)) {
      try {
        return HandoffPayloadSchema.parse(JSON.parse(m.content.slice(MARKER.length).trim()))
      } catch {
        return null
      }
    }
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- handoff`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add core/handoff.ts core/handoff.test.ts
git commit -m "feat(core): handoff contract — encode/decode payload as a seed message"
```

---

### Task 2: Provider seam types — `PromptStrategy`, `ProviderConfig`, factory registry

**Files:**
- Modify: `apps/inbox/core/providers.ts`
- Test: `apps/inbox/core/providers.test.ts`

- [ ] **Step 1: Rewrite the failing test**

Replace `apps/inbox/core/providers.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { defineProviders, type ProviderFactory } from './providers.js'

const factory: ProviderFactory = () => ({
  // eslint-disable-next-line require-yield
  async *run() {
    return
  },
})

describe('defineProviders', () => {
  it('resolves a provider factory by name', () => {
    const registry = defineProviders({ mock: factory })
    expect(registry.resolve('mock')).toBe(factory)
  })

  it('throws on an unknown provider name', () => {
    const registry = defineProviders({ mock: factory })
    expect(() => registry.resolve('nope')).toThrow(/unknown provider/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- core/providers`
Expected: FAIL — `ProviderFactory` is not exported / type errors.

- [ ] **Step 3: Write the implementation**

Replace `apps/inbox/core/providers.ts` with:

```ts
import type { RunAgentInput, BaseEvent } from '@ag-ui/client'

// A provider is the model/runtime seam: given the run input it yields AG-UI events.
export interface Provider {
  run(input: RunAgentInput): AsyncIterable<BaseEvent>
}

// A per-agent prompt strategy: how this agent turns a run into CLI prompts.
// buildFirst handles turn 1 (standalone OR handoff-seeded). buildResume handles a
// resumed run after a human approval (null = no usable resume → the provider errors).
// Lives at the seam so claude-cli stays generic; a Mastra provider would ignore it.
export interface PromptStrategy {
  buildFirst(input: RunAgentInput): string
  buildResume?(args: Record<string, unknown>): string | null
}

// Everything a provider needs to run ONE agent, derived from its passport.
export interface ProviderConfig {
  approvalNames: readonly string[]
  surfaceTools: readonly string[]
  prompts: PromptStrategy
}

// Providers are constructed PER AGENT from config (two agents → two configurations
// of one `claude-cli`). New backends (Mastra) add a factory to the registry later.
export type ProviderFactory = (config: ProviderConfig) => Provider

export interface ProviderRegistry {
  resolve(name: string): ProviderFactory
}

// Factories are defined once; agents reference one by name. resolve throws on an
// unknown name so a bad `provider` reference fails loudly at wiring time.
export function defineProviders(map: Record<string, ProviderFactory>): ProviderRegistry {
  return {
    resolve(name: string): ProviderFactory {
      const factory = map[name]
      if (!factory) throw new Error(`Unknown provider: ${name}`)
      return factory
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- core/providers`
Expected: PASS (2 tests). NOTE: `npm test` (full) is still RED here — `claude-cli-provider`, `inbox.agent`, and the server import the old shapes. Tasks 3–8 restore green; do not run the full suite until Task 8.

- [ ] **Step 5: Commit**

```bash
git add core/providers.ts core/providers.test.ts
git commit -m "feat(core): provider registry becomes per-agent factories + PromptStrategy"
```

---

### Task 3: Reply prompt strategy (`core/agents/reply.prompts.ts`)

**Files:**
- Create: `apps/inbox/core/agents/reply.prompts.ts`
- Test: `apps/inbox/core/agents/reply.prompts.test.ts`

This moves the reply prompts OUT of the provider and adds the handoff branch.

- [ ] **Step 1: Write the failing test**

Create `apps/inbox/core/agents/reply.prompts.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createReplyPrompts } from './reply.prompts.js'
import { encodeHandoff, type HandoffPayload } from '../handoff.js'

const input = (messages: unknown[]) => ({ messages }) as never
const payload: HandoffPayload = {
  threadId: 't_42',
  from: 'ivan@acme.ru',
  subject: 'Order',
  summary: 'wants 10 units',
  category: 'sales',
  priority: 'hot',
}

describe('reply prompt strategy', () => {
  const prompts = createReplyPrompts('Reply to leads.')

  it('standalone first prompt calls get_latest_email', () => {
    const p = prompts.buildFirst(input([]))
    expect(p).toContain('get_latest_email')
    expect(p).toContain('saveDraft')
  })

  it('handoff first prompt uses the payload and skips get_latest_email', () => {
    const p = prompts.buildFirst(input([encodeHandoff(payload)]))
    expect(p).toContain('t_42')
    expect(p).toContain('sales')
    expect(p).not.toContain('get_latest_email')
  })

  it('buildResume returns a create_draft prompt from approval args', () => {
    const p = prompts.buildResume?.({ threadId: 't_7', body: 'Hello Ivan' })
    expect(p).toContain('t_7')
    expect(p).toContain('Hello Ivan')
    expect(p).toContain('create_draft')
  })

  it('buildResume returns null when args lack threadId/body', () => {
    expect(prompts.buildResume?.({})).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- reply.prompts`
Expected: FAIL — cannot find module `./reply.prompts.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/inbox/core/agents/reply.prompts.ts`:

```ts
import type { RunAgentInput } from '@ag-ui/client'
import type { PromptStrategy } from '../providers.js'
import { decodeHandoff, type HandoffPayload } from '../handoff.js'

// Standalone turn 1: discover the latest email itself.
function standaloneFirst(instructions: string): string {
  return [
    instructions,
    '',
    'Call get_latest_email to read the single most recent email in the inbox',
    '(it returns { threadId, from, subject, body }). Then call renderLead with',
    '{ from, subject, summary } to surface it, and draft a short reply.',
    'Then call saveDraft with { threadId, body } — threadId from the email, body',
    'is your drafted reply — to ask the human before saving.',
    'Do NOT create the draft yet and do NOT send anything. Do not narrate your',
    'tool usage or mention tools/schemas — keep any text brief and user-facing.',
  ].join('\n')
}

// Handoff turn 1: the qualifier already read & classified the email — use its payload.
function handoffFirst(instructions: string, h: HandoffPayload): string {
  return [
    instructions,
    '',
    `A colleague already qualified this lead — category "${h.category}", priority "${h.priority}".`,
    `The email is from ${h.from}, subject "${h.subject}". Summary: ${h.summary}`,
    'Do NOT call get_latest_email — use the context above.',
    'Call renderLead with { from, subject, summary } to surface it, then draft a',
    'short reply tailored to the qualification. Then call saveDraft with { threadId,',
    `body } — threadId is "${h.threadId}", body is your drafted reply — to ask the`,
    'human before saving.',
    'Do NOT create the draft yet and do NOT send anything. Do not narrate your',
    'tool usage or mention tools/schemas — keep any text brief and user-facing.',
  ].join('\n')
}

function resume(instructions: string, threadId: string, body: string): string {
  return [
    instructions,
    '',
    'The human APPROVED saving this reply. Create it as a Gmail DRAFT now by',
    `calling create_draft, replying within thread "${threadId}", with this body:`,
    '',
    body,
    '',
    'Do not send. After the draft is created, reply with one short sentence',
    'confirming the draft was saved to Gmail. Do not narrate tool usage.',
  ].join('\n')
}

export function createReplyPrompts(instructions: string): PromptStrategy {
  return {
    buildFirst(input: RunAgentInput): string {
      const h = decodeHandoff(input)
      return h ? handoffFirst(instructions, h) : standaloneFirst(instructions)
    },
    buildResume(args: Record<string, unknown>): string | null {
      const threadId = typeof args.threadId === 'string' ? args.threadId : ''
      const body = typeof args.body === 'string' ? args.body : ''
      if (!threadId || !body) return null
      return resume(instructions, threadId, body)
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- reply.prompts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add core/agents/reply.prompts.ts core/agents/reply.prompts.test.ts
git commit -m "feat(core): reply prompt strategy (standalone + handoff + resume branches)"
```

---

### Task 4: Qualifier prompt strategy (`core/agents/qualifier.prompts.ts`)

**Files:**
- Create: `apps/inbox/core/agents/qualifier.prompts.ts`
- Test: `apps/inbox/core/agents/qualifier.prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/inbox/core/agents/qualifier.prompts.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createQualifierPrompts } from './qualifier.prompts.js'

const input = (messages: unknown[]) => ({ messages }) as never

describe('qualifier prompt strategy', () => {
  const prompts = createQualifierPrompts('Qualify leads.')

  it('first prompt reads the email and calls renderVerdict', () => {
    const p = prompts.buildFirst(input([]))
    expect(p).toContain('get_latest_email')
    expect(p).toContain('renderVerdict')
  })

  it('has no resume strategy (no approvals)', () => {
    expect(prompts.buildResume).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- qualifier.prompts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

Create `apps/inbox/core/agents/qualifier.prompts.ts`:

```ts
import type { PromptStrategy } from '../providers.js'

function qualifierFirst(instructions: string): string {
  return [
    instructions,
    '',
    'Call get_latest_email to read the single most recent email in the inbox',
    '(it returns { threadId, from, subject, body }). Classify the lead, then call',
    'renderVerdict with { threadId, from, subject, summary, category, priority, reason }:',
    '- category: one of "sales", "support", "spam", "other"',
    '- priority: one of "hot", "warm", "cold"',
    '- summary: one sentence on what the email asks for',
    '- reason: one sentence on why you classified it this way.',
    'threadId, from and subject come from get_latest_email. Do NOT draft a reply and',
    'do NOT save anything. Do not narrate your tool usage or mention tools/schemas —',
    'keep any text brief and user-facing.',
  ].join('\n')
}

export function createQualifierPrompts(instructions: string): PromptStrategy {
  return {
    buildFirst(): string {
      return qualifierFirst(instructions)
    },
    // No buildResume: the qualifier has no approvals, so it never resumes.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- qualifier.prompts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add core/agents/qualifier.prompts.ts core/agents/qualifier.prompts.test.ts
git commit -m "feat(core): qualifier prompt strategy (get_latest_email -> renderVerdict)"
```

---

### Task 5: Generalize the `claude-cli` provider to a prompt strategy

**Files:**
- Modify: `apps/inbox/core/claude-cli-provider.ts`
- Modify: `apps/inbox/core/claude-cli-provider.test.ts`

- [ ] **Step 1: Update the test to the new signature**

In `apps/inbox/core/claude-cli-provider.test.ts`, add the import at the top (after the existing imports):

```ts
import { createReplyPrompts } from './agents/reply.prompts.js'
```

Then replace every `createClaudeCliProvider({ ... instructions: <X>, spawn ... })` call so that `instructions: <X>` becomes `prompts: createReplyPrompts(<X>)`. There are five call sites; each currently passes `instructions: 'do it' | 'x'`. Concretely change each occurrence:

- `instructions: 'do it',` → `prompts: createReplyPrompts('do it'),`
- `instructions: 'x',` → `prompts: createReplyPrompts('x'),`

Leave the rest of every test body unchanged (the assertions on `get_latest_email`, `APPROVED`, `create_draft`, `t_42`, `Hi Ivan`, and `Resume failed` all still hold via the reply strategy).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- claude-cli-provider`
Expected: FAIL — `createClaudeCliProvider` still expects `instructions`; type error on `prompts`.

- [ ] **Step 3: Write the implementation**

Replace `apps/inbox/core/claude-cli-provider.ts` with:

```ts
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import type { Provider, PromptStrategy } from './providers.js'
import { approvalResolved, lastApprovalArgs, type Message } from './messages.js'
import { mapClaudeStream } from './claude-stream.js'

// Spawns a `claude` run for a prompt and exposes stdout as NDJSON lines + kill().
// Injectable so the Node implementation stays server-side and tests use a fake.
export type ClaudeSpawn = (prompt: string) => {
  lines: AsyncIterable<string>
  kill: () => void
}

function errorChunk(message: string): BaseEvent {
  return {
    type: EventType.TEXT_MESSAGE_CHUNK,
    role: 'assistant',
    messageId: crypto.randomUUID(),
    delta: `Provider error: ${message}`,
  } as BaseEvent
}

// Generic over the agent: prompts come from an injected PromptStrategy, so the same
// provider serves the reply agent, the qualifier, and any future claude-cli agent.
export function createClaudeCliProvider(opts: {
  approvalNames: readonly string[]
  // The agent's renderable tool names — only these surface to the client; the
  // model's internal tools (e.g. ToolSearch) are filtered out of the thread.
  surfaceTools: readonly string[]
  prompts: PromptStrategy
  spawn: ClaudeSpawn
}): Provider {
  const { approvalNames, surfaceTools, prompts, spawn } = opts
  return {
    async *run(input: RunAgentInput): AsyncIterable<BaseEvent> {
      const messages = (input?.messages ?? []) as Message[]
      const resuming = approvalResolved(messages, approvalNames)
      let child: { lines: AsyncIterable<string>; kill: () => void } | undefined
      try {
        let prompt: string
        if (resuming) {
          const args = lastApprovalArgs(messages, approvalNames) ?? {}
          const resumePrompt = prompts.buildResume?.(args) ?? null
          if (!resumePrompt) {
            yield errorChunk('Resume failed: no saved draft found in the thread')
            return
          }
          prompt = resumePrompt
        } else {
          prompt = prompts.buildFirst(input)
        }
        child = spawn(prompt)
      } catch (err) {
        yield errorChunk(err instanceof Error ? err.message : String(err))
        return
      }
      try {
        yield* mapClaudeStream(child.lines, {
          approvalNames: resuming ? [] : approvalNames,
          surfaceTools,
        })
      } catch (err) {
        yield errorChunk(err instanceof Error ? err.message : String(err))
      } finally {
        child.kill()
      }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- claude-cli-provider`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add core/claude-cli-provider.ts core/claude-cli-provider.test.ts
git commit -m "refactor(core): claude-cli provider takes a PromptStrategy, not baked prompts"
```

---

### Task 6: `defineAgent` — optional `handoffs`

**Files:**
- Modify: `apps/inbox/core/defineAgent.ts`
- Modify: `apps/inbox/core/defineAgent.test.ts`

- [ ] **Step 1: Add the failing test**

In `apps/inbox/core/defineAgent.test.ts`, add this case inside the `describe('defineAgent', …)` block:

```ts
  it('accepts an optional handoffs array', () => {
    const def = defineAgent({ ...valid, handoffs: ['other'] })
    expect(def.handoffs).toEqual(['other'])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- defineAgent`
Expected: FAIL — `handoffs` is not a known property / stripped.

- [ ] **Step 3: Write the implementation**

In `apps/inbox/core/defineAgent.ts`, add `handoffs` to the schema object (after `renders`):

```ts
    renders: z.record(z.string()),
    // Target agent ids this agent may hand off to. Structure only — membership in
    // the agent registry is checked at wiring time (a passport doesn't know it).
    handoffs: z.array(z.string()).optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- defineAgent`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add core/defineAgent.ts core/defineAgent.test.ts
git commit -m "feat(core): defineAgent gains optional handoffs (structure only)"
```

---

### Task 7: The two passports (`core/inbox.agent.ts`)

**Files:**
- Modify: `apps/inbox/core/inbox.agent.ts`
- Modify: `apps/inbox/core/inbox.agent.test.ts`

- [ ] **Step 1: Rewrite the test**

Replace `apps/inbox/core/inbox.agent.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { qualifierAgent, replyAgent, agents } from './inbox.agent.js'
import { defineProviders } from './providers.js'
import { createMockInboxProvider } from './mock-provider.js'

describe('inbox agents wiring', () => {
  it('reply passport validates and references the claude-cli provider', () => {
    expect(replyAgent.id).toBe('reply')
    expect(replyAgent.provider).toBe('claude-cli')
    expect(replyAgent.approvals).toEqual(['saveDraft'])
  })

  it('qualifier passport classifies with no approval and hands off to reply', () => {
    expect(qualifierAgent.id).toBe('qualifier')
    expect(qualifierAgent.approvals).toEqual([])
    expect(qualifierAgent.tools).toEqual(['renderVerdict'])
    expect(qualifierAgent.handoffs).toEqual(['reply'])
  })

  it('every handoff target is a known agent id', () => {
    const ids = new Set(agents.map((a) => a.id))
    for (const a of agents) for (const t of a.handoffs ?? []) expect(ids.has(t)).toBe(true)
  })

  it('a registry of factories resolves a runnable provider', () => {
    const reg = defineProviders({ mock: (cfg) => createMockInboxProvider(cfg.approvalNames) })
    const provider = reg
      .resolve('mock')({ approvalNames: [], surfaceTools: [], prompts: { buildFirst: () => '' } })
    expect(typeof provider.run).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- inbox.agent`
Expected: FAIL — `qualifierAgent`/`replyAgent`/`agents` not exported.

- [ ] **Step 3: Write the implementation**

Replace `apps/inbox/core/inbox.agent.ts` with:

```ts
import { defineAgent } from './defineAgent.js'

// The reply agent (formerly the single inbox agent). Reads an email and drafts a
// reply for human approval. Runs standalone OR seeded by a handoff from the qualifier.
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

// The lead qualifier. Reads an email, classifies it, and surfaces a verdict the
// manager can hand off to the reply agent. No approval pause of its own.
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

// The desktop's agent registry — server (runtime registration + handoff validation)
// and tests map over it. The client references the passports directly (two agents).
export const agents = [qualifierAgent, replyAgent]
```

- [ ] **Step 4: Run the FULL core suite to verify green**

Run: `npm test`
Expected: PASS — all core tests green again (handoff, providers, reply.prompts, qualifier.prompts, claude-cli-provider, defineAgent, inbox.agent, messages, mock-provider, claude-stream, gmail-format). The server/client are not yet rewired but they are not imported by vitest. Then:

Run: `npm run typecheck`
Expected: FAIL — `server/providers.ts`, `server/build-agent.ts`, `server/index.ts` still use the old shapes (fixed in Phase 2). This is expected; tests are green.

- [ ] **Step 5: Commit**

```bash
git add core/inbox.agent.ts core/inbox.agent.test.ts
git commit -m "feat(core): two passports — replyAgent + qualifierAgent + agents registry"
```

---

## Phase 2 — Server wiring

### Task 8: `buildAgent` takes a prompt strategy and builds via the factory

**Files:**
- Modify: `apps/inbox/server/build-agent.ts`

- [ ] **Step 1: Write the implementation**

Replace `apps/inbox/server/build-agent.ts` with:

```ts
import { BuiltInAgent } from '@copilotkit/runtime/v2'
import type { AgentDefinition } from '../core/defineAgent.js'
import type { ProviderRegistry, PromptStrategy } from '../core/providers.js'

// Builds the CopilotKit BuiltInAgent for an agent passport: resolves the provider
// FACTORY from the registry by `def.provider`, then constructs the provider from the
// passport (approvals/tools) plus this agent's prompt strategy. All approval/turn
// logic lives in the provider, so there is no hardcoded tool name here.
export function buildAgent(
  def: AgentDefinition,
  prompts: PromptStrategy,
  registry: ProviderRegistry
): BuiltInAgent {
  const makeProvider = registry.resolve(def.provider)
  const provider = makeProvider({
    approvalNames: def.approvals,
    surfaceTools: def.tools,
    prompts,
  })
  return new BuiltInAgent({
    type: 'custom',
    factory: ({ input }) => provider.run(input),
  })
}
```

- [ ] **Step 2: Commit (typecheck still red until Task 10 — that is expected)**

```bash
git add server/build-agent.ts
git commit -m "refactor(server): buildAgent resolves a provider factory + prompt strategy"
```

---

### Task 9: Provider registry as factories (`server/providers.ts`)

**Files:**
- Modify: `apps/inbox/server/providers.ts`

- [ ] **Step 1: Write the implementation**

Replace `apps/inbox/server/providers.ts` with:

```ts
import { defineProviders, type ProviderRegistry } from '../core/providers.js'
import { createMockInboxProvider } from '../core/mock-provider.js'
import { createClaudeCliProvider } from '../core/claude-cli-provider.js'
import { claudeSpawn } from './claude-spawn.js'

// Runtime registry (server-only — claude-cli needs Node). Each entry is a FACTORY
// built per agent from its passport-derived config. `mock` ignores prompts (it
// scripts its own stream); `claude-cli` uses the injected PromptStrategy + spawn.
// A future Mastra backend is one more factory here.
export const providerRegistry: ProviderRegistry = defineProviders({
  mock: (config) => createMockInboxProvider(config.approvalNames),
  'claude-cli': (config) =>
    createClaudeCliProvider({
      approvalNames: config.approvalNames,
      surfaceTools: config.surfaceTools,
      prompts: config.prompts,
      spawn: claudeSpawn,
    }),
})
```

- [ ] **Step 2: Commit**

```bash
git add server/providers.ts
git commit -m "refactor(server): provider registry holds per-agent factories"
```

---

### Task 10: Register both agents + validate handoffs (`server/index.ts`)

**Files:**
- Modify: `apps/inbox/server/index.ts`

- [ ] **Step 1: Write the implementation**

Replace `apps/inbox/server/index.ts` with:

```ts
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { CopilotRuntime, createCopilotEndpoint, InMemoryAgentRunner } from '@copilotkit/runtime/v2'
import { qualifierAgent, replyAgent, agents } from '../core/inbox.agent.js'
import { createQualifierPrompts } from '../core/agents/qualifier.prompts.js'
import { createReplyPrompts } from '../core/agents/reply.prompts.js'
import { providerRegistry } from './providers.js'
import { buildAgent } from './build-agent.js'

// Wiring-time check: a passport must not hand off to an agent that isn't registered.
const knownIds = new Set(agents.map((a) => a.id))
for (const a of agents) {
  for (const target of a.handoffs ?? []) {
    if (!knownIds.has(target)) {
      throw new Error(`Agent "${a.id}" hands off to unknown agent "${target}"`)
    }
  }
}

const runtime = new CopilotRuntime({
  agents: {
    [qualifierAgent.id]: buildAgent(
      qualifierAgent,
      createQualifierPrompts(qualifierAgent.instructions),
      providerRegistry
    ),
    [replyAgent.id]: buildAgent(
      replyAgent,
      createReplyPrompts(replyAgent.instructions),
      providerRegistry
    ),
  },
  runner: new InMemoryAgentRunner(),
})

// single-route: ONE POST endpoint at the bare basePath, matching the v2 client's
// default single-endpoint transport (see CLAUDE.md → CopilotKit v2 API notes).
const copilot = createCopilotEndpoint({
  runtime,
  basePath: '/api/copilotkit',
  mode: 'single-route',
})

const app = new Hono()
app.route('/', copilot)

serve({ fetch: app.fetch, port: 4000 })
console.log('server on http://localhost:4000')
```

- [ ] **Step 2: Verify typecheck is green again**

Run: `npm run typecheck`
Expected: PASS — server now matches the new core shapes. (Client still uses the old single-agent `InboxView`/`actions`; those compile against `replyAgent`/`qualifierAgent` only after Phase 4 — but they still import `inboxAgent` which no longer exists, so typecheck FAILS on client files. That is fixed in Phase 4; server-only typecheck is green.)

NOTE: if `npm run typecheck` covers the whole app it will still flag `client/src/InboxView.tsx` and `client/src/actions.tsx` (they import the removed `inboxAgent`). Proceed to Phase 3/4; the final green typecheck is at Task 16.

- [ ] **Step 3: Commit**

```bash
git add server/index.ts
git commit -m "feat(server): register qualifier + reply agents; validate handoff targets"
```

---

## Phase 3 — MCP tool

### Task 11: `renderVerdict` MCP tool + allow-list

**Files:**
- Modify: `apps/inbox/mcp/inbox-tools.mjs`
- Modify: `apps/inbox/server/claude-spawn.ts:73-78`

- [ ] **Step 1: Add the `renderVerdict` tool**

In `apps/inbox/mcp/inbox-tools.mjs`, add this registration after the `saveDraft` block (before `await server.connect(...)`):

```js
server.registerTool(
  'renderVerdict',
  {
    description: 'Surface a qualified lead verdict as a card in the UI.',
    inputSchema: {
      threadId: z.string(),
      from: z.string(),
      subject: z.string(),
      summary: z.string(),
      category: z.string(),
      priority: z.string(),
      reason: z.string(),
    },
  },
  async () => ({ content: [{ type: 'text', text: 'Verdict surfaced to the user.' }] }),
)
```

- [ ] **Step 2: Add it to the spawn allow-list**

In `apps/inbox/server/claude-spawn.ts`, change the `allow` array (currently lines ~73-78) to include `renderVerdict`:

```ts
        allow: [
          'mcp__inbox__renderLead',
          'mcp__inbox__renderVerdict',
          'mcp__inbox__saveDraft',
          'mcp__gmail__get_latest_email',
          'mcp__gmail__create_draft',
        ],
```

- [ ] **Step 3: Sanity-check the MCP server boots**

Run: `node mcp/inbox-tools.mjs < /dev/null`
Expected: it starts and exits cleanly on EOF (no schema error printed). (The server reads stdio; an immediate EOF ends it without error output.)

- [ ] **Step 4: Commit**

```bash
git add mcp/inbox-tools.mjs server/claude-spawn.ts
git commit -m "feat(mcp): renderVerdict tool + allow-list entry"
```

---

## Phase 4 — Client

### Task 12: `VerdictCard` component + registry entry

**Files:**
- Create: `apps/inbox/client/src/components/VerdictCard.tsx`
- Modify: `apps/inbox/client/src/renderRegistry.tsx`

- [ ] **Step 1: Create the component**

Create `apps/inbox/client/src/components/VerdictCard.tsx`:

```tsx
type Verdict = {
  threadId: string
  from: string
  subject: string
  summary: string
  category: string
  priority: string
  reason: string
}

type VerdictCardProps = { data: Verdict; onDraftReply: () => void }

export const VerdictCard = ({ data, onDraftReply }: VerdictCardProps) => {
  return (
    <div
      style={{
        border: '1px solid #ddd',
        borderRadius: 10,
        padding: 12,
        background: '#fff',
        margin: '8px 0',
      }}
    >
      <div style={{ fontSize: 12, color: '#888' }}>✉️ {data.from}</div>
      <div style={{ fontWeight: 600 }}>{data.subject}</div>
      <div style={{ display: 'flex', gap: 6, margin: '6px 0' }}>
        <span
          style={{ fontSize: 12, padding: '2px 8px', borderRadius: 12, background: '#eef', color: '#225' }}
        >
          {data.category}
        </span>
        <span
          style={{ fontSize: 12, padding: '2px 8px', borderRadius: 12, background: '#fee', color: '#a33' }}
        >
          {data.priority}
        </span>
      </div>
      <div style={{ fontSize: 13, color: '#444' }}>{data.reason}</div>
      {data.threadId && (
        <button
          onClick={onDraftReply}
          style={{
            marginTop: 10,
            background: '#111',
            color: '#fff',
            border: 0,
            borderRadius: 6,
            padding: '6px 14px',
          }}
        >
          Draft reply
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Register it**

Replace `apps/inbox/client/src/renderRegistry.tsx` with:

```tsx
import type { ComponentType } from 'react'
import { LeadCard } from './components/LeadCard'
import { ApprovalDialog } from './components/ApprovalDialog'
import { VerdictCard } from './components/VerdictCard'

// Maps the component *names* referenced by `def.renders` to real React
// components. Keeps the shared passport (core/) free of React imports.
// Heterogeneous registry: each component has its own prop shape, so a single
// element type is genuinely `any` here — there is no common prop contract.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const renderRegistry: Record<string, ComponentType<any>> = {
  LeadCard,
  ApprovalDialog,
  VerdictCard,
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/VerdictCard.tsx client/src/renderRegistry.tsx
git commit -m "feat(client): VerdictCard component + registry entry"
```

---

### Task 13: Register `renderVerdict` + wire handoff in `actions.tsx`

**Files:**
- Modify: `apps/inbox/client/src/actions.tsx`
- Test: `apps/inbox/client/src/renderVerdict.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/inbox/client/src/renderVerdict.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CopilotKit, useRenderToolCall } from '@copilotkit/react-core/v2'
import { useInboxActions } from './actions'

const messages = [
  {
    role: 'assistant',
    toolCalls: [
      {
        id: 'tc_v',
        type: 'function',
        function: {
          name: 'renderVerdict',
          arguments: JSON.stringify({
            threadId: 't_9',
            from: 'ivan@acme.ru',
            subject: 'Order: 10 units',
            summary: 'Wants 10 units.',
            category: 'sales',
            priority: 'hot',
            reason: 'Ready-to-buy intent.',
          }),
        },
      },
    ],
  },
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Surface({ onHandoff }: { onHandoff: (t: string, p: any) => void }) {
  useInboxActions(onHandoff)
  const renderToolCall = useRenderToolCall()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const els = messages.flatMap((m: any) =>
    m.role === 'assistant' && Array.isArray(m.toolCalls)
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        m.toolCalls.map((tc: any) => <div key={tc.id}>{renderToolCall({ toolCall: tc })}</div>)
      : []
  )
  return <div>{els}</div>
}

describe('renderVerdict generative-UI + handoff', () => {
  it('renders the VerdictCard and hands off on Draft reply', () => {
    const onHandoff = vi.fn()
    render(
      <CopilotKit runtimeUrl='/api/copilotkit'>
        <Surface onHandoff={onHandoff} />
      </CopilotKit>
    )
    expect(screen.getByText('Order: 10 units')).toBeInTheDocument()
    expect(screen.getByText('sales')).toBeInTheDocument()
    expect(screen.getByText('hot')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Draft reply'))
    expect(onHandoff).toHaveBeenCalledWith(
      'reply',
      expect.objectContaining({ threadId: 't_9', category: 'sales', priority: 'hot' })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- renderVerdict`
Expected: FAIL — `useInboxActions` doesn't accept `onHandoff` / renderVerdict not registered.

- [ ] **Step 3: Write the implementation**

Replace `apps/inbox/client/src/actions.tsx` with:

```tsx
import { useHumanInTheLoop, useRenderTool } from '@copilotkit/react-core/v2'
import { z } from 'zod'
import { qualifierAgent, replyAgent } from '../../core/inbox.agent'
import type { HandoffPayload } from '../../core/handoff'
import { renderRegistry } from './renderRegistry'

// Generative-UI registration for the desktop, derived from the passports:
// `renders` maps tool name → component name; `approvals` decides which tool pauses
// the run (useHumanInTheLoop) vs. pure render (useRenderTool). Tool names are
// globally unique, so all three are registered once here.
//
// `onHandoff` is the human-trigger seam: the qualifier's VerdictCard calls it to
// hand the verdict to the reply agent. The mechanism (encode/launch) lives in the
// desktop + core; this only forwards the click.
export const useInboxActions = (
  onHandoff?: (targetId: string, payload: HandoffPayload) => void
) => {
  // renderLead -> <LeadCard /> (pure generative UI).
  useRenderTool(
    {
      name: 'renderLead',
      parameters: z.object({ from: z.string(), subject: z.string(), summary: z.string() }),
      render: ({ parameters }) => {
        const { from, subject, summary } = parameters
        if (from === undefined || subject === undefined || summary === undefined) return <></>
        const Lead = renderRegistry[replyAgent.renders.renderLead]
        return <Lead lead={{ from, subject, summary }} />
      },
    },
    []
  )

  // renderVerdict -> <VerdictCard /> (pure generative UI + manual handoff trigger).
  useRenderTool(
    {
      name: 'renderVerdict',
      parameters: z.object({
        threadId: z.string(),
        from: z.string(),
        subject: z.string(),
        summary: z.string(),
        category: z.string(),
        priority: z.string(),
        reason: z.string(),
      }),
      render: ({ parameters }) => {
        const p = parameters
        if (
          p.threadId === undefined ||
          p.from === undefined ||
          p.subject === undefined ||
          p.summary === undefined ||
          p.category === undefined ||
          p.priority === undefined ||
          p.reason === undefined
        )
          return <></>
        const Verdict = renderRegistry[qualifierAgent.renders.renderVerdict]
        const target = qualifierAgent.handoffs?.[0] ?? 'reply'
        return (
          <Verdict
            data={p}
            onDraftReply={() =>
              onHandoff?.(target, {
                threadId: p.threadId,
                from: p.from,
                subject: p.subject,
                summary: p.summary,
                category: p.category,
                priority: p.priority,
              })
            }
          />
        )
      },
    },
    [onHandoff]
  )

  // saveDraft -> <ApprovalDialog /> (human-in-the-loop pause).
  useHumanInTheLoop<{ threadId: string; body: string }>(
    {
      name: 'saveDraft',
      parameters: z.object({ threadId: z.string(), body: z.string() }),
      render: ({ args, status, respond }) => {
        if (args.threadId === undefined || args.body === undefined) return <></>
        const data = { threadId: args.threadId, body: args.body }
        const Approval = renderRegistry[replyAgent.renders.saveDraft]
        return (
          <Approval
            data={data}
            onApprove={() => {
              if (status === 'executing' && respond) void respond('approved')
            }}
          />
        )
      },
    },
    []
  )
}
```

- [ ] **Step 4: Run both client render tests**

Run: `npm test -- renderVerdict renderLead`
Expected: PASS — `renderVerdict` (1 test) and the existing `renderLead` (1 test, still calls `useInboxActions()` with no arg).

- [ ] **Step 5: Commit**

```bash
git add client/src/actions.tsx client/src/renderVerdict.test.tsx
git commit -m "feat(client): register renderVerdict + forward the handoff click"
```

---

### Task 14: `AgentModal` takes a `title` prop

**Files:**
- Modify: `apps/inbox/client/src/components/AgentModal.tsx`

- [ ] **Step 1: Add the prop and use it**

In `apps/inbox/client/src/components/AgentModal.tsx`:

Add `title: string` to `AgentModalProps` (after `agent`):

```ts
type AgentModalProps = {
  agent: { messages: Message[] }
  title: string
  renderToolCall: (args: { toolCall: ToolCall; toolMessage?: ToolMessage }) => ReactNode
  loading: boolean
  onClose: () => void
}
```

Update the destructure:

```ts
export const AgentModal = ({ agent, title, renderToolCall, loading, onClose }: AgentModalProps) => {
```

Replace the hardcoded header `<strong>EMAIL AGENT</strong>` with:

```tsx
          <strong>{title}</strong>
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/AgentModal.tsx
git commit -m "refactor(client): AgentModal title comes from the passport name"
```

---

### Task 15: Two-agent desktop + handoff seam (`InboxView.tsx`)

**Files:**
- Modify: `apps/inbox/client/src/InboxView.tsx`

- [ ] **Step 1: Write the implementation**

Replace `apps/inbox/client/src/InboxView.tsx` with:

```tsx
import { useCallback, useRef, useState } from 'react'
import {
  useAgent,
  useCopilotKit,
  UseAgentUpdate,
  useRenderToolCall,
} from '@copilotkit/react-core/v2'
import { useInboxActions } from './actions'
import { AgentCard } from './components/AgentCard'
import { AgentModal } from './components/AgentModal'
import { useAgentStatus } from './useAgentStatus'
import { qualifierAgent, replyAgent } from '../../core/inbox.agent'
import { encodeHandoff, type HandoffPayload } from '../../core/handoff'
import type { Message } from '../../core/messages'

// The consumer desktop: one card per agent + a conversation modal. Two agents are
// known statically (qualifier, reply), so they are wired explicitly rather than
// mapped — N-agent mapping over a registry is deferred to the framework phase.
// Must render inside <CopilotKit> (see App).
export const InboxView = () => {
  const { copilotkit } = useCopilotKit()
  const [openId, setOpenId] = useState<string | null>(null)

  const { agent: qualifier } = useAgent({
    agentId: qualifierAgent.id,
    updates: [UseAgentUpdate.OnMessagesChanged],
  })
  const { agent: reply } = useAgent({
    agentId: replyAgent.id,
    updates: [UseAgentUpdate.OnMessagesChanged],
  })

  // Keep the latest agent objects reachable from the (stable) handoff callback.
  const agentsRef = useRef<Record<string, typeof reply>>({})
  agentsRef.current[qualifierAgent.id] = qualifier
  agentsRef.current[replyAgent.id] = reply

  // The handoff seam — human trigger today. Mechanism (encode) lives in core, so a
  // future agent-initiated/server trigger reuses it. Seed the target run with the
  // payload, launch it through CopilotKitCore, open its modal.
  const requestHandoff = useCallback(
    (targetId: string, payload: HandoffPayload) => {
      const target = agentsRef.current[targetId]
      if (!target) return
      const seed = encodeHandoff(payload) as Message
      // Fresh handoff run: replace any prior history with just the seed.
      target.messages.splice(0, target.messages.length, seed)
      void copilotkit.runAgent({ agent: target })
      setOpenId(targetId)
    },
    [copilotkit]
  )

  // Register the generative-UI renderers once (renderLead/saveDraft for reply,
  // renderVerdict for the qualifier). renderVerdict's "Draft reply" forwards here.
  useInboxActions(requestHandoff)

  const renderToolCall = useRenderToolCall()
  const qualifierStatus = useAgentStatus(qualifier, qualifierAgent.approvals)
  const replyStatus = useAgentStatus(reply, replyAgent.approvals)

  return (
    <div style={{ display: 'flex', gap: 16, padding: 24, flexWrap: 'wrap' }}>
      <AgentCard
        name={qualifierAgent.name}
        status={qualifierStatus}
        onStart={() => void copilotkit.runAgent({ agent: qualifier })}
        onOpen={() => setOpenId(qualifierAgent.id)}
      />
      <AgentCard
        name={replyAgent.name}
        status={replyStatus}
        onStart={() => void copilotkit.runAgent({ agent: reply })}
        onOpen={() => setOpenId(replyAgent.id)}
      />
      {openId === qualifierAgent.id && (
        <AgentModal
          agent={qualifier}
          title={qualifierAgent.name}
          renderToolCall={renderToolCall}
          loading={qualifierStatus === 'running'}
          onClose={() => setOpenId(null)}
        />
      )}
      {openId === replyAgent.id && (
        <AgentModal
          agent={reply}
          title={replyAgent.name}
          renderToolCall={renderToolCall}
          loading={replyStatus === 'running'}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/InboxView.tsx
git commit -m "feat(client): two-agent desktop + manual handoff (qualifier -> reply)"
```

---

## Phase 5 — Verification

### Task 16: Typecheck, lint, full test suite

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: PASS — no remaining `inboxAgent` references; client + server match the new core shapes.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: PASS (green). If the `agentsRef` `Record<string, typeof reply>` triggers a rule, keep the type; address any real finding or add a scoped `eslint-disable` with a comment (per CLAUDE.md — lint stays green).

- [ ] **Step 3: Format check**

Run: `npm run format:check`
Expected: PASS. If it fails, run `npm run format` and re-commit.

- [ ] **Step 4: Full test suite**

Run: `npm test`
Expected: PASS — the prior ~41 tests plus the new ones: `handoff` (4), `reply.prompts` (4), `qualifier.prompts` (2), `defineAgent` (+1), `inbox.agent` (rewritten), `renderVerdict` (1).

- [ ] **Step 5: Commit any formatting fixes**

```bash
git add -A
git commit -m "chore: format + lint green for two-agents handoff" || echo "nothing to commit"
```

---

### Task 17: Browser verification on the real account

**Files:** none (manual, requires the real `claude` login + Gmail OAuth at `~/.gmail-mcp/`)

- [ ] **Step 1: Start the app**

Run: `npm run dev`
Expected: server on :4000, client on :5173, `/api` proxied.

- [ ] **Step 2: Drive the happy path** (use the `verify` skill or a Playwright MCP session)

1. Open `http://localhost:5173` → two cards: **LEAD QUALIFIER** and **REPLY AGENT**, both Idle.
2. Click **START** on LEAD QUALIFIER. Open its modal. Expected: real `claude` reads the latest email, then a `VerdictCard` paints (from/subject, a category chip, a priority chip, a one-line reason) and a **Draft reply** button. Card status → Done.
3. Click **Draft reply**. Expected: the REPLY AGENT modal opens, it runs WITHOUT re-reading the inbox, paints a `LeadCard`, then an `ApprovalDialog` ("Save draft"). The reply card status → Awaiting approval.
4. Click **Save draft**. Expected: resume run → "draft saved to Gmail" confirmation text; status → Done.
5. Check Gmail (`sjuser95@gmail.com`): a **draft reply exists in the same thread**, nothing sent.

- [ ] **Step 3: Record the result**

Update `CLAUDE.md` (Handoff section) with the verified status and the branch name, mirroring the Gmail-integration entry. Commit:

```bash
git add CLAUDE.md
git commit -m "docs: two-agents + handoff browser-verified end-to-end"
```

---

## Self-review notes (addressed)

- **Spec coverage:** every spec section maps to a task — passports (T7), provider generalization (T2/T5/T8/T9), handoff layering (T1 core + T13 client trigger + T10 server validation as the seam for the future agent trigger), renderVerdict/VerdictCard (T11/T12), multi-agent desktop (T15), provider coexistence (constraints honoured: PromptStrategy is the LCD seam, factories leave room for a `mastra` entry, no claude-cli quirk leaks into `core/`), data flow + error handling (T13 gating + T5 resume-null path), testing (T1–T7, T13), browser (T17).
- **Malformed-handoff handling:** the spec's "error chunk" is realized as `decodeHandoff` → null (falls back to standalone) plus the client gating the "Draft reply" button on `threadId`; a broken payload can't launch a half-run. This is the simpler, equivalent guarantee.
- **N-agent registry mapping** (spec §7 "map over the registry / AgentSlot") is intentionally simplified to two explicit agents for now; the `agents` array exists and is used for handoff validation. Generalized mapping is deferred to the framework/package-split phase (consistent with "don't over-invest in framework elegance early").
- **Green boundaries:** Tasks 2–7 keep the vitest suite green at Task 7; the server/client typecheck goes red mid-refactor (expected, called out) and returns green at Task 16.
