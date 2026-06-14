# WS6 — Type-safe Agent/Workflow Declaration Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Kill magic strings in agent/workflow declarations by exporting a typed `PROVIDERS` const + `ProviderId` union from `@atizar/providers`, introducing per-workflow `as const` tool-name maps and client-side card-name maps, and (optionally) making `defineAgent` generic over the declared tool-name union — while keeping `@atizar/core` provider-agnostic.

**Architecture:** `@atizar/providers` gains a new `provider-ids.ts` module exporting a `PROVIDERS` object literal (`as const`) mapping `claudeCli → 'claude-cli'`, `mastra → 'mastra'`, `mock → 'mock'`, plus a `ProviderId` union derived from its values; the barrel re-exports it. Userland descriptors reference `PROVIDERS.*` and per-workflow `t.*` tool-name consts; client modules reference per-workflow `CARDS.*` card-name consts. `@atizar/core`'s `defineAgent` keeps `provider: z.string()` (I3/I5 — core never imports `@atizar/providers`); the existence check stays at `registry.resolve`. The runtime value is always the wire string (I7 config-as-data) — a typed const + union, never a TS `enum`.

**Tech Stack:** TypeScript 6 (composite project references, `tsc --build`), zod v3, Vitest 4 (colocated `*.test.ts`), yarn-classic 1.22 workspace. `@atizar/providers` exports `./src/index.ts` directly (no Vite lib-build step — only `@atizar/react` builds), so the green gate for this WS is `yarn typecheck && yarn test && yarn lint && yarn format:check` plus the root `yarn build` (which bundles the demo app and transitively compiles the changed source).

---

## File Structure

**Create:**
- `packages/providers/src/provider-ids.ts` — the `PROVIDERS` const + `ProviderId` union (the library-owned provider registry of identifiers).
- `packages/providers/src/provider-ids.test.ts` — unit test: `PROVIDERS` values equal the wire strings; `ProviderId` round-trips.
- `apps/inbox/workflows/lead-inbox/tools.ts` — per-workflow `as const` tool-name map for lead-inbox.
- `apps/inbox/workflows/email-inbox/tools.ts` — per-workflow `as const` tool-name map for email-inbox.
- `apps/inbox/workflows/github-triage/tools.ts` — per-workflow `as const` tool-name map for github-triage.
- `apps/inbox/workflows/lead-inbox/cards.ts` — per-workflow `as const` card-name map for lead-inbox.
- `apps/inbox/workflows/email-inbox/cards.ts` — per-workflow `as const` card-name map for email-inbox.
- `apps/inbox/workflows/github-triage/cards.ts` — per-workflow `as const` card-name map for github-triage.
- `apps/inbox/workflows/descriptors.parse.test.ts` — unit test: all descriptors still parse via `defineAgent`/`defineWorkflow` after the const refactor; provider values resolve to wire strings.

**Modify:**
- `packages/providers/src/index.ts` (line 6, append) — re-export `provider-ids.js` from the barrel.
- `apps/inbox/server/providers.ts` (lines 50-63) — key the registry map with `PROVIDERS.*` instead of raw string literals (mirrors the same identifiers; runtime behavior unchanged).
- `apps/inbox/workflows/lead-inbox/descriptor.ts` (lines 1-13) — `provider: PROVIDERS.claudeCli`; tools/approvals/effects/renders via `t.*` and `CARDS.*`.
- `apps/inbox/workflows/email-inbox/descriptor.ts` (lines 1-78) — same treatment for all five agents + the `batchAgent` factory.
- `apps/inbox/workflows/github-triage/descriptor.ts` (lines 1-42) — same treatment for all four agents.
- `apps/inbox/workflows/lead-inbox/client.tsx` (lines 21-89) — `RenderSpec`/`HitlSpec` `toolName` via `t.*`.
- `apps/inbox/workflows/email-inbox/client.tsx` (lines 38-85) — `toolName` via `t.*`.
- `apps/inbox/workflows/github-triage/client.tsx` (lines 97-127) — `toolName` via `t.*`.
- `packages/core/src/defineAgent.ts` (lines 6-69) — **OPTIONAL TASK 6 ONLY**: make `defineAgent` generic over the tool-name union.
- `packages/core/src/defineAgent.test.ts` (append) — **OPTIONAL TASK 6 ONLY**: a `@ts-expect-error` type-level test.

---

### Task 1: `PROVIDERS` const + `ProviderId` union in `@atizar/providers`

**Files:**
- Create `packages/providers/src/provider-ids.ts`
- Create `packages/providers/src/provider-ids.test.ts`
- Modify `packages/providers/src/index.ts` (line 6, append one export line)

- [ ] Step 1: Write the failing test. Create `packages/providers/src/provider-ids.test.ts` with this exact content:

```ts
import { describe, it, expect } from 'vitest'
import { PROVIDERS, type ProviderId } from './provider-ids.js'

describe('PROVIDERS', () => {
  it('maps each key to its wire string (config-as-data: value IS the wire string)', () => {
    expect(PROVIDERS.claudeCli).toBe('claude-cli')
    expect(PROVIDERS.mastra).toBe('mastra')
    expect(PROVIDERS.mock).toBe('mock')
  })

  it('exposes exactly the three known providers', () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual(['claudeCli', 'mastra', 'mock'])
  })

  it('every value is assignable to ProviderId (round-trip)', () => {
    const ids: ProviderId[] = Object.values(PROVIDERS)
    expect(ids).toEqual(['claude-cli', 'mastra', 'mock'])
  })
})
```

- [ ] Step 2: Run the test — expect FAIL (module does not exist yet).

```
yarn test provider-ids
```

Expected: vitest reports `Failed to resolve import "./provider-ids.js"` / `Cannot find module './provider-ids.js'` — the file is missing.

- [ ] Step 3: Minimal implementation. Create `packages/providers/src/provider-ids.ts` with this exact content:

```ts
// The library owns the list of provider identifiers. Userland descriptors write
// `provider: PROVIDERS.claudeCli` instead of inventing the string at the call site —
// autocomplete + a compile-time typo guard, with the list owned here.
//
// This is a typed string-literal const + union, NOT a TS `enum` (I7 config-as-data,
// see the spec §0 + the locked "status is a string-literal union, not an enum"
// decision): the RUNTIME value stays the wire string (`'claude-cli'`); only the TYPE
// narrows. The keys mirror the registry keys in apps/inbox/server/providers.ts.
export const PROVIDERS = {
  claudeCli: 'claude-cli',
  mastra: 'mastra',
  mock: 'mock',
} as const

// The union of valid wire strings, derived from the const so adding a provider in one
// place updates both. `defineAgent` deliberately does NOT consume this type
// (@atizar/core stays provider-agnostic — I3/I5); it exists for userland + the server
// registry to reference.
export type ProviderId = (typeof PROVIDERS)[keyof typeof PROVIDERS]
```

- [ ] Step 4: Re-export from the barrel. In `packages/providers/src/index.ts`, after the existing line 6 (`export * from './mastra-provider.js'`), append:

```ts
export * from './provider-ids.js'
```

- [ ] Step 5: Run the test — expect PASS.

```
yarn test provider-ids
```

Expected: `✓ packages/providers/src/provider-ids.test.ts (3 tests)` all passing.

- [ ] Step 6: Run typecheck to confirm the composite project still builds (the providers package is referenced by the root tsconfig).

```
yarn typecheck
```

Expected: exits 0, no errors.

- [ ] Step 7: Commit.

```
git add packages/providers/src/provider-ids.ts packages/providers/src/provider-ids.test.ts packages/providers/src/index.ts
git commit -m "$(cat <<'EOF'
feat(providers): export PROVIDERS const + ProviderId union (WS6)

Library-owned typed provider identifiers (typed const + union, NOT a TS
enum — I7 config-as-data: the value stays the wire string). Userland
descriptors will reference PROVIDERS.* instead of raw 'claude-cli'.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Key the server provider registry with `PROVIDERS.*`

**Files:**
- Modify `apps/inbox/server/providers.ts` (lines 1-10 imports; lines 50-63 the `defineProviders` map keys)

The registry currently keys the map with the raw string literals `mock`, `'claude-cli'`, `mastra`. Replace those keys with `PROVIDERS.*` so the registry and the descriptors draw from one source. The resolved wire strings are byte-identical, so runtime behavior is unchanged.

- [ ] Step 1: Write the failing test. Create `apps/inbox/workflows/descriptors.parse.test.ts` with this exact content (this test also covers Tasks 3-5; it asserts the descriptors parse and the resolved provider value is the wire string):

```ts
import { describe, it, expect } from 'vitest'
import { PROVIDERS } from '@atizar/providers'
import { qualifierAgent, replyAgent as leadReply } from './lead-inbox/descriptor'
import {
  sorterAgent,
  replyAgent as emailReply,
  readerAgent,
  spamAgent,
  importantAgent,
} from './email-inbox/descriptor'
import {
  triageAgent,
  featureAgent,
  bugfixAgent,
  replyDraftAgent,
} from './github-triage/descriptor'

const ALL = [
  qualifierAgent,
  leadReply,
  sorterAgent,
  emailReply,
  readerAgent,
  spamAgent,
  importantAgent,
  triageAgent,
  featureAgent,
  bugfixAgent,
  replyDraftAgent,
]

describe('descriptors parse via defineAgent after the const refactor', () => {
  it('every agent resolves provider to the claude-cli wire string', () => {
    for (const a of ALL) {
      expect(a.provider).toBe(PROVIDERS.claudeCli)
      expect(a.provider).toBe('claude-cli')
    }
  })

  it('lead-inbox reply still declares saveDraft as tool + approval + effect', () => {
    expect(leadReply.tools).toContain('saveDraft')
    expect(leadReply.approvals).toContain('saveDraft')
    expect(leadReply.effects).toContain('saveDraft')
    expect(leadReply.renders.saveDraft).toBe('ApprovalDialog')
    expect(leadReply.renders.renderLead).toBe('LeadCard')
  })

  it('email-inbox sorter still declares route_emails as tool + dispatch', () => {
    expect(sorterAgent.tools).toContain('route_emails')
    expect(sorterAgent.dispatches).toContain('route_emails')
    expect(sorterAgent.renders.renderSort).toBe('SortSummaryCard')
  })

  it('github-triage triage still renders render_triage as TriageCard', () => {
    expect(triageAgent.tools).toContain('render_triage')
    expect(triageAgent.renders.render_triage).toBe('TriageCard')
  })
})
```

- [ ] Step 2: Run the test — expect PASS (this test already passes against the current code; it is the regression guard that Tasks 2-5 must keep green). Confirm the baseline:

```
yarn test descriptors.parse
```

Expected: `✓ apps/inbox/workflows/descriptors.parse.test.ts (4 tests)` passing.

- [ ] Step 3: Edit `apps/inbox/server/providers.ts` imports. Change line 9 from:

```ts
import { databaseUrl } from '@atizar/server'
```

to:

```ts
import { databaseUrl } from '@atizar/server'
import { PROVIDERS } from '@atizar/providers'
```

(Note: `@atizar/providers` is already imported on lines 2-6 for the `create*Provider` functions; add the named `PROVIDERS` import to that existing block instead if preferred. Either is acceptable — see Step 4 for the consolidated form.)

- [ ] Step 4: Replace the existing providers import block (lines 2-6) to also pull in `PROVIDERS`, and remove the separate import added in Step 3. The import block at the top of the file should read exactly:

```ts
import { defineProviders, type ProviderRegistry, type ProviderFactory } from '@atizar/core'
import {
  createMockInboxProvider,
  createClaudeCliProvider,
  createMastraProvider,
  PROVIDERS,
} from '@atizar/providers'
import { claudeSpawn } from './claude-spawn.js'
import { makeMastraRunner } from './mastra/runner.js'
import { databaseUrl } from '@atizar/server'
```

- [ ] Step 5: Key the registry map with `PROVIDERS.*`. Replace the `defineProviders` call (currently lines 50-63) with:

```ts
export const providerRegistry: ProviderRegistry = defineProviders({
  [PROVIDERS.mock]: (config) => createMockInboxProvider(config.approvalNames),
  [PROVIDERS.claudeCli]: usingMastra
    ? mastraFactory
    : (config) =>
        createClaudeCliProvider({
          approvalNames: config.approvalNames,
          surfaceTools: config.surfaceTools,
          allowedTools: config.allowedTools,
          prompts: config.prompts,
          spawn: claudeSpawn,
        }),
  [PROVIDERS.mastra]: mastraFactory,
})
```

- [ ] Step 6: Run the descriptor parse test + typecheck — expect PASS / 0 errors.

```
yarn test descriptors.parse && yarn typecheck
```

Expected: the parse test still passes (4 tests); typecheck exits 0. (`defineProviders` takes `Record<string, ProviderFactory>`, and computed keys from `PROVIDERS` resolve to the literal strings, so the map is identical at runtime.)

- [ ] Step 7: Commit.

```
git add apps/inbox/server/providers.ts apps/inbox/workflows/descriptors.parse.test.ts
git commit -m "$(cat <<'EOF'
refactor(server): key provider registry with PROVIDERS const (WS6)

The registry map keys now come from PROVIDERS.* (one source of truth with
the descriptors). Resolved wire strings are byte-identical — runtime
behavior unchanged. Adds the descriptors-parse regression test.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: lead-inbox — `PROVIDERS.*` + tool/card consts

**Files:**
- Create `apps/inbox/workflows/lead-inbox/tools.ts`
- Create `apps/inbox/workflows/lead-inbox/cards.ts`
- Modify `apps/inbox/workflows/lead-inbox/descriptor.ts` (lines 1-13 the `replyAgent` + `qualifierAgent` declarations)
- Modify `apps/inbox/workflows/lead-inbox/client.tsx` (lines 21-89 the `toolName` fields)

- [ ] Step 1: Write the failing test. Append to `apps/inbox/workflows/descriptors.parse.test.ts` (after the existing `describe` blocks) a new block that pins the lead-inbox consts. First add the import at the top of the test file (after the existing descriptor imports):

```ts
import { LEAD_INBOX_TOOLS } from './lead-inbox/tools'
import { LEAD_INBOX_CARDS } from './lead-inbox/cards'
```

Then append this `describe`:

```ts
describe('lead-inbox tool/card consts', () => {
  it('tool consts equal the wire tool names', () => {
    expect(LEAD_INBOX_TOOLS.renderLead).toBe('renderLead')
    expect(LEAD_INBOX_TOOLS.saveDraft).toBe('saveDraft')
    expect(LEAD_INBOX_TOOLS.renderVerdict).toBe('renderVerdict')
  })
  it('card consts equal the wire card names', () => {
    expect(LEAD_INBOX_CARDS.LeadCard).toBe('LeadCard')
    expect(LEAD_INBOX_CARDS.VerdictCard).toBe('VerdictCard')
    expect(LEAD_INBOX_CARDS.ApprovalDialog).toBe('ApprovalDialog')
  })
  it('descriptor references the consts (renders map keyed by the tool const)', () => {
    expect(leadReply.renders[LEAD_INBOX_TOOLS.renderLead]).toBe(LEAD_INBOX_CARDS.LeadCard)
    expect(leadReply.renders[LEAD_INBOX_TOOLS.saveDraft]).toBe(LEAD_INBOX_CARDS.ApprovalDialog)
  })
})
```

- [ ] Step 2: Run the test — expect FAIL (the `tools.ts`/`cards.ts` modules do not exist).

```
yarn test descriptors.parse
```

Expected: `Cannot find module './lead-inbox/tools'` (or `./lead-inbox/cards`).

- [ ] Step 3: Create `apps/inbox/workflows/lead-inbox/tools.ts` with this exact content:

```ts
// Per-workflow tool-name const map (as const → value IS the wire string, only the type
// narrows; not a TS enum — same rationale as PROVIDERS). Descriptors + render/HITL specs
// reference these instead of raw string literals: typo-safe + autocomplete, with the
// names owned in one place per workflow (the framework can't enumerate userland tools).
export const LEAD_INBOX_TOOLS = {
  renderLead: 'renderLead',
  saveDraft: 'saveDraft',
  renderVerdict: 'renderVerdict',
} as const

export type LeadInboxToolName = (typeof LEAD_INBOX_TOOLS)[keyof typeof LEAD_INBOX_TOOLS]
```

- [ ] Step 4: Create `apps/inbox/workflows/lead-inbox/cards.ts` with this exact content:

```ts
// Per-workflow card-name const map (client side). The `renders` map values in the
// descriptor are component NAMES (core stays React-free); the client renderRegistry maps
// name → component. These consts keep the descriptor's render values + the client specs
// referencing one source instead of duplicated string literals.
export const LEAD_INBOX_CARDS = {
  LeadCard: 'LeadCard',
  VerdictCard: 'VerdictCard',
  ApprovalDialog: 'ApprovalDialog',
} as const

export type LeadInboxCardName = (typeof LEAD_INBOX_CARDS)[keyof typeof LEAD_INBOX_CARDS]
```

- [ ] Step 5: Rewrite `apps/inbox/workflows/lead-inbox/descriptor.ts` to reference the consts. Replace lines 1-27 (the imports + `replyAgent` + `qualifierAgent`) with:

```ts
import { defineAgent, defineWorkflow, HandoffPayloadSchema } from '@atizar/core'
import { PROVIDERS } from '@atizar/providers'
import { LEAD_INBOX_TOOLS as t } from './tools'
import { LEAD_INBOX_CARDS as c } from './cards'

export const replyAgent = defineAgent({
  id: 'reply',
  name: 'REPLY AGENT',
  provider: PROVIDERS.claudeCli,
  instructions:
    'Read the latest email in the inbox, draft a reply, and ask the human before saving it as a draft.',
  tools: [t.renderLead, t.saveDraft],
  approvals: [t.saveDraft],
  effects: [t.saveDraft],
  renders: { [t.renderLead]: c.LeadCard, [t.saveDraft]: c.ApprovalDialog },
})

export const qualifierAgent = defineAgent({
  id: 'qualifier',
  name: 'LEAD QUALIFIER',
  provider: PROVIDERS.claudeCli,
  instructions:
    'Read the latest email in the inbox and qualify the lead: category, priority, and a one-line reason.',
  tools: [t.renderVerdict],
  approvals: [],
  readonly: ['get_latest_email'],
  renders: { [t.renderVerdict]: c.VerdictCard },
  handoffs: ['reply'],
  maxInstances: 1,
})
```

(Lines 29-44 — `leadInbox` workflow + `leadInboxAgents` export — are unchanged.)

- [ ] Step 6: Update `apps/inbox/workflows/lead-inbox/client.tsx` to reference the tool consts. Add this import after line 6 (`import { qualifierAgent, replyAgent } from './descriptor'`):

```tsx
import { LEAD_INBOX_TOOLS as t } from './tools'
```

Then change the three `toolName:` string literals: line 23 `toolName: 'renderLead',` → `toolName: t.renderLead,`; line 32 `toolName: 'renderVerdict',` → `toolName: t.renderVerdict,`; line 75 `toolName: 'saveDraft',` → `toolName: t.saveDraft,`.

- [ ] Step 7: Run the parse test + typecheck — expect PASS / 0 errors.

```
yarn test descriptors.parse && yarn typecheck
```

Expected: the new lead-inbox const block passes; typecheck exits 0.

- [ ] Step 8: Commit.

```
git add apps/inbox/workflows/lead-inbox/tools.ts apps/inbox/workflows/lead-inbox/cards.ts apps/inbox/workflows/lead-inbox/descriptor.ts apps/inbox/workflows/lead-inbox/client.tsx apps/inbox/workflows/descriptors.parse.test.ts
git commit -m "$(cat <<'EOF'
refactor(lead-inbox): use PROVIDERS + tool/card consts (WS6)

Descriptor and client specs reference LEAD_INBOX_TOOLS / LEAD_INBOX_CARDS
(as const) and PROVIDERS.claudeCli instead of raw string literals.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: email-inbox — `PROVIDERS.*` + tool/card consts

**Files:**
- Create `apps/inbox/workflows/email-inbox/tools.ts`
- Create `apps/inbox/workflows/email-inbox/cards.ts`
- Modify `apps/inbox/workflows/email-inbox/descriptor.ts` (lines 1-78: imports + `sorterAgent` + `replyAgent` + `batchAgent`)
- Modify `apps/inbox/workflows/email-inbox/client.tsx` (lines 38-85: `toolName` fields)

The email-inbox `replyAgent` reuses the tool names `renderLead`/`saveDraft` (same names as lead-inbox, deliberately). Each workflow declares its OWN const map (per-workflow scoping, matching WS2); the duplicated names live in two const files, which is correct — the names are genuinely the same tool contract reused across workflows.

- [ ] Step 1: Write the failing test. Add these imports to the top of `apps/inbox/workflows/descriptors.parse.test.ts` (after the lead-inbox const imports from Task 3):

```ts
import { EMAIL_INBOX_TOOLS } from './email-inbox/tools'
import { EMAIL_INBOX_CARDS } from './email-inbox/cards'
```

Then append this `describe` block:

```ts
describe('email-inbox tool/card consts', () => {
  it('tool consts equal the wire tool names', () => {
    expect(EMAIL_INBOX_TOOLS.route_emails).toBe('route_emails')
    expect(EMAIL_INBOX_TOOLS.renderSort).toBe('renderSort')
    expect(EMAIL_INBOX_TOOLS.renderLead).toBe('renderLead')
    expect(EMAIL_INBOX_TOOLS.saveDraft).toBe('saveDraft')
    expect(EMAIL_INBOX_TOOLS.applyActions).toBe('applyActions')
  })
  it('card consts equal the wire card names', () => {
    expect(EMAIL_INBOX_CARDS.SortSummaryCard).toBe('SortSummaryCard')
    expect(EMAIL_INBOX_CARDS.LeadCard).toBe('LeadCard')
    expect(EMAIL_INBOX_CARDS.ApprovalDialog).toBe('ApprovalDialog')
    expect(EMAIL_INBOX_CARDS.EmailBatchCard).toBe('EmailBatchCard')
  })
  it('descriptor references the consts', () => {
    expect(sorterAgent.renders[EMAIL_INBOX_TOOLS.renderSort]).toBe(EMAIL_INBOX_CARDS.SortSummaryCard)
    expect(readerAgent.renders[EMAIL_INBOX_TOOLS.applyActions]).toBe(EMAIL_INBOX_CARDS.EmailBatchCard)
  })
})
```

- [ ] Step 2: Run the test — expect FAIL (`Cannot find module './email-inbox/tools'`).

```
yarn test descriptors.parse
```

Expected: module-not-found for `./email-inbox/tools`.

- [ ] Step 3: Create `apps/inbox/workflows/email-inbox/tools.ts` with this exact content:

```ts
// Per-workflow tool-name const map for email-inbox. renderLead/saveDraft repeat the
// lead-inbox names on purpose (the same reply contract reused across workflows); each
// workflow owns its own const map (per-workflow scoping). `as const` → value IS the wire
// string; not a TS enum.
export const EMAIL_INBOX_TOOLS = {
  route_emails: 'route_emails',
  renderSort: 'renderSort',
  renderLead: 'renderLead',
  saveDraft: 'saveDraft',
  applyActions: 'applyActions',
} as const

export type EmailInboxToolName = (typeof EMAIL_INBOX_TOOLS)[keyof typeof EMAIL_INBOX_TOOLS]
```

- [ ] Step 4: Create `apps/inbox/workflows/email-inbox/cards.ts` with this exact content:

```ts
// Per-workflow card-name const map for email-inbox.
export const EMAIL_INBOX_CARDS = {
  SortSummaryCard: 'SortSummaryCard',
  LeadCard: 'LeadCard',
  ApprovalDialog: 'ApprovalDialog',
  EmailBatchCard: 'EmailBatchCard',
} as const

export type EmailInboxCardName = (typeof EMAIL_INBOX_CARDS)[keyof typeof EMAIL_INBOX_CARDS]
```

- [ ] Step 5: Rewrite `apps/inbox/workflows/email-inbox/descriptor.ts` lines 1-78. Replace line 2 import and the agent declarations. Change the imports (lines 1-2) to:

```ts
import { z } from 'zod'
import { defineAgent, defineWorkflow } from '@atizar/core'
import { PROVIDERS } from '@atizar/providers'
import { EMAIL_INBOX_TOOLS as t } from './tools'
import { EMAIL_INBOX_CARDS as c } from './cards'
```

Then replace the `sorterAgent` declaration (currently lines 28-44) with:

```ts
export const sorterAgent = defineAgent({
  id: 'sorter',
  name: 'EMAIL SORTER',
  provider: PROVIDERS.claudeCli,
  instructions:
    'Read the unread inbox emails of the last 24 hours and sort each one. For an email that needs a personal reply, dispatch it to the reply agent. Group the rest into: informational (reader), suspected spam (spam), and important-but-no-reply (important). Then surface a short summary.',
  // CONVENTION (matches lead-inbox qualifier): read tools go in `readonly` ONLY, never in `tools`.
  // `tools` holds the surface/render/propose/approval/dispatch tools. The Mastra factory derives
  // render-vs-read from membership in `tools`, so a read tool in `tools` would be misclassified.
  tools: [t.route_emails, t.renderSort],
  approvals: [],
  readonly: ['list_unread'],
  dispatches: [t.route_emails],
  renders: { [t.renderSort]: c.SortSummaryCard },
  handoffs: ['reply', 'reader', 'spam', 'important'],
  maxInstances: 1,
})
```

Then replace the `replyAgent` declaration (currently lines 46-57) with:

```ts
export const replyAgent = defineAgent({
  id: 'reply',
  name: 'REPLY AGENT',
  provider: PROVIDERS.claudeCli,
  instructions:
    'You were handed one email that needs a reply. Read its full body, draft a short reply, and ask the human before saving it as a Gmail draft.',
  tools: [t.renderLead, t.saveDraft],
  readonly: ['get_email'],
  approvals: [t.saveDraft],
  effects: [t.saveDraft],
  renders: { [t.renderLead]: c.LeadCard, [t.saveDraft]: c.ApprovalDialog },
})
```

Then replace the `batchAgent` factory (currently lines 61-74) with:

```ts
function batchAgent(id: string, name: string): ReturnType<typeof defineAgent> {
  return defineAgent({
    id,
    name,
    provider: PROVIDERS.claudeCli,
    instructions:
      'You were handed a batch of emails. Propose a per-row action for each (read / trash / star / keep) and ask the human to apply them. The human may change any row before approving.',
    tools: [t.applyActions],
    approvals: [t.applyActions],
    effects: [t.applyActions],
    renders: { [t.applyActions]: c.EmailBatchCard },
    handoffs: ['reply'], // a row can be re-routed to a reply
  })
}
```

(Lines 76-98 — the `readerAgent`/`spamAgent`/`importantAgent` calls, the `emailInbox` workflow, and `emailInboxAgents` — are unchanged.)

- [ ] Step 6: Update `apps/inbox/workflows/email-inbox/client.tsx`. Add this import after line 5 (`import { sorterAgent, ... } from './descriptor'`):

```tsx
import { EMAIL_INBOX_TOOLS as t } from './tools'
```

Then change line 40 `toolName: 'renderSort',` → `toolName: t.renderSort,`; and line 71 `toolName: 'applyActions',` → `toolName: t.applyActions,`.

- [ ] Step 7: Run the parse test + typecheck — expect PASS / 0 errors.

```
yarn test descriptors.parse && yarn typecheck
```

Expected: the email-inbox const block passes; typecheck exits 0.

- [ ] Step 8: Commit.

```
git add apps/inbox/workflows/email-inbox/tools.ts apps/inbox/workflows/email-inbox/cards.ts apps/inbox/workflows/email-inbox/descriptor.ts apps/inbox/workflows/email-inbox/client.tsx apps/inbox/workflows/descriptors.parse.test.ts
git commit -m "$(cat <<'EOF'
refactor(email-inbox): use PROVIDERS + tool/card consts (WS6)

EMAIL_INBOX_TOOLS / EMAIL_INBOX_CARDS (as const) replace raw literals in
the descriptor + client specs; provider via PROVIDERS.claudeCli.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: github-triage — `PROVIDERS.*` + tool/card consts

**Files:**
- Create `apps/inbox/workflows/github-triage/tools.ts`
- Create `apps/inbox/workflows/github-triage/cards.ts`
- Modify `apps/inbox/workflows/github-triage/descriptor.ts` (lines 1-42: imports + four agent declarations)
- Modify `apps/inbox/workflows/github-triage/client.tsx` (lines 97-127: `toolName` fields)

Note: the triage agent declares `list_my_tickets`/`get_ticket` in `readonly` (read tools, not surfaced) and `render_triage` in `tools`. The const map below includes all tool names referenced in the descriptor, including the readonly ones, so every literal in the descriptor flows through a const.

- [ ] Step 1: Write the failing test. Add these imports to the top of `apps/inbox/workflows/descriptors.parse.test.ts` (after the email-inbox const imports from Task 4):

```ts
import { GITHUB_TRIAGE_TOOLS } from './github-triage/tools'
import { GITHUB_TRIAGE_CARDS } from './github-triage/cards'
```

Then append this `describe` block:

```ts
describe('github-triage tool/card consts', () => {
  it('tool consts equal the wire tool names', () => {
    expect(GITHUB_TRIAGE_TOOLS.list_my_tickets).toBe('list_my_tickets')
    expect(GITHUB_TRIAGE_TOOLS.get_ticket).toBe('get_ticket')
    expect(GITHUB_TRIAGE_TOOLS.render_triage).toBe('render_triage')
    expect(GITHUB_TRIAGE_TOOLS.render_ticket_result).toBe('render_ticket_result')
    expect(GITHUB_TRIAGE_TOOLS.render_reply_draft).toBe('render_reply_draft')
  })
  it('card consts equal the wire card names', () => {
    expect(GITHUB_TRIAGE_CARDS.TriageCard).toBe('TriageCard')
    expect(GITHUB_TRIAGE_CARDS.TicketResultCard).toBe('TicketResultCard')
    expect(GITHUB_TRIAGE_CARDS.ReplyDraftCard).toBe('ReplyDraftCard')
  })
  it('descriptor references the consts', () => {
    expect(triageAgent.renders[GITHUB_TRIAGE_TOOLS.render_triage]).toBe(
      GITHUB_TRIAGE_CARDS.TriageCard
    )
    expect(featureAgent.renders[GITHUB_TRIAGE_TOOLS.render_ticket_result]).toBe(
      GITHUB_TRIAGE_CARDS.TicketResultCard
    )
  })
})
```

- [ ] Step 2: Run the test — expect FAIL (`Cannot find module './github-triage/tools'`).

```
yarn test descriptors.parse
```

Expected: module-not-found for `./github-triage/tools`.

- [ ] Step 3: Create `apps/inbox/workflows/github-triage/tools.ts` with this exact content:

```ts
// Per-workflow tool-name const map for github-triage. Includes the readonly read tools
// (list_my_tickets / get_ticket) so every literal in the descriptor flows through a const.
// `as const` → value IS the wire string; not a TS enum.
export const GITHUB_TRIAGE_TOOLS = {
  list_my_tickets: 'list_my_tickets',
  get_ticket: 'get_ticket',
  render_triage: 'render_triage',
  render_ticket_result: 'render_ticket_result',
  render_reply_draft: 'render_reply_draft',
} as const

export type GithubTriageToolName = (typeof GITHUB_TRIAGE_TOOLS)[keyof typeof GITHUB_TRIAGE_TOOLS]
```

- [ ] Step 4: Create `apps/inbox/workflows/github-triage/cards.ts` with this exact content:

```ts
// Per-workflow card-name const map for github-triage.
export const GITHUB_TRIAGE_CARDS = {
  TriageCard: 'TriageCard',
  TicketResultCard: 'TicketResultCard',
  ReplyDraftCard: 'ReplyDraftCard',
} as const

export type GithubTriageCardName = (typeof GITHUB_TRIAGE_CARDS)[keyof typeof GITHUB_TRIAGE_CARDS]
```

- [ ] Step 5: Rewrite `apps/inbox/workflows/github-triage/descriptor.ts` lines 1-42. Replace the import (line 1) and the four agent declarations. Change line 1 to:

```ts
import { defineAgent, defineWorkflow } from '@atizar/core'
import { PROVIDERS } from '@atizar/providers'
import { GITHUB_TRIAGE_TOOLS as t } from './tools'
import { GITHUB_TRIAGE_CARDS as c } from './cards'
```

Then replace the four agent declarations (currently lines 3-42) with:

```ts
export const triageAgent = defineAgent({
  id: 'triage',
  name: 'TRIAGE',
  provider: PROVIDERS.claudeCli,
  instructions:
    "Read the user's open tickets on the project board and recommend how to route each.",
  tools: [t.list_my_tickets, t.get_ticket, t.render_triage],
  approvals: [],
  readonly: [t.list_my_tickets, t.get_ticket],
  renders: { [t.render_triage]: c.TriageCard },
  handoffs: ['feature', 'bugfix', 'reply-draft'],
  maxInstances: 1,
})
export const featureAgent = defineAgent({
  id: 'feature',
  name: 'FEATURE AGENT',
  provider: PROVIDERS.claudeCli,
  instructions: 'Analyze a feature-request ticket routed to you and produce a short plan.',
  tools: [t.render_ticket_result],
  approvals: [],
  renders: { [t.render_ticket_result]: c.TicketResultCard },
})
export const bugfixAgent = defineAgent({
  id: 'bugfix',
  name: 'BUG-FIX AGENT',
  provider: PROVIDERS.claudeCli,
  instructions: 'Investigate a bug ticket routed to you and produce a short analysis.',
  tools: [t.render_ticket_result],
  approvals: [],
  renders: { [t.render_ticket_result]: c.TicketResultCard },
})
export const replyDraftAgent = defineAgent({
  id: 'reply-draft',
  name: 'REPLY DRAFT',
  provider: PROVIDERS.claudeCli,
  instructions: 'Draft a suggested reply to the last comment on a routed ticket. Never post.',
  tools: [t.render_reply_draft],
  approvals: [],
  renders: { [t.render_reply_draft]: c.ReplyDraftCard },
})
```

(Lines 44-58 — the `githubTriage` workflow + `githubTriageAgents` export — are unchanged.)

- [ ] Step 6: Update `apps/inbox/workflows/github-triage/client.tsx`. Add this import after line 9 (`import { triageAgent, ... } from './descriptor'`):

```tsx
import { GITHUB_TRIAGE_TOOLS as t } from './tools'
```

Then change line 99 `toolName: 'render_triage',` → `toolName: t.render_triage,`; line 110 `toolName: 'render_ticket_result',` → `toolName: t.render_ticket_result,`; line 119 `toolName: 'render_reply_draft',` → `toolName: t.render_reply_draft,`.

- [ ] Step 7: Run the FULL test suite + typecheck + lint + format check — expect PASS / 0 errors. (All three workflows are now converted; run the whole gate to confirm no descriptor regressed.)

```
yarn typecheck && yarn test && yarn lint && yarn format:check
```

Expected: typecheck exits 0; vitest reports all tests passing (the prior baseline plus the new `provider-ids` + `descriptors.parse` tests — 450+ total); lint exits 0; format check reports no formatting diffs.

- [ ] Step 8: Commit.

```
git add apps/inbox/workflows/github-triage/tools.ts apps/inbox/workflows/github-triage/cards.ts apps/inbox/workflows/github-triage/descriptor.ts apps/inbox/workflows/github-triage/client.tsx apps/inbox/workflows/descriptors.parse.test.ts
git commit -m "$(cat <<'EOF'
refactor(github-triage): use PROVIDERS + tool/card consts (WS6)

GITHUB_TRIAGE_TOOLS / GITHUB_TRIAGE_CARDS (as const) replace raw literals
in the descriptor + client specs; provider via PROVIDERS.claudeCli. No raw
provider string literal remains in any descriptor.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6 (OPTIONAL — skip if it balloons): make `defineAgent` generic over the tool-name union

**Decision gate before starting:** This is the spec's clearly-marked optional stronger task (§2 WS6 point 4). It makes `approvals`/`renders`/`effects`/`dispatches` compile-checked subsets of the declared `tools`. zod + generics can fight each other (zod's `.parse` widens to `string[]`/`Record<string,string>` at runtime, so the generic must live on the function signature, NOT the zod schema). **If, after Step 1-3 below, the implementing agent finds the generic forces casts that erode the runtime `superRefine` or breaks any existing caller in `yarn typecheck`, STOP, revert this task's changes, and ship Tasks 1-5 — those fully satisfy the WS acceptance.** Do NOT change `AgentDefinitionSchema` (the zod schema stays `provider: z.string()`, `tools: z.array(z.string())`, etc. — the runtime contract is unchanged; the generic is a compile-time-only narrowing wrapper).

**Files:**
- Modify `packages/core/src/defineAgent.ts` (the `defineAgent` function, lines 67-69 — wrap with a generic; the schema lines 6-65 are UNCHANGED)
- Modify `packages/core/src/defineAgent.test.ts` (append a `@ts-expect-error` type-level test)

- [ ] Step 1: Write the failing type-level test. Append to `packages/core/src/defineAgent.test.ts` this block (it asserts a known-good descriptor still compiles AND that an approval not in tools is a compile error via `@ts-expect-error`):

```ts
describe('defineAgent generic tool-name narrowing (compile-time)', () => {
  it('accepts approvals/renders/effects/dispatches that are subsets of tools', () => {
    const def = defineAgent({
      id: 'reply',
      name: 'REPLY',
      provider: 'claude-cli',
      instructions: 'x',
      tools: ['renderLead', 'saveDraft'],
      approvals: ['saveDraft'],
      effects: ['saveDraft'],
      renders: { renderLead: 'LeadCard', saveDraft: 'ApprovalDialog' },
    })
    expect(def.approvals).toEqual(['saveDraft'])
  })

  it('rejects an approval not in tools at COMPILE time', () => {
    defineAgent({
      id: 'reply',
      name: 'REPLY',
      provider: 'claude-cli',
      instructions: 'x',
      tools: ['saveDraft'],
      // @ts-expect-error 'sendNow' is not a declared tool name
      approvals: ['sendNow'],
      renders: {},
    })
  })
})
```

- [ ] Step 2: Run typecheck — expect FAIL. Before the generic exists, `approvals` is `string[]`, so `['sendNow']` is allowed and the `@ts-expect-error` directive becomes UNUSED → TS error `TS2578: Unused '@ts-expect-error' directive`.

```
yarn typecheck
```

Expected: `error TS2578: Unused '@ts-expect-error' directive.` at the `approvals: ['sendNow']` line in `defineAgent.test.ts`.

- [ ] Step 3: Implement the generic wrapper. In `packages/core/src/defineAgent.ts`, leave the schema (lines 6-65) and the two type exports (lines 64-65) UNCHANGED. Replace the `defineAgent` function (lines 67-69) with:

```ts
// A compile-time-only generic input: `tools` declares the tool-name union T, and the
// subset fields (approvals/effects/dispatches/renders keys) are narrowed to T at the call
// site. The RUNTIME contract is unchanged — the body still parses via AgentDefinitionSchema
// (provider: z.string(), tools: z.array(z.string())), so config-as-data (I7) and the runtime
// superRefine still hold; the generic only tightens what the TypeScript compiler accepts.
export interface TypedAgentInput<T extends string> {
  id: string
  name: string
  provider: string
  instructions: string
  tools: readonly T[]
  approvals: readonly T[]
  renders: Partial<Record<T, string>>
  handoffs?: readonly string[]
  maxInstances?: number
  effects?: readonly T[]
  readonly?: readonly string[]
  dispatches?: readonly T[]
}

export function defineAgent<const T extends string>(def: TypedAgentInput<T>): AgentDefinition {
  // The schema parse still runs (runtime validation + defaults + superRefine). The generic
  // is erased here — `def` widens to the schema's input shape, which it structurally satisfies.
  return AgentDefinitionSchema.parse(def as AgentDefinitionInput)
}
```

- [ ] Step 4: Run typecheck — expect PASS. The `@ts-expect-error` is now USED (`'sendNow'` is not in the `tools` union `'saveDraft'`), so the directive is satisfied; the known-good descriptors in Tasks 3-5 still compile because their subset fields reference the same `t.*` consts that populate `tools`.

```
yarn typecheck
```

Expected: exits 0, no errors. (If instead you see errors in the workflow descriptors — e.g. a `readonly`/`handoffs` field rejected — that means the generic over-constrained a field the spec did NOT ask to narrow; `readonly` and `handoffs` are deliberately `readonly string[]`/`readonly T[]` per above. Re-check the `TypedAgentInput` shape matches Step 3 exactly. If it still fights, invoke the decision gate: revert this task.)

- [ ] Step 5: Run the existing defineAgent unit tests — expect PASS. The runtime behavior is unchanged (same schema, same `superRefine`), so all the existing `defineAgent` tests (valid passport, rejects approval not in tools at RUNTIME, effects/dispatches/maxInstances) still pass.

```
yarn test defineAgent
```

Expected: `✓ packages/core/src/defineAgent.test.ts` — all tests passing (the prior tests plus the two new compile-time-narrowing tests).

- [ ] Step 6: Run the full gate — expect PASS.

```
yarn typecheck && yarn test && yarn lint && yarn format:check
```

Expected: all green. (The `descriptors.parse.test.ts` from Tasks 2-5 and every workflow descriptor still compile under the generic, because each subset field references the same `t.*` const family as `tools`.)

- [ ] Step 7: Commit.

```
git add packages/core/src/defineAgent.ts packages/core/src/defineAgent.test.ts
git commit -m "$(cat <<'EOF'
feat(core): defineAgent generic over the tool-name union (WS6 optional)

approvals/renders/effects/dispatches are now compile-checked subsets of
the declared tools (TypedAgentInput<T>). The zod schema + runtime
superRefine are UNCHANGED — provider stays z.string() (I3/I5), the value
stays the wire string (I7); the generic only narrows what TS accepts.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Done when

(WS6 Acceptance, copied from the spec §2:)

> No raw `'claude-cli'`/provider string literal in any descriptor (all `PROVIDERS.*`); tool/card names referenced through consts (no duplicated literal name); green gate. (Browser-verify not strictly required — it's a type/refactor change — but run the app once to confirm boot.)

Concretely, all of the following hold:

- [ ] `grep -rn "provider: '" apps/inbox/workflows/*/descriptor.ts` returns **only** `connections: [{ integration: 'gmail', provider: 'google' }]` lines (the integration-connection provider field, out of scope) — **no** `provider: 'claude-cli'` literal remains in any agent declaration.
- [ ] Every agent descriptor uses `provider: PROVIDERS.claudeCli`; the server registry (`apps/inbox/server/providers.ts`) keys its map with `PROVIDERS.*`.
- [ ] Each workflow has a `tools.ts` (`*_TOOLS as const`) and a `cards.ts` (`*_CARDS as const`); descriptors reference `t.*`/`c.*` and client specs reference `t.*` for `toolName` — no duplicated raw tool/card string literal in the descriptor or its client module.
- [ ] `@atizar/core` was **not** made to import `@atizar/providers`; `AgentDefinitionSchema.provider` stays `z.string()` (verify `grep -n "z.string()" packages/core/src/defineAgent.ts` still matches the provider field).
- [ ] `provider-ids.test.ts` passes (PROVIDERS values === wire strings); `descriptors.parse.test.ts` passes (all descriptors parse; provider resolves to the wire string).
- [ ] **(If Task 6 done)** the `@ts-expect-error` compile-time test in `defineAgent.test.ts` is satisfied (an approval not in `tools` fails to typecheck); if Task 6 was skipped per its decision gate, note that in the final summary.
- [ ] **Green gate from the repo root:** `yarn typecheck` (0 errors) → `yarn test` (vitest, 450+ tests, all green) → `yarn lint` (0 errors) → `yarn format:check` (no diffs) → `yarn build` (the demo app builds; this is the build of the only buildable changed surface — `@atizar/providers` has no separate lib-build, it exports `./src/index.ts`, and `tsc --build` already compiled it).

## Browser-verify

The spec marks browser-verify **not strictly required** for WS6 (it is a type/refactor change with byte-identical runtime wire strings), but the project hard rule + the spec both ask to **run the app once to confirm boot**. Use the `browser-verify` skill for dev-server hygiene first.

- [ ] Invoke the `browser-verify` skill, then start the stack: `yarn dev` (server :4000 + client :5173).
- [ ] Confirm the server boots with no provider-resolution error in the console (the registry keys changed; a typo in `PROVIDERS` would surface as `Unknown provider: ...` at wiring — it must NOT appear).
- [ ] Open `http://localhost:5173`, confirm the board loads and all three workflows (Lead inbox, Email inbox, GitHub triage) appear in the workflow picker.
- [ ] Start ONE workflow (e.g. Lead inbox) and confirm it runs through to at least one card render — this proves the `provider: PROVIDERS.claudeCli` value still resolves to the `claude-cli` factory and the tool/card const renames did not break the render registry (cards resolve by `toolName`, which is unchanged at runtime).
- [ ] Stop the dev stack cleanly per the `browser-verify` skill's dev-server notes.
