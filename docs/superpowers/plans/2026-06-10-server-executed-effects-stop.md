# Server-executed Effects + Stop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the server (not the model) execute approved side effects, and make Stop/cancel first-class — for beta build order step 4.

**Architecture:** The model calls the *approval* tool (`saveDraft`) with a proposed artifact; on approve the *server* executes the *effect* (`createDraft`) from the gate form (the edited artifact IS the args), guarded by an `action_ledger` claim (one resolved gate ⇒ one execution) and optimistic `formRev` (mismatch → 409). Effect functions live in the workflow `ServerBinding` (names in `@atizar/core`, functions in the server layer — the `renders` pattern); a boot-time check enforces effect-binding exhaustiveness and that every allow-listed tool is classified `readonly | approvals | renders`. Stop interrupts a live `provider.run()` stream via `iterator.return()` → the claude-cli generator's `finally` kills the subprocess.

**Tech Stack:** TypeScript, zod, Hono, drizzle-orm + Postgres, vitest, `@atizar/{core,providers,integrations}`, `apps/inbox`.

**Spec:** `docs/superpowers/specs/2026-06-10-server-executed-effects-stop-design.md`

**Branch:** continue on `feat/provider-contract-v2` (steps 1–3 live there, unmerged).

---

## File Structure

**Create:**
- `packages/integrations/src/gmail-basic/gmail-client.mjs` — shared OAuth/`getGmail`/`errText` (moved out of `index.mjs`).
- `packages/integrations/src/gmail-basic/create-draft.mjs` — pure exported `createDraft({threadId, body}, deps)`.
- `packages/integrations/src/gmail-basic/create-draft.test.ts` — unit test with injected fake gmail.
- `apps/inbox/server/agent-checks.ts` — boot-time `assertAgentClassification` (effects exhaustiveness + allow-list classification).
- `apps/inbox/server/agent-checks.test.ts` — unit tests for the two boot checks.

**Modify:**
- `packages/core/src/defineAgent.ts` — `effects` + `readonly` fields + `effects ⊆ approvals` validation.
- `packages/core/src/providers.ts` — `GateResolution.executedResult?`; `PromptStrategy.buildResume` gains `executedResult` arg.
- `packages/providers/src/claude-cli-provider.ts` — thread `executedResult` into `buildResume`.
- `packages/integrations/src/gmail-basic/index.mjs` — import the extracted helpers; thin MCP wrappers.
- `packages/integrations/package.json` — add the `./gmail-basic/create-draft` export.
- `apps/inbox/workflows/server-binding.ts` — `effects?` map on `ServerBinding`.
- `apps/inbox/workflows/lead-inbox/server.ts` — reply `effects` binding; drop `create_draft` from allow-list.
- `apps/inbox/workflows/lead-inbox/descriptor.ts` — `effects`/`readonly` on the passports.
- `apps/inbox/agents/reply.prompts.ts` — propose-don't-execute resume prompt.
- `apps/inbox/server/pipeline/transition.ts` — `cancel`/`reject` edges + resolution; guard scope.
- `apps/inbox/server/pipeline/workerPool.ts` — `dequeue(id, agentId)`.
- `apps/inbox/server/pipeline/runObserver.ts` — explicit iterator + `cancel(id)` + terminal-tolerant `consume`.
- `apps/inbox/server/pipeline/stateStore.ts` — gate-by-id, ledger claim/result, resolution, active-children/by-workflow reads.
- `apps/inbox/server/pipeline/pipelineService.ts` — `resolveGate` (formRev/ledger/execute/resume), `cancel`, `cancelWorkflow`, `getOpenGate`.
- `apps/inbox/server/pipeline/routes.ts` — `/api/gates/:id/resolve`, `/api/workitems/:id/cancel`, `/api/workflows/:id/cancel`, `GET /api/workitems/:id/gate`; remove the dev resolve.
- `apps/inbox/server/index.ts` — boot checks; `effects` into `AgentRuntime`.
- `apps/inbox/server/pipeline/runObserver.ts` (`AgentRuntime`) — `effects` field.
- `apps/inbox/client/src/spike/TraceSpike.tsx` — gate-id resolve + edit + reject + cancel.

**Commands (repo root):** `yarn test`, `yarn typecheck`, `yarn lint`, `yarn format:check`. A single test file: `yarn test <path>` (vitest picks up the root config). Postgres tests use the `aiworkflow_test` DB (already wired via vitest `test.env` + `globalSetup`).

---

## Task 1: `defineAgent` gains `effects` + `readonly` (`effects ⊆ approvals`)

**Files:**
- Modify: `packages/core/src/defineAgent.ts`
- Test: `packages/core/src/defineAgent.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/src/defineAgent.test.ts`:

```ts
it('accepts effects that are a subset of approvals', () => {
  const def = defineAgent({
    id: 'reply',
    name: 'REPLY',
    provider: 'claude-cli',
    instructions: 'x',
    tools: ['renderLead', 'saveDraft'],
    approvals: ['saveDraft'],
    effects: ['saveDraft'],
    readonly: [],
    renders: { renderLead: 'LeadCard', saveDraft: 'ApprovalDialog' },
  })
  expect(def.effects).toEqual(['saveDraft'])
  expect(def.readonly).toEqual([])
})

it('rejects an effect that is not an approval', () => {
  expect(() =>
    defineAgent({
      id: 'reply',
      name: 'REPLY',
      provider: 'claude-cli',
      instructions: 'x',
      tools: ['renderLead', 'saveDraft'],
      approvals: ['saveDraft'],
      effects: ['renderLead'], // not an approval
      renders: {},
    })
  ).toThrow(/effect "renderLead" is not an approval/)
})

it('defaults effects and readonly to empty arrays', () => {
  const def = defineAgent({
    id: 'q',
    name: 'Q',
    provider: 'claude-cli',
    instructions: 'x',
    tools: [],
    approvals: [],
    renders: {},
  })
  expect(def.effects).toEqual([])
  expect(def.readonly).toEqual([])
})
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `yarn test packages/core/src/defineAgent.test.ts`
Expected: FAIL — `effects`/`readonly` not on the parsed object; the "is not an approval" refine does not exist yet.

- [ ] **Step 3: Implement the fields + validation**

In `packages/core/src/defineAgent.ts`, add to the `z.object({...})` (after `renders`):

```ts
    // Approval tools whose resolution triggers a SERVER-executed effect (the function
    // lives in the workflow ServerBinding; the model never sees an effect tool).
    effects: z.array(z.string()).default([]),
    // Read-only tools, declared so the boot-time allow-list classification is exhaustive.
    readonly: z.array(z.string()).default([]),
```

Add to the `superRefine` body (after the existing `renders` loop):

```ts
    for (const name of def.effects) {
      if (!def.approvals.includes(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `effect "${name}" is not an approval`,
        })
      }
    }
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `yarn test packages/core/src/defineAgent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/defineAgent.ts packages/core/src/defineAgent.test.ts
git commit -m "feat(core): defineAgent effects (⊆ approvals) + readonly classification fields"
```

---

## Task 2: `GateResolution.executedResult` + `buildResume` executedResult arg

**Files:**
- Modify: `packages/core/src/providers.ts`

This is a type/interface change verified by typecheck (no behavior to unit-test in isolation; downstream tasks exercise it).

- [ ] **Step 1: Add `executedResult` to `GateResolution`**

In `packages/core/src/providers.ts`, change `GateResolution`:

```ts
export interface GateResolution {
  gateId: string
  decision: 'approved' | 'rejected'
  form?: Record<string, unknown>
  comment?: string
  // Filled at step 4 once the SERVER has executed the approved effect: the integration
  // result (e.g. { draftId }). The resume prompt narrates "the action was executed with
  // this result"; the model never re-performs the effect.
  executedResult?: Record<string, unknown>
}
```

- [ ] **Step 2: Widen `PromptStrategy.buildResume`**

In the same file, change `buildResume`:

```ts
export interface PromptStrategy {
  buildFirst(input: RunAgentInput): string
  // `args` is the approved/edited artifact; `executedResult` is the server's effect result
  // (present at step 4+). Returns null when no usable resume → the provider errors.
  buildResume?(args: Record<string, unknown>, executedResult?: Record<string, unknown>): string | null
}
```

- [ ] **Step 3: Verify typecheck still builds (callers are optional/back-compatible)**

Run: `yarn typecheck`
Expected: PASS — `executedResult` is optional everywhere; existing `buildResume(args)` calls remain valid.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/providers.ts
git commit -m "feat(core): GateResolution.executedResult + buildResume executedResult arg"
```

---

## Task 3: Extract `createDraft` from the Gmail MCP into a pure exported function

**Files:**
- Create: `packages/integrations/src/gmail-basic/gmail-client.mjs`
- Create: `packages/integrations/src/gmail-basic/create-draft.mjs`
- Create: `packages/integrations/src/gmail-basic/create-draft.test.ts`
- Modify: `packages/integrations/src/gmail-basic/index.mjs`
- Modify: `packages/integrations/package.json`

- [ ] **Step 1: Write the failing test**

Create `packages/integrations/src/gmail-basic/create-draft.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createDraft } from './create-draft.mjs'

function fakeGmail(overrides = {}) {
  const calls = { drafts: [] }
  const gmail = {
    users: {
      threads: {
        get: async () => ({
          data: {
            messages: [
              {
                payload: {
                  headers: [
                    { name: 'From', value: 'lead@example.com' },
                    { name: 'Subject', value: 'Pricing question' },
                  ],
                },
              },
            ],
          },
        }),
      },
      drafts: {
        create: async ({ requestBody }) => {
          calls.drafts.push(requestBody)
          return { data: { id: 'draft-123' } }
        },
      },
    },
  }
  return { gmail: { ...gmail, ...overrides }, calls }
}

describe('createDraft', () => {
  it('creates a draft and returns the draftId', async () => {
    const { gmail, calls } = fakeGmail()
    const res = await createDraft({ threadId: 't1', body: 'Hello there' }, { getGmail: async () => gmail })
    expect(res).toEqual({ ok: true, draftId: 'draft-123' })
    expect(calls.drafts).toHaveLength(1)
    expect(calls.drafts[0].message.threadId).toBe('t1')
  })

  it('returns an error when the thread has no From header', async () => {
    const noFrom = {
      users: {
        threads: { get: async () => ({ data: { messages: [{ payload: { headers: [] } }] } }) },
        drafts: { create: async () => ({ data: { id: 'x' } }) },
      },
    }
    const res = await createDraft({ threadId: 't1', body: 'Hi' }, { getGmail: async () => noFrom })
    expect(res.error).toMatch(/recipient/i)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `yarn test packages/integrations/src/gmail-basic/create-draft.test.ts`
Expected: FAIL — `create-draft.mjs` does not exist.

- [ ] **Step 3: Create `gmail-client.mjs` (moved shared helpers)**

Create `packages/integrations/src/gmail-basic/gmail-client.mjs` by MOVING the auth block + `errText` out of `index.mjs`:

```js
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { optionalPeerError } from '../optional-peer.mjs'

const keysPath =
  process.env.GMAIL_OAUTH_KEYS || join(homedir(), '.gmail-mcp', 'gcp-oauth.keys.json')
const credsPath =
  process.env.GMAIL_OAUTH_CREDENTIALS || join(homedir(), '.gmail-mcp', 'credentials.json')

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
export async function getGmail() {
  if (_gmail) return _gmail
  const google = await loadGoogleapis()
  const keys = JSON.parse(readFileSync(keysPath, 'utf8'))
  const clientData = keys.installed || keys.web
  if (!clientData)
    throw new Error('gcp-oauth.keys.json has neither "installed" nor "web" client config')
  const { client_id, client_secret, redirect_uris } = clientData
  const auth = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris?.[0] || 'http://localhost:3000/oauth2callback'
  )
  const creds = JSON.parse(readFileSync(credsPath, 'utf8'))
  auth.setCredentials(creds)
  _gmail = google.gmail({ version: 'v1', auth })
  return _gmail
}

export function errText(err) {
  return err?.response?.data?.error?.message ?? err?.message ?? String(err)
}
```

- [ ] **Step 4: Create `create-draft.mjs` (the extracted logic, injectable getGmail)**

Create `packages/integrations/src/gmail-basic/create-draft.mjs`:

```js
import { buildReplyRaw } from './format.mjs'
import { getGmail as defaultGetGmail, errText } from './gmail-client.mjs'

// Pure, importable effect: create a Gmail DRAFT reply for a thread. NEVER sends.
// `getGmail` is injectable so the server imports this directly (no MCP child) and tests
// pass a fake client. Returns { ok:true, draftId } or { error }.
export async function createDraft({ threadId, body }, deps = {}) {
  const getGmail = deps.getGmail ?? defaultGetGmail
  try {
    const gmail = await getGmail()
    const thread = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject'],
    })
    const messages = thread.data.messages ?? []
    const lastMsg = messages[messages.length - 1]
    const headers = lastMsg?.payload?.headers ?? []
    const findHeader = (name) => {
      const lower = name.toLowerCase()
      return headers.find((h) => h.name.toLowerCase() === lower)?.value ?? ''
    }
    const to = findHeader('From')
    const subject = findHeader('Subject')
    if (!to) return { error: 'Could not derive a recipient from the thread (no From header).' }

    const raw = buildReplyRaw({ to, subject, body, threadId })
    const draft = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw, threadId } },
    })
    return { ok: true, draftId: draft.data.id }
  } catch (err) {
    return { error: errText(err) }
  }
}
```

- [ ] **Step 5: Rewrite `index.mjs` to import the extracted helpers**

In `packages/integrations/src/gmail-basic/index.mjs`:
- Remove the moved blocks: `loadGoogleapis`, `getGmail`/`_gmail`, `errText`, `keysPath`/`credsPath`, and the `readFileSync`/`homedir`/`join`/`optionalPeerError` imports.
- Add imports near the top:

```js
import { getGmail, errText } from './gmail-client.mjs'
import { createDraft } from './create-draft.mjs'
```

- Replace the `create_draft` tool handler body (currently lines ~118–169) with a thin wrapper:

```js
  async ({ threadId, body }) => {
    const res = await createDraft({ threadId, body })
    return { content: [{ type: 'text', text: JSON.stringify(res) }] }
  }
```

(Leave the `get_latest_email` tool as-is — it now uses the imported `getGmail`/`errText`.)

- [ ] **Step 6: Add the package export**

In `packages/integrations/package.json`, add under `exports` (after the format line):

```json
    "./gmail-basic/create-draft": "./src/gmail-basic/create-draft.mjs"
```

- [ ] **Step 7: Run the test + typecheck**

Run: `yarn test packages/integrations/src/gmail-basic/create-draft.test.ts && yarn typecheck`
Expected: PASS (both new tests pass; typecheck clean).

- [ ] **Step 8: Commit**

```bash
git add packages/integrations/src/gmail-basic/ packages/integrations/package.json
git commit -m "refactor(integrations): extract createDraft into a pure exported function"
```

---

## Task 4: `ServerBinding.effects` + boot-time checks + lead-inbox wiring

**Files:**
- Modify: `apps/inbox/workflows/server-binding.ts`
- Create: `apps/inbox/server/agent-checks.ts`
- Create: `apps/inbox/server/agent-checks.test.ts`
- Modify: `apps/inbox/workflows/lead-inbox/descriptor.ts`
- Modify: `apps/inbox/workflows/lead-inbox/server.ts`
- Modify: `apps/inbox/server/pipeline/runObserver.ts` (`AgentRuntime`)
- Modify: `apps/inbox/server/index.ts`

- [ ] **Step 1: Add `effects` to `ServerBinding`**

In `apps/inbox/workflows/server-binding.ts`:

```ts
import type { PromptStrategy } from '@atizar/core'

// A server-executed effect: keyed by APPROVAL tool name, called by the server on approve
// with the gate form (the edited artifact = the args) + context. Returns the result that
// becomes the ledger entry + the resume narrative. The model never sees this function.
export type EffectFn = (
  form: Record<string, unknown>,
  ctx: { workItemId: string; gateId: string }
) => Promise<Record<string, unknown>>

export type ServerBinding = {
  agentId: string
  prompts: PromptStrategy
  allowedTools: string[]
  effects?: Record<string, EffectFn>
}
```

- [ ] **Step 2: Write the failing boot-check tests**

Create `apps/inbox/server/agent-checks.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { defineAgent } from '@atizar/core'
import { assertAgentClassification } from './agent-checks.js'

const reply = defineAgent({
  id: 'reply',
  name: 'REPLY',
  provider: 'claude-cli',
  instructions: 'x',
  tools: ['renderLead', 'saveDraft'],
  approvals: ['saveDraft'],
  effects: ['saveDraft'],
  renders: { renderLead: 'LeadCard', saveDraft: 'ApprovalDialog' },
})

describe('assertAgentClassification', () => {
  it('passes when every allow-listed tool is classified and effects are bound', () => {
    expect(() =>
      assertAgentClassification(reply, {
        allowedTools: ['mcp__inbox__renderLead', 'mcp__inbox__saveDraft'],
        effects: { saveDraft: async () => ({}) },
      })
    ).not.toThrow()
  })

  it('throws when an allow-listed tool is unclassified', () => {
    expect(() =>
      assertAgentClassification(reply, {
        allowedTools: ['mcp__inbox__renderLead', 'mcp__inbox__saveDraft', 'mcp__gmail__create_draft'],
        effects: { saveDraft: async () => ({}) },
      })
    ).toThrow(/create_draft.*not classified/)
  })

  it('throws when a declared effect has no bound function', () => {
    expect(() =>
      assertAgentClassification(reply, {
        allowedTools: ['mcp__inbox__renderLead', 'mcp__inbox__saveDraft'],
        effects: {},
      })
    ).toThrow(/effect "saveDraft" declared but not bound/)
  })

  it('throws when a bound effect is not declared', () => {
    expect(() =>
      assertAgentClassification(reply, {
        allowedTools: ['mcp__inbox__renderLead', 'mcp__inbox__saveDraft'],
        effects: { saveDraft: async () => ({}), phantom: async () => ({}) },
      })
    ).toThrow(/effect "phantom" bound but not declared/)
  })
})
```

- [ ] **Step 2b: Run the tests, verify they fail**

Run: `yarn test apps/inbox/server/agent-checks.test.ts`
Expected: FAIL — `agent-checks.ts` does not exist.

- [ ] **Step 3: Implement `agent-checks.ts`**

Create `apps/inbox/server/agent-checks.ts`:

```ts
import type { AgentDefinition } from '@atizar/core'
import type { EffectFn } from '../workflows/server-binding.js'

// Strip the `mcp__<server>__` prefix to the bare tool name the passport declares.
function bareName(fullyQualified: string): string {
  if (!fullyQualified.startsWith('mcp__')) return fullyQualified
  const rest = fullyQualified.slice('mcp__'.length)
  const sep = rest.indexOf('__')
  return sep === -1 ? rest : rest.slice(sep + 2)
}

// Boot-time invariants (fail-fast — never a silent approve-time no-op or an ungated effect):
//   1. effect-binding exhaustiveness BOTH ways (declared ⇔ bound).
//   2. every allow-listed tool is classified readonly | approvals | renders.
export function assertAgentClassification(
  def: AgentDefinition,
  binding: { allowedTools: string[]; effects?: Record<string, EffectFn> }
): void {
  const declared = new Set(def.effects)
  const bound = new Set(Object.keys(binding.effects ?? {}))
  for (const name of declared) {
    if (!bound.has(name)) throw new Error(`agent "${def.id}": effect "${name}" declared but not bound`)
  }
  for (const name of bound) {
    if (!declared.has(name)) throw new Error(`agent "${def.id}": effect "${name}" bound but not declared`)
  }

  const classified = new Set<string>([...def.readonly, ...def.approvals, ...Object.keys(def.renders)])
  for (const tool of binding.allowedTools) {
    const bare = bareName(tool)
    if (!classified.has(bare)) {
      throw new Error(
        `agent "${def.id}": tool "${bare}" (from "${tool}") is not classified — declare it in readonly | approvals | renders`
      )
    }
  }
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `yarn test apps/inbox/server/agent-checks.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the lead-inbox passports**

In `apps/inbox/workflows/lead-inbox/descriptor.ts`, add to `replyAgent`:

```ts
  approvals: ['saveDraft'],
  effects: ['saveDraft'],
```

and to `qualifierAgent`, add `readonly` (it reads the inbox):

```ts
  readonly: ['get_latest_email'],
```

- [ ] **Step 6: Wire the reply effect + drop `create_draft` from the allow-list**

Rewrite `apps/inbox/workflows/lead-inbox/server.ts`:

```ts
import type { ServerBinding } from '../server-binding.js'
import { createQualifierPrompts } from '../../agents/qualifier.prompts.js'
import { createReplyPrompts } from '../../agents/reply.prompts.js'
import { qualifierAgent, replyAgent } from './descriptor.js'
import { createDraft } from '@atizar/integrations/gmail-basic/create-draft'

export const leadInboxServer = (origin: string): ServerBinding[] => [
  {
    agentId: qualifierAgent.id,
    prompts: createQualifierPrompts(qualifierAgent.instructions, origin),
    allowedTools: ['mcp__inbox__renderVerdict', 'mcp__gmail__get_latest_email'],
  },
  {
    agentId: replyAgent.id,
    prompts: createReplyPrompts(replyAgent.instructions),
    // create_draft is GONE from the model's allow-list — it is now a server effect.
    allowedTools: ['mcp__inbox__renderLead', 'mcp__inbox__saveDraft'],
    effects: {
      // The approved/edited form { threadId, body } IS the createDraft args, byte-verbatim.
      saveDraft: (form) =>
        createDraft({ threadId: String(form.threadId ?? ''), body: String(form.body ?? '') }),
    },
  },
]
```

- [ ] **Step 7: Add `effects` to `AgentRuntime` and wire the boot check + runtime**

In `apps/inbox/server/pipeline/runObserver.ts`, extend `AgentRuntime`:

```ts
import type { EffectFn } from '../../workflows/server-binding.js'

export interface AgentRuntime {
  provider: Provider
  renderToolNames: string[]
  maxInstances: number
  // Server-executed effects, keyed by approval tool name (step 4). Empty for read-only agents.
  effects: Record<string, EffectFn>
}
```

In `apps/inbox/server/index.ts`, inside the `for (const b of bindings(...))` loop, after `const def = byId.get(b.agentId)` (and the existing throw), add the boot check, then populate `effects`:

```ts
    assertAgentClassification(def, { allowedTools: b.allowedTools, effects: b.effects })
```

and change the `runtimes[key] = {...}` to include effects:

```ts
    runtimes[key] = {
      provider,
      renderToolNames: Object.keys(def.renders),
      maxInstances: def.maxInstances,
      effects: b.effects ?? {},
    }
```

Add the import at the top of `index.ts`:

```ts
import { assertAgentClassification } from './agent-checks.js'
```

- [ ] **Step 8: Run typecheck + the affected tests**

Run: `yarn typecheck && yarn test apps/inbox/server/agent-checks.test.ts`
Expected: PASS. (Typecheck confirms `AgentRuntime.effects` is now satisfied everywhere it's constructed.)

- [ ] **Step 9: Commit**

```bash
git add apps/inbox/workflows/server-binding.ts apps/inbox/server/agent-checks.ts apps/inbox/server/agent-checks.test.ts apps/inbox/workflows/lead-inbox/ apps/inbox/server/pipeline/runObserver.ts apps/inbox/server/index.ts
git commit -m "feat(inbox): ServerBinding.effects + boot-time classification/exhaustiveness checks"
```

---

## Task 5: `transition.ts` — `cancel` + `reject` edges with resolution

**Files:**
- Modify: `apps/inbox/server/pipeline/transition.ts`
- Test: `apps/inbox/server/pipeline/transition.test.ts`

**Decision (documented):** the active-children *deferral* guard applies to `finish` only (the parent-stream-ended race). `cancel`/`reject` are explicit human commands that always transition; the cancel route (Task 7) cascades to descendants and cancels the **parent first** (ascending id) so a child's terminal edge never auto-finishes a parent that is about to be cancelled. `cancel`/`reject` set the `resolution` marker column.

- [ ] **Step 1: Write the failing tests**

Add to `apps/inbox/server/pipeline/transition.test.ts` (follow the file's existing helpers for inserting a work item; use unique uuids/sources, NO truncate):

```ts
it('cancel from running → finished with resolution cancelled', async () => {
  const id = await insertRunning() // helper: inserts queued then transition(start)
  await transition(db, id, 'cancel')
  const row = await getRow(id)
  expect(row.status).toBe('finished')
  expect(row.resolution).toBe('cancelled')
})

it('cancel is legal from queued and awaiting_approval', async () => {
  const q = await insertQueued()
  await expect(transition(db, q, 'cancel')).resolves.not.toThrow()
  const g = await insertAwaitingApproval() // start → gate
  await transition(db, g, 'cancel')
  expect((await getRow(g)).resolution).toBe('cancelled')
})

it('reject from awaiting_approval → finished with resolution rejected', async () => {
  const id = await insertAwaitingApproval()
  await transition(db, id, 'reject')
  const row = await getRow(id)
  expect(row.status).toBe('finished')
  expect(row.resolution).toBe('rejected')
})

it('reject is illegal from running', async () => {
  const id = await insertRunning()
  await expect(transition(db, id, 'reject')).rejects.toThrow(/cannot "reject"/)
})
```

If `insertRunning`/`insertQueued`/`insertAwaitingApproval`/`getRow` helpers do not already exist in this test file, add them at the top using `stateStore.insertWorkItem` + `transition(db, id, 'start'|'gate')` and a direct `db.select().from(workItems)`.

- [ ] **Step 2: Run the tests, verify they fail**

Run: `yarn test apps/inbox/server/pipeline/transition.test.ts`
Expected: FAIL — `cancel`/`reject` are not in `EDGES`; `resolution` is never set.

- [ ] **Step 3: Implement the edges + resolution**

In `apps/inbox/server/pipeline/transition.ts`:

Change the `Edge` type:

```ts
export type Edge = 'start' | 'gate' | 'resume' | 'finish' | 'fail' | 'cancel' | 'reject'
```

Add to `EDGES`:

```ts
  cancel: { from: ['queued', 'running', 'awaiting_approval', 'awaiting_input'], to: 'finished' },
  reject: { from: ['awaiting_approval'], to: 'finished' },
```

Add a resolution map below `EDGES`:

```ts
// Terminal-outcome marker set by explicit human commands (orthogonal to status).
const EDGE_RESOLUTION: Partial<Record<Edge, 'cancelled' | 'rejected'>> = {
  cancel: 'cancelled',
  reject: 'rejected',
}
```

In the `UPDATE` `.set({...})` inside `transition`, add the resolution:

```ts
      .set({
        status: spec.to,
        updatedAt: new Date(),
        ...(edge === 'fail' && opts.error ? { error: opts.error } : {}),
        ...(EDGE_RESOLUTION[edge] ? { resolution: EDGE_RESOLUTION[edge] } : {}),
      })
```

Keep the existing `if (edge === 'finish' && (await hasActiveChild(tx, id))) return` guard scoped to `finish` only (do NOT extend it to cancel/reject — see the decision above). The auto-finish parent walk stays on `finish` only as well.

- [ ] **Step 4: Run the tests, verify they pass**

Run: `yarn test apps/inbox/server/pipeline/transition.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/server/pipeline/transition.ts apps/inbox/server/pipeline/transition.test.ts
git commit -m "feat(pipeline): transition cancel/reject edges + resolution marker"
```

---

## Task 6: WorkerPool `dequeue` + RunObserver explicit iterator, `cancel`, terminal-tolerant `consume`

**Files:**
- Modify: `apps/inbox/server/pipeline/workerPool.ts`
- Test: `apps/inbox/server/pipeline/workerPool.test.ts`
- Modify: `apps/inbox/server/pipeline/runObserver.ts`

- [ ] **Step 1: Write the failing WorkerPool test**

Add to `apps/inbox/server/pipeline/workerPool.test.ts`:

```ts
it('dequeue removes a queued id without starting it', () => {
  const started: string[] = []
  const pool = makeWorkerPool({ run: (id) => started.push(id) })
  pool.enqueue('a', 'agent', 1) // starts a (cap 1)
  pool.enqueue('b', 'agent', 1) // queued
  pool.enqueue('c', 'agent', 1) // queued
  expect(pool.queuedCount('agent')).toBe(2)
  pool.dequeue('b', 'agent')
  expect(pool.queuedCount('agent')).toBe(1)
  pool.release('agent') // frees a → next in queue is c (b was removed)
  expect(started).toEqual(['a', 'c'])
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `yarn test apps/inbox/server/pipeline/workerPool.test.ts`
Expected: FAIL — `pool.dequeue` is not a function.

- [ ] **Step 3: Add `dequeue` to the pool**

In `apps/inbox/server/pipeline/workerPool.ts`, add to the `WorkerPool` interface:

```ts
  dequeue(id: string, agentId: string): void
```

and to the returned object (after `enqueue`):

```ts
    dequeue(id, agentId) {
      const s = slots.get(agentId)
      if (!s) return
      const i = s.queue.indexOf(id)
      if (i !== -1) s.queue.splice(i, 1)
    },
```

- [ ] **Step 4: Run it, verify it passes**

Run: `yarn test apps/inbox/server/pipeline/workerPool.test.ts`
Expected: PASS.

- [ ] **Step 5: Make `consume` drive an explicit iterator + register it + terminal-tolerant finish**

In `apps/inbox/server/pipeline/runObserver.ts`:

Add a module-level map inside `makeRunObserver` (top of the factory body, beside the deps destructure):

```ts
  // Live executor iterators, so Stop can interrupt a running stream: iterator.return()
  // runs the provider generator's finally → child.kill(). Keyed by workItemId.
  const live = new Map<string, AsyncIterator<BaseEvent>>()
```

Replace the `for await (const event of iterable)` loop in `consume` with an explicit iterator so it can be interrupted, and register/unregister it:

```ts
    let seq = (await store.getTrace(id, 0)).length
    let gateOpened = false
    const openCalls = new Map<string, { name: string; args: string }>()
    const iterator = iterable[Symbol.asyncIterator]()
    live.set(id, iterator)

    try {
      while (true) {
        const next = await iterator.next()
        if (next.done) break
        const event = next.value
        await store.appendTrace(id, seq, event)
        bus.publish(`workitem:${id}`, { seq, event })
        seq++
        // ... (the existing tool-call/card + readGateOpened block, unchanged) ...
      }
      // ... (the existing gateOpened / finish blocks, see Step 6 for the terminal guard) ...
    } catch (err) {
      // ... unchanged ...
    } finally {
      live.delete(id)
    }
```

(Keep the body of the loop — the `openCalls`/`setCard` logic and the `readGateOpened` → insertGate/transition(gate) block — exactly as it is today.)

- [ ] **Step 6: Make the finish path terminal-tolerant**

Still in `consume`, replace the post-loop finish block with a re-check (a cancel may have already finished the item):

```ts
      if (gateOpened) {
        pool.release(wi.agentId)
        return
      }
      const current = (await store.getWorkItem(id))?.status
      if (current && (current === 'finished' || current === 'error' || current === 'closed')) {
        // A concurrent cancel already finalized this item — do not override it.
        pool.release(wi.agentId)
        return
      }
      await transition(db, id, 'finish')
      const final = (await store.getWorkItem(id))?.status ?? 'finished'
      publishStatus(id, final)
      pool.release(wi.agentId)
```

- [ ] **Step 7: Add `cancel(id)` to the RunObserver interface + implementation**

In the `RunObserver` interface:

```ts
export interface RunObserver {
  run(id: string): Promise<void>
  resume(id: string, resolution: GateResolution): Promise<void>
  cancel(id: string): void
}
```

In the returned object (after `resume`):

```ts
    cancel(id) {
      // Interrupt a live stream: return() the iterator → provider generator finally → kill.
      // The status transition + slot release are the caller's (PipelineService.cancel)
      // responsibility; here we only stop the executor. No-op if not running.
      const iterator = live.get(id)
      if (iterator?.return) void iterator.return(undefined).catch(() => {})
    },
```

- [ ] **Step 8: Run typecheck + the pipeline tests**

Run: `yarn typecheck && yarn test apps/inbox/server/pipeline/`
Expected: PASS (existing RunObserver tests still pass; the iterator refactor is behavior-preserving for the non-cancel path).

- [ ] **Step 9: Commit**

```bash
git add apps/inbox/server/pipeline/workerPool.ts apps/inbox/server/pipeline/workerPool.test.ts apps/inbox/server/pipeline/runObserver.ts
git commit -m "feat(pipeline): WorkerPool.dequeue + RunObserver explicit-iterator cancel + terminal-tolerant finish"
```

---

## Task 7: StateStore + PipelineService `resolveGate` (formRev/ledger/execute/resume), `cancel`, `cancelWorkflow`

**Files:**
- Modify: `apps/inbox/server/pipeline/stateStore.ts`
- Test: `apps/inbox/server/pipeline/stateStore.test.ts`
- Modify: `apps/inbox/server/pipeline/pipelineService.ts`
- Test: `apps/inbox/server/pipeline/pipelineService.test.ts` (or the existing pipeline-service test file — match the repo's name)

- [ ] **Step 1: Write the failing StateStore tests (ledger one-execution + gate-by-id + resolution)**

Add to `apps/inbox/server/pipeline/stateStore.test.ts`:

```ts
it('claimLedger is idempotent — second claim reports alreadyClaimed with the prior result', async () => {
  const store = makeStateStore(db)
  const wi = await store.insertWorkItem({ workflowId: 'wf', agentId: 'wf__a', origin: 'human', payload: {} })
  const key = `${wi.id}:gate-1`
  const first = await store.claimLedger({ key, workItemId: wi.id, gateId: 'gate-1' })
  expect(first.alreadyClaimed).toBe(false)
  await store.setLedgerResult(key, { draftId: 'd1' })
  const second = await store.claimLedger({ key, workItemId: wi.id, gateId: 'gate-1' })
  expect(second.alreadyClaimed).toBe(true)
  expect(second.result).toEqual({ draftId: 'd1' })
})

it('getGate returns a gate by id; setResolution marks the work item', async () => {
  const store = makeStateStore(db)
  const wi = await store.insertWorkItem({ workflowId: 'wf', agentId: 'wf__a', origin: 'human', payload: {} })
  const gate = await store.insertGate({
    workItemId: wi.id,
    toolName: 'saveDraft',
    toolCallId: 'tc1',
    proposedArtifact: { threadId: 't', body: 'b' },
  })
  expect((await store.getGate(gate.id))?.id).toBe(gate.id)
  await store.setResolution(wi.id, 'rejected')
  expect((await store.getWorkItem(wi.id))?.resolution).toBe('rejected')
})
```

- [ ] **Step 2: Run them, verify they fail**

Run: `yarn test apps/inbox/server/pipeline/stateStore.test.ts`
Expected: FAIL — `claimLedger`/`setLedgerResult`/`getGate`/`setResolution` do not exist.

- [ ] **Step 3: Implement the StateStore additions**

In `apps/inbox/server/pipeline/stateStore.ts`, add `actionLedger` + `ResolutionKind` to the schema imports, then add these methods to the returned object:

```ts
    async getGate(gateId: string): Promise<Gate | undefined> {
      const [row] = await db.select().from(gates).where(eq(gates.id, gateId)).limit(1)
      return row
    },

    async setResolution(id: string, resolution: ResolutionKind): Promise<void> {
      await db.update(workItems).set({ resolution, updatedAt: new Date() }).where(eq(workItems.id, id))
    },

    // One-time effect claim. INSERT … ON CONFLICT DO NOTHING; if the row already existed,
    // report alreadyClaimed with whatever result was recorded (null until setLedgerResult).
    async claimLedger(input: {
      key: string
      workItemId: string
      gateId: string
    }): Promise<{ alreadyClaimed: boolean; result: Record<string, unknown> | null }> {
      const inserted = await db
        .insert(actionLedger)
        .values({ key: input.key, workItemId: input.workItemId, gateId: input.gateId })
        .onConflictDoNothing()
        .returning()
      if (inserted.length > 0) return { alreadyClaimed: false, result: null }
      const [row] = await db.select().from(actionLedger).where(eq(actionLedger.key, input.key)).limit(1)
      return { alreadyClaimed: true, result: row?.result ?? null }
    },

    async setLedgerResult(key: string, result: Record<string, unknown>): Promise<void> {
      await db.update(actionLedger).set({ result }).where(eq(actionLedger.key, key))
    },

    // Active descendants of `id` (depth-first), and active items of a workflow — for cancel.
    async getActiveChildren(parentId: string): Promise<WorkItem[]> {
      const rows = await db.select().from(workItems).where(eq(workItems.parentId, parentId))
      return rows.filter((r) => ACTIVE_STATUSES.includes(r.status))
    },

    async getActiveByWorkflow(workflowId: string): Promise<WorkItem[]> {
      const rows = await db.select().from(workItems).where(eq(workItems.workflowId, workflowId))
      return rows.filter((r) => ACTIVE_STATUSES.includes(r.status))
    },
```

Add near the top of the file (after imports):

```ts
const ACTIVE_STATUSES: WorkItem['status'][] = ['queued', 'running', 'awaiting_approval', 'awaiting_input']
```

Add to the schema import list: `actionLedger`, and to the type imports: `type ResolutionKind`.

- [ ] **Step 4: Run the StateStore tests, verify they pass**

Run: `yarn test apps/inbox/server/pipeline/stateStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing PipelineService tests (formRev 409, double-resolve one execution, reject)**

Add to the pipeline-service test file (use a fake `resolveAgent` whose `effects.saveDraft` counts calls; record/replay off; insert a work item, transition to `awaiting_approval`, insert a gate):

```ts
it('approve: wrong formRev → 409, no effect executed', async () => {
  const effect = vi.fn(async () => ({ draftId: 'd1' }))
  const svc = makeService({ effects: { saveDraft: effect } })
  const { gateId } = await seedGate(svc) // helper: dispatch → start → gate, returns ids
  const res = await svc.resolveGate(gateId, { gateId, decision: 'approved', formRev: 999, form: { threadId: 't', body: 'b' } })
  expect(res.ok).toBe(false)
  expect(res.status).toBe(409)
  expect(effect).not.toHaveBeenCalled()
})

it('approve: executes the effect exactly once even on double-resolve', async () => {
  const effect = vi.fn(async () => ({ draftId: 'd1' }))
  const svc = makeService({ effects: { saveDraft: effect } })
  const { gateId } = await seedGate(svc)
  const a = await svc.resolveGate(gateId, { gateId, decision: 'approved', formRev: 0, form: { threadId: 't', body: 'edited' } })
  const b = await svc.resolveGate(gateId, { gateId, decision: 'approved', formRev: 0, form: { threadId: 't', body: 'edited' } })
  expect(a.ok).toBe(true)
  expect(b.ok).toBe(true) // idempotent — returns the prior result
  expect(effect).toHaveBeenCalledTimes(1)
  expect(effect.mock.calls[0][0]).toEqual({ threadId: 't', body: 'edited' }) // the EDITED form
})

it('reject: no effect, work item resolution = rejected', async () => {
  const effect = vi.fn(async () => ({}))
  const svc = makeService({ effects: { saveDraft: effect } })
  const { gateId, workItemId } = await seedGate(svc)
  const res = await svc.resolveGate(gateId, { gateId, decision: 'rejected', formRev: 0, comment: 'no' })
  expect(res.ok).toBe(true)
  expect(effect).not.toHaveBeenCalled()
  expect((await svc.getStatus(workItemId))?.status).toBe('finished')
})
```

Implement `makeService`/`seedGate` helpers in the test using a fake provider whose `run` yields a `GATE_OPENED` then ends, and whose `resume` yields one text event then ends (so the flow reaches `awaiting_approval` and resume completes). Follow the existing pipeline-service test's fake-provider pattern if present.

- [ ] **Step 6: Run them, verify they fail**

Run: `yarn test apps/inbox/server/pipeline/pipelineService.test.ts`
Expected: FAIL — `resolveGate` signature does not take `formRev`/return `status`; no ledger/effect logic.

- [ ] **Step 7: Rewrite `PipelineService.resolveGate` + add `cancel`/`cancelWorkflow`/`getOpenGate`**

In `apps/inbox/server/pipeline/pipelineService.ts`, replace the `resolveGate` method and add the new ones. New `GateResolution`-shaped input adds `formRev`:

```ts
    // Gate-keyed resolve (step 4): formRev check → ledger claim → SERVER executes the effect
    // → record result → transition + resume primed with the executedResult. One resolved gate
    // licenses exactly one execution (idempotent on re-submit).
    async resolveGate(
      gateId: string,
      resolution: GateResolution & { formRev: number }
    ): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
      const gate = await store.getGate(gateId)
      if (!gate || gate.status !== 'open') return { ok: false, status: 404, error: 'no open gate' }
      const wi = await store.getWorkItem(gate.workItemId)
      if (!wi) return { ok: false, status: 404, error: 'work item gone' }

      if (resolution.decision === 'rejected') {
        await store.resolveGateRow(gate.id, { comment: resolution.comment })
        await store.setResolution(wi.id, 'rejected')
        await transition(db, wi.id, 'reject')
        publishBoard()
        void observer
          .resume(wi.id, { ...resolution, gateId: gate.id })
          .catch((e) => console.error('[pipeline] resume(reject)', wi.id, e))
        return { ok: true }
      }

      // approve
      if (gate.formRev !== resolution.formRev) {
        return { ok: false, status: 409, error: 'formRev mismatch — re-render the gate' }
      }
      const form = resolution.form ?? (gate.form as Record<string, unknown>)
      const key = `${wi.id}:${gate.id}`
      const claim = await store.claimLedger({ key, workItemId: wi.id, gateId: gate.id })

      let executedResult: Record<string, unknown>
      if (claim.alreadyClaimed) {
        executedResult = claim.result ?? {}
      } else {
        const runtime = deps.resolveAgent(wi.agentId)
        const effect = runtime?.effects?.[gate.toolName]
        if (!effect) return { ok: false, status: 500, error: `no effect bound for "${gate.toolName}"` }
        await store.resolveGateRow(gate.id, { form })
        executedResult = await effect(form, { workItemId: wi.id, gateId: gate.id })
        await store.setLedgerResult(key, executedResult)
      }

      await transition(db, wi.id, 'resume')
      publishBoard()
      void observer
        .resume(wi.id, { ...resolution, gateId: gate.id, form, executedResult })
        .catch((e) => console.error('[pipeline] resume(approve)', wi.id, e))
      return { ok: true }
    },

    async getOpenGate(workItemId: string): Promise<Gate | undefined> {
      return store.getOpenGate(workItemId)
    },

    async cancel(workItemId: string): Promise<void> {
      const wi = await store.getWorkItem(workItemId)
      if (!wi) return
      // Cancel the parent FIRST (leaves `running`, so a child's terminal edge won't
      // auto-finish it), then cascade to active descendants in ascending-id order.
      if (wi.status === 'queued') pool.dequeue(workItemId, wi.agentId)
      if (wi.status === 'running') observer.cancel(workItemId)
      const open = await store.getOpenGate(workItemId)
      if (open) await store.resolveGateRow(open.id, { comment: 'cancelled' })
      await transition(db, workItemId, 'cancel').catch(() => {})
      pool.release(wi.agentId)

      const children = await store.getActiveChildren(workItemId)
      for (const child of children.sort((a, b) => a.id.localeCompare(b.id))) {
        await this.cancel(child.id)
      }
      publishBoard()
    },

    async cancelWorkflow(workflowId: string): Promise<void> {
      const active = await store.getActiveByWorkflow(workflowId)
      for (const item of active.sort((a, b) => a.id.localeCompare(b.id))) {
        await this.cancel(item.id)
      }
    },
```

Add a `publishBoard` helper inside `makePipelineService` (the board topic already increments `boardSeq`):

```ts
  const publishBoard = (): void => bus.publish('board', { kind: 'refresh' })
```

Add `transition` to the imports:

```ts
import { transition } from './transition.js'
```

(`Gate` is already imported.)

- [ ] **Step 8: Run the tests, verify they pass**

Run: `yarn test apps/inbox/server/pipeline/`
Expected: PASS (StateStore + PipelineService).

- [ ] **Step 9: Commit**

```bash
git add apps/inbox/server/pipeline/stateStore.ts apps/inbox/server/pipeline/stateStore.test.ts apps/inbox/server/pipeline/pipelineService.ts apps/inbox/server/pipeline/pipelineService.test.ts
git commit -m "feat(pipeline): gate-keyed resolveGate (formRev/ledger/execute/resume) + cancel/cancelWorkflow"
```

---

## Task 8: Routes — gate resolve, cancel, gate read; remove dev resolve

**Files:**
- Modify: `apps/inbox/server/pipeline/routes.ts`

- [ ] **Step 1: Replace the dev resolve route + add the new routes**

In `apps/inbox/server/pipeline/routes.ts`:

Remove the `app.post('/api/dev/workitems/:id/resolve', ...)` block entirely. Add:

```ts
  // RESOLVE a gate (step 4): formRev + ledger + server-executed effect + resume.
  app.post('/api/gates/:id/resolve', async (c) => {
    const gateId = c.req.param('id')
    const body = await c.req.json<{
      formRev: number
      decision: 'approved' | 'rejected'
      form?: Record<string, unknown>
      comment?: string
    }>()
    const result = await service.resolveGate(gateId, {
      gateId,
      formRev: body.formRev,
      decision: body.decision,
      form: body.form,
      comment: body.comment,
    })
    return result.ok ? c.json({ ok: true }) : c.json({ error: result.error }, result.status as 404 | 409 | 500)
  })

  // The open gate for a work item (id + form + formRev for the approve/edit UI).
  app.get('/api/workitems/:id/gate', async (c) => {
    const gate = await service.getOpenGate(c.req.param('id'))
    if (!gate) return c.json({ error: 'no open gate' }, 404)
    return c.json({
      id: gate.id,
      toolName: gate.toolName,
      form: gate.form,
      formRev: gate.formRev,
      proposedArtifact: gate.proposedArtifact,
    })
  })

  // STOP a work item (and its active descendants).
  app.post('/api/workitems/:id/cancel', async (c) => {
    await service.cancel(c.req.param('id'))
    return c.json({ ok: true })
  })

  // STOP every active work item of a workflow.
  app.post('/api/workflows/:id/cancel', async (c) => {
    await service.cancelWorkflow(c.req.param('id'))
    return c.json({ ok: true })
  })
```

- [ ] **Step 2: Typecheck**

Run: `yarn typecheck`
Expected: PASS (the service methods exist from Task 7; the old `resolveGate` dev shape is gone).

- [ ] **Step 3: Commit**

```bash
git add apps/inbox/server/pipeline/routes.ts
git commit -m "feat(pipeline): gate-keyed resolve + cancel routes; drop dev resolve"
```

---

## Task 9: `reply.prompts.ts` — propose-don't-execute resume

**Files:**
- Modify: `apps/inbox/agents/reply.prompts.ts`
- Modify: `packages/providers/src/claude-cli-provider.ts`
- Test: `apps/inbox/agents/reply.prompts.test.ts` (if present) / `packages/providers/src/claude-cli-provider.test.ts`

- [ ] **Step 1: Thread `executedResult` through the provider's resume**

In `packages/providers/src/claude-cli-provider.ts`, change `resumePromptFrom` to pass `executedResult`:

```ts
  function resumePromptFrom(handle: ResumeHandle, resolution: GateResolution): string | null {
    const messages = (handle.input?.messages ?? []) as Message[]
    const args = resolution.form ?? lastApprovalArgs(messages, approvalNames) ?? {}
    return prompts.buildResume?.(args, resolution.executedResult) ?? null
  }
```

(The legacy `run()` resume path keeps calling `prompts.buildResume?.(args)` with no second arg — back-compatible.)

- [ ] **Step 2: Rewrite the reply resume prompt (failing test first if a prompt test exists)**

If `apps/inbox/agents/reply.prompts.test.ts` exists, add/adjust a test asserting the resume prompt references the server-created draft and does NOT instruct a `create_draft` call:

```ts
it('resume narrates the server-created draft and forbids tool calls', () => {
  const strat = createReplyPrompts('INSTR')
  const prompt = strat.buildResume!({ threadId: 't', body: 'hi' }, { draftId: 'd-9' })
  expect(prompt).toMatch(/already (created|saved)/i)
  expect(prompt).toMatch(/d-9/)
  expect(prompt).not.toMatch(/create_draft/)
})
```

- [ ] **Step 3: Implement the rewritten resume prompt**

In `apps/inbox/agents/reply.prompts.ts`, replace the `resume` helper + `buildResume`:

```ts
function resume(instructions: string, draftId: string): string {
  return [
    instructions,
    '',
    'The human APPROVED the reply and the SERVER has ALREADY created the Gmail draft',
    `(draft id "${draftId}"). You do NOT create or send anything — it is done.`,
    'Reply with ONE short sentence confirming the draft was saved. Do not call any tool',
    'and do not narrate tool usage.',
  ].join('\n')
}

export function createReplyPrompts(instructions: string): PromptStrategy {
  return {
    buildFirst(input: RunAgentInput): string {
      const h = decodeHandoff(input, HandoffPayloadSchema)
      return h ? handoffFirst(instructions, h) : noLeadFirst(instructions)
    },
    buildResume(_args: Record<string, unknown>, executedResult?: Record<string, unknown>): string | null {
      const draftId = typeof executedResult?.draftId === 'string' ? executedResult.draftId : 'saved'
      return resume(instructions, draftId)
    },
  }
}
```

(The model no longer needs `threadId`/`body` at resume — the effect already ran. Keep `handoffFirst`/`noLeadFirst` unchanged; the turn-1 instruction to NOT create a draft is now structurally true.)

- [ ] **Step 4: Run the affected tests + typecheck**

Run: `yarn test packages/providers apps/inbox/agents && yarn typecheck`
Expected: PASS. If the claude-cli-provider test asserted the OLD resume prompt text (create_draft), update that assertion to the new propose-don't-execute text.

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/agents/reply.prompts.ts packages/providers/src/claude-cli-provider.ts apps/inbox/agents/reply.prompts.test.ts packages/providers/src/claude-cli-provider.test.ts
git commit -m "feat(inbox): reply resume prompt = propose-don't-execute (server already drafted)"
```

---

## Task 10: Spike page — gate-id resolve + edit + reject + cancel

**Files:**
- Modify: `apps/inbox/client/src/spike/TraceSpike.tsx`

This is the throwaway dev verification surface (step 6 replaces it). Keep it minimal but enough to exercise edit/approve/reject/cancel.

- [ ] **Step 1: Fetch the open gate (id + formRev + form) instead of reading GATE_OPENED for the artifact**

In `TraceSpike.tsx`, add gate state + a fetch when status becomes `awaiting_approval`:

```ts
type OpenGate = {
  id: string
  toolName: string
  form: Record<string, unknown>
  formRev: number
  proposedArtifact: Record<string, unknown>
}
const [openGate, setOpenGate] = useState<OpenGate | null>(null)
const [editBody, setEditBody] = useState('')

useEffect(() => {
  if (!id || status !== 'awaiting_approval') return
  void (async () => {
    const res = await fetch(`/api/workitems/${id}/gate`)
    if (!res.ok) return
    const g = (await res.json()) as OpenGate
    setOpenGate(g)
    setEditBody(typeof g.form.body === 'string' ? g.form.body : '')
  })()
}, [id, status])
```

- [ ] **Step 2: Replace `approve` with edit-aware approve + add reject + cancel**

```ts
const approve = async () => {
  if (!id || !openGate) return
  await fetch(`/api/gates/${openGate.id}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      decision: 'approved',
      formRev: openGate.formRev,
      form: { ...openGate.form, body: editBody },
    }),
  })
}

const reject = async () => {
  if (!id || !openGate) return
  await fetch(`/api/gates/${openGate.id}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'rejected', formRev: openGate.formRev, comment: 'no thanks' }),
  })
}

const cancel = async () => {
  if (!id) return
  await fetch(`/api/workitems/${id}/cancel`, { method: 'POST' })
}
```

- [ ] **Step 3: Render the editable body + buttons**

Replace the `status === 'awaiting_approval' && gate` block with:

```tsx
{status === 'awaiting_approval' && openGate && (
  <div style={{ marginTop: 16, padding: 12, border: '1px solid #d97706', borderRadius: 8 }}>
    <p style={{ margin: 0 }}>
      ⏸ Awaiting approval — <strong>{openGate.toolName}</strong> (rev {openGate.formRev})
    </p>
    <textarea
      value={editBody}
      onChange={(e) => setEditBody(e.target.value)}
      rows={6}
      style={{ width: '100%', marginTop: 8, fontFamily: 'inherit' }}
    />
    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
      <button onClick={approve}>Approve (edited)</button>
      <button onClick={reject}>Reject</button>
    </div>
  </div>
)}
{(status === 'running' || status === 'awaiting_approval') && (
  <button onClick={cancel} style={{ marginTop: 12 }}>
    Stop
  </button>
)}
```

(The `readGateOpened`/`gate` memo can stay or be removed; it is no longer used for the artifact.)

- [ ] **Step 4: Typecheck + lint**

Run: `yarn typecheck && yarn lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/client/src/spike/TraceSpike.tsx
git commit -m "chore(spike): gate-id resolve with edit + reject + Stop on the dev surface"
```

---

## Task 11: Full verification + HANDOFF As-built

**Files:**
- Modify: `HANDOFF.md`

- [ ] **Step 1: Green the whole workspace**

Run: `yarn typecheck && yarn test && yarn lint && yarn format:check`
Expected: all PASS. Fix anything red before continuing.

- [ ] **Step 2: Kill stale dev stacks + free ports (CLAUDE.md gotcha)**

```bash
ps aux | grep -E "AiWorkflow/node_modules/.bin/(tsx|vite|concurrently)" | grep -v grep
pkill -9 -f "AiWorkflow/node_modules/.bin/(tsx|vite|concurrently)" || true
lsof -tiTCP:4000,:5173,:5174 | xargs kill -9 2>/dev/null || true
pkill -9 -f "ms-playwright-mcp/mcp-chrome" 2>/dev/null || true
rm -f ~/Library/Caches/ms-playwright-mcp/mcp-chrome-*/Singleton* 2>/dev/null || true
```

- [ ] **Step 3: Refresh the reply cassette's resume step (the prompt changed)**

The recorded `lead-inbox__reply` resume step is stale (old create_draft prompt). Delete the `lead-inbox__reply` cassette so a record-mode run captures both the gated run and the new propose-don't-execute resume fresh:

```bash
rm -f apps/inbox/.cassettes/lead-inbox__reply.jsonl
```

(The qualifier cassette is unaffected — its prompt did not change.)

- [ ] **Step 4: Browser E2E — every flow (memory rule), `DEV_RECORD_REPLAY` first record then replay**

Start one stack: `DEV_RECORD_REPLAY=record yarn dev` (confirm a single `server on http://localhost:4000` + one vite on `:5173`, `grep -c EADDRINUSE` the log = 0). Drive `http://localhost:5173/?spike=1`. Verify and record evidence for EACH:

1. **Edited approve → real Gmail draft.** Start reply run → gate (`awaiting_approval`) → edit the body in the textarea → **Approve (edited)** → status `done`, the resume confirmation appears. **Open Gmail and confirm the draft body is the EDITED text** (the load-bearing new guarantee — the SERVER executed the edit, not the model). Effect note: the effect runs OUTSIDE record/replay, so this hits real Gmail (draft-only — never sent). The recorded saveDraft args carry a real threadId.
2. **Reject + re-run.** New run → gate → **Reject** → item `finished` (resolution rejected), no draft created. Confirm a fresh run can be started.
3. **Stop a running item.** Start a run; before the gate, click **Stop** → status `finished` (cancelled); the trace stops.
4. **Stop at awaiting_approval.** Start → gate → **Stop** → `finished` (cancelled); the open gate is closed (a subsequent `GET /api/workitems/:id/gate` → 404).
5. **Restart durability.** Start → gate (`awaiting_approval`) → kill the server (`Ctrl-C`) → restart `DEV_RECORD_REPLAY=1 yarn dev` → reload the page → the gate SURVIVES → **Approve (edited)** still executes the effect.
6. **Stale formRev → 409.** After the gate renders, manually POST `/api/gates/:id/resolve` with `formRev: 999` (devtools or curl) → 409; the page's normal approve (correct rev) still works.

Then switch to `DEV_RECORD_REPLAY=1 yarn dev` and confirm the replay of flows 2–4 (no real claude; reject/cancel create no draft so they are free to replay).

- [ ] **Step 5: Flip HANDOFF to ✅ BUILT with an As-built note**

In `HANDOFF.md`, change the step-4 line (`75: 4. **Server-executed effects + Stop**`) to `✅ BUILT & browser-verified` and add an "As-built" sub-bullet block (follow the steps 1–3 As-built pattern) summarizing: `defineAgent.effects (⊆ approvals) + readonly`; `ServerBinding.effects` (functions in server, names in core); boot checks in `agent-checks.ts`; `createDraft` extracted to `@atizar/integrations/gmail-basic/create-draft`; `transition` cancel/reject edges; RunObserver explicit-iterator `cancel` + terminal-tolerant finish; `resolveGate` (formRev/ledger/execute/resume) + `cancel`/`cancelWorkflow`; routes `/api/gates/:id/resolve` + cancel + gate read (dev resolve removed); reply resume = propose-don't-execute; spike page edit/reject/Stop. Note the effect-outside-record/replay nuance. Update the "Starting point for the next session" to **step 5 (Mastra provider)** and remind: ask for `ANTHROPIC_API_KEY` at the start of step 5.

- [ ] **Step 6: Commit**

```bash
git add HANDOFF.md
git commit -m "docs: step-4 server-executed effects + Stop BUILT & browser-verified (As-built)"
```

---

## Self-Review (completed against the spec)

- **Spec §1 contract** → Tasks 1 (effects/readonly + `effects ⊆ approvals`), 4 (ServerBinding.effects + boot exhaustiveness + classification). ✓
- **Spec §2 createDraft extraction** → Task 3 (pure exported function, injectable getGmail, MCP wrapper + server both call it). ✓
- **Spec §3 gate resolve** (formRev 409 → ledger one-execution → execute → tx result → resume with executedResult; reject branch; `GET .../gate`) → Tasks 2 (executedResult), 7 (resolveGate + StateStore ledger), 8 (routes). ✓
- **Spec §4 transition** (cancel + reject edges, resolution, guard scope decision) → Task 5. ✓
- **Spec §5 Stop** (iterator.return → kill; per-status cancel; cascade ascending-id; workflow cancel; terminal-tolerant consume; dequeue queued) → Tasks 6 (observer/pool) + 7 (service cancel/cancelWorkflow). ✓
- **Spec §6 reply prompts** (propose-don't-execute resume reading executedResult) → Task 9. ✓
- **Spec testing/verification** (unit + race + browser every-flow incl. edited-body→Gmail, formRev 409, restart durability) → Tasks 1–9 unit/race + Task 11 browser. ✓
- **Placeholder scan:** every code step shows full code; no TBD/TODO. ✓
- **Type consistency:** `resolveGate(gateId, GateResolution & {formRev})` returns `{ok:true} | {ok:false,status,error}` (routes map `status`); `claimLedger` → `{alreadyClaimed, result}`; `AgentRuntime.effects: Record<string, EffectFn>`; `EffectFn(form, ctx)`; `buildResume(args, executedResult?)`; `createDraft({threadId,body}, {getGmail}) → {ok,draftId}|{error}`. Consistent across tasks. ✓
- **Deferred (non-goals) NOT planned:** gate capabilities, runtime default-deny, budget edge. ✓
