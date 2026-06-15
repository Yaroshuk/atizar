---
name: add-workflow
description: Scaffold a new workflow in apps/inbox/workflows/<id>/ — the per-workflow ids/contracts/tools/cards consts, definePrompt blocks, the structure-only descriptor, server bindings + effects, client render/HITL specs, the three aggregators, server tool defs, and the drift-guard test. Use when adding, writing, scaffolding, or building a new workflow (a new multi-agent automation: a sorter/qualifier + workers, an inbound flow, an approval pipeline) on top of the framework.
---

# Add a workflow

Task skill — owns the run end-to-end: from "we need a workflow that does X" to a typechecked,
linted, browser-verified workflow wired into the demo app. The single worked exemplar (STRUCTURE
**and** the clean magic-string-free pattern) is `apps/inbox/workflows/email-inbox/`. Read it
alongside this skill — every step below points at the email-inbox file that demonstrates it.

> **Why this skill exists.** A workflow is ~8 small files plus three one-line aggregator edits,
> all cross-referencing each other through const maps. The boilerplate is mechanical but easy to
> get subtly wrong (a raw tool literal that drifts; identity baked into a prompt that the provider
> already prepends; a workflow that relies on another to register its cards). This skill encodes the
> CLEAN pattern email-inbox now establishes so a fresh agent scaffolds a new workflow without
> re-deriving any of it.

## The shape of a workflow (FACTS — read before Stage 1)

A workflow lives in `apps/inbox/workflows/<id>/` and is **structure → descriptor, words →
prompts**. The files, and the law each obeys:

| File            | Holds                                                  | Law                                                  |
| --------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| `ids.ts`        | `WORKFLOW_ID`, the agent-id map, `ROLES`               | `as const`, never a TS enum (config-as-data, **I7**) |
| `contracts.ts`  | the handoff/dispatch payload zod schemas               | breaks the descriptor↔prompts import cycle           |
| `tools.ts`      | the tool-name const map (**incl. read tools**)         | `as const`; one source for descriptor + prompts      |
| `cards.ts`      | the card/component-name const map                      | `as const`                                           |
| `prompts.ts`    | one `definePrompt` block per agent                     | flat, **TURN-ONLY**; `Call ${t.x}` for every tool    |
| `descriptor.ts` | `defineAgent` + `defineWorkflow` — STRUCTURE only      | identity (`instructions`) lives HERE                 |
| `server.ts`     | per-agent `{ prompts, allowedTools, effects, health }` | effects are **server-executed** (**I9**)             |
| `client.tsx`    | `AgentMeta` + render/HITL specs (the cards)            | the workflow registers its **OWN** cards             |
| `*.test.ts`     | descriptor + prompt + **drift-guard** tests            | drift guard is **mandatory**                         |

Three more facts that the whole pattern rests on:

- **Identity is provider-prepended, prompts are turn-only.** `defineAgent.instructions` (composed
  with the workflow-level `prompt`) is the agent's identity; the provider PREPENDS it to the
  turn-only `definePrompt` output at run time. So prompts carry ONLY the words for the current
  turn — never re-bake the agent's name or the workflow rules into prose. The wire that makes this
  work is `instructions: config.instructions` in `apps/inbox/server/providers.ts` (both the
  claude-cli and Mastra factories) — invisible to replay and the browser, verify by code (Stage 9).
- **Render/HITL resolution is scoped per workflow.** Each workflow declares EVERY card it surfaces
  and stamps its specs with `scope(WORKFLOW_ID, …)` (from `@atizar/react`). A workflow can NOT rely
  on another to register a shared card (the gotcha Unit 1 surfaced); two workflows may register the
  same tool name against different components and both resolve.
- **Effects are server-executed.** The model only PROPOSES (an approval/`capture` tool); on
  approval the SERVER runs the effect from the tool-call args (`server.ts` `effects`). The model
  never sees a mutating tool — read tools go in `readonly`, surfaces/proposals/dispatches in
  `tools`.

## Stage 1 — Preflight (probe, don't ask)

Read the whole exemplar — `apps/inbox/workflows/email-inbox/` (every file in the table above) —
and the three aggregators (`apps/inbox/workflows/index.ts`,
`apps/inbox/server/workflows.ts`, `apps/inbox/client/src/workflows.ts`). Read the `@atizar/core`
signatures you'll call: `definePrompt` (`packages/core/src/definePrompt.ts`), `defineAgent`
(`packages/core/src/defineAgent.ts`), `defineWorkflow` (`packages/core/src/defineWorkflow.ts`).
Read the workflows section of `docs/CONVENTIONS.md` ("Workflows: wire strings & prompts").

Probe for FACTS yourself. If the new workflow reuses an existing integration's read tools (Gmail),
its MCP read wrapper and the integration functions already exist — reuse them; don't duplicate auth
code. Ask the user only about INTENT.

## Stage 2 — Intent [GATE]

Confirm with the user, in ONE message:

- the workflow **id** + **label** + **icon**, and the **agent roster**: which agent is the
  `input` (the human-started entry that reads the source and dispatches), which are `worker`s;
- each agent's **tool surface**: read tools (→ `readonly`), surface/render tools, the
  proposal/approval tools (→ `approvals` + `effects`), and any **dispatch** tool;
- the **handoff graph** (who dispatches to whom) and `maxInstances` (1 = singleton input);
- the **effects** each approval triggers (the server function) and the **integration/credential**
  each needs;
- the **rerun**/`resetOnStart` policy.

Do NOT ask things the code already answers (the file layout, the const-vs-enum rule, where identity
lives — those are settled here). Wait for confirmation before writing files.

## Stage 3 — Scaffold the const + contract layer

Mirror email-inbox, one file at a time. These have no runtime behavior, so write them all, then
typecheck.

1. **`ids.ts`** — `export const <WF>_ID = '<id>' as const`, the agent-id map
   `<WF>_AGENTS = { … } as const` + its `type` via
   `(typeof <WF>_AGENTS)[keyof typeof <WF>_AGENTS]`, and `ROLES = { input, worker } as const`.
   `as const` makes each value identical to the wire string (**I7**) — never a TS enum.
   Exemplar: `email-inbox/ids.ts`.
2. **`contracts.ts`** — the zod schemas for every handoff/dispatch payload (e.g. `EmailRefSchema`,
   `EmailBatchSchema`, `ReplyPayloadSchema`). **They live here, not in the descriptor**, so
   `prompts.ts` can decode a payload without importing the descriptor — importing it would close a
   descriptor↔prompts cycle. Required fields are the ones a prompt/card actually consumes (a thin
   dispatch missing one should surface as an MCP validation error, not a silent decode→null).
   Exemplar: `email-inbox/contracts.ts`.
3. **`tools.ts`** — `export const <WF>_TOOLS = { … } as const` + its `type`. Include the **read
   tools** (e.g. `list_unread`, `get_email`) so the descriptor's `readonly` arrays and the prompts
   route every tool name through one source — no raw literals anywhere. Exemplar:
   `email-inbox/tools.ts`.
4. **`cards.ts`** — `export const <WF>_CARDS = { … } as const` + its `type`. Component names.
   Exemplar: `email-inbox/cards.ts`.

## Stage 4 — `prompts.ts` (the words, turn-only)

One `definePrompt({ input?, onInput?, onStart, onResume? })` block per agent (`@atizar/core`).
Rules (the drift guard enforces the first one):

- **Every tool a prompt mentions is written `Call ${t.x}`** — interpolate the const from
  `tools.ts` (imported as `t`), never a hand-typed tool name. This is what lets the drift test
  prove no raw literal slipped in.
- **TURN-ONLY.** No identity prose — no agent name, no workflow rules, no `compose()`. Identity
  comes from the descriptor via the provider prepend. (The `prompts.test.ts` `expectTurnOnly`
  helper asserts the old identity fragments are ABSENT.)
- `onStart` is required (the no-handoff / entry turn); `onInput(payload)` runs when a matching
  handoff payload decodes; `onResume(result)` narrates the SERVER's executed-effect result and
  forbids further tool calls (omit it for an agent that never proposes a gated effect → the sorter
  has no `onResume`).
- **Reuse via a factory, never copy-paste.** email-inbox's reader/spam/important share ONE
  `batchPrompt(defaultAction)` factory returning a `definePrompt` — the only difference is the
  proposed default action. Lift any shared shape the same way.

Exemplar: `email-inbox/prompts.ts` (`sorterPrompt`, `replyPrompt`, the `batchPrompt` factory →
`readerPrompt`/`spamPrompt`/`importantPrompt`).

## Stage 5 — `descriptor.ts` (structure only)

`defineAgent` per agent + one `defineWorkflow`. Everything keyed through the const maps (`t`/`c`/
`a`/`ROLES`/`<WF>_ID`) — no raw `'reply'`/`'input'`/`'list_unread'` literals.

- **`defineAgent`** fields: `id`/`name`, `provider: PROVIDERS.claudeCli` (from
  `@atizar/providers/ids`), **`instructions`** (the agent's IDENTITY — it lives HERE, in prose),
  `tools` (surface/render/propose/dispatch — NOT read tools), `readonly` (read tools ONLY),
  `approvals` ⊆ `tools`, `effects` ⊆ `approvals`, `dispatches` ⊆ `tools`, `renders`
  (`{ [t.x]: c.Card }`), `handoffs` (agent ids), `maxInstances` (default 2; 1 = singleton).
  `defineAgent` validates these subset relations (structure only).
- **`defineWorkflow`** fields: `id: <WF>_ID`, `label`, `iconName`, `prompt` (the workflow-level
  shared rules/tone — composed with each agent's `instructions`), `agents`
  (`{ agent, role: ROLES.input|worker }`), `entryAgentId` (must be a role:input agent),
  `inputs` (cross-workflow contract — `[]` for a human-started beta workflow), `connections`
  (`[{ integration, provider }]`), and the policy knobs `rerun` (`'refresh'` default) and the new
  **`resetOnStart`** (default off; `true` resets terminal items on a human START so the board
  starts clean). Re-export the contract schemas here for descriptor consumers
  (`export { EmailRefSchema, … } from './contracts.js'`). Also export an
  `<wf>Agents` array (used by the aggregator).

Exemplar: `email-inbox/descriptor.ts` (note the `batchAgent(id, name)` factory mirroring the
batch prompt factory).

## Stage 6 — `server.ts` (bind prompts, effects, allow-list)

Export `<wf>Server: () => ServerBinding[]` (signature `(origin) => ServerBinding[]` — omit the
param if no agent needs an origin-tagged render handoff, as email-inbox does). Each binding:

- `agentId` (from the descriptor agent), `prompts` (the matching `definePrompt` strategy),
- **`allowedTools`** — the FULLY-QUALIFIED MCP names (`mcp__<server>__<tool>`); this is the
  single-entry-point tool boundary,
- **`effects`** — `{ <approvalTool>: async (form) => … }`: the SERVER-executed effect (**I9**).
  It resolves the live credential, branches on demo mode (`isDemo()` → a believable fake result),
  and calls the pure integration function (`createDraft`, `applyEmailActions`). The approved/edited
  `form` IS the integration args, verbatim. Never throw — return `{ error }` on a missing
  credential.
- `health` — `[{ name, check: () => Promise<HealthCheck> }]` resolving the credential and calling
  the integration's `checkCredentials`.

Exemplar: `email-inbox/server.ts` (and `apps/inbox/workflows/email-inbox/apply-actions.ts` for a
batch effect that reads the form rows).

## Stage 7 — `client.tsx` (the workflow's OWN cards)

Export three things:

- `<wf>Meta: Record<string, AgentMeta>` — per-agent chrome (`subtitle`, `iconName`, `intro`).
- `<wf>Renders: Omit<RenderSpec, 'workflowId'>[]` — one spec per surface tool
  (`{ toolName: t.x, parameters: z.object(...), render: ({ parameters }) => <Card … /> }`).
- `<wf>Hitl: Omit<HitlSpec, 'workflowId'>[]` — one per approval tool
  (`{ toolName: t.x, parameters, render: ({ form, source, approve, reject }) => <Dialog … /> }`);
  `approve(editedForm)` is the human's edited args that become the effect input.

**The workflow registers its OWN cards** — declare EVERY tool it surfaces (incl. a generic-but-
reused contract like renderLead/saveDraft). Render/HITL resolution is per-workflow (the gotcha Unit
1 surfaced: a workflow can't rely on another registering a shared card). Card components live under
`apps/inbox/client/src/components/<Card>/`; create new ones there.

Exemplar: `email-inbox/client.tsx`.

## Stage 8 — Wire the three aggregators (one line each)

A workflow is registered in exactly three files — add ONE entry to each:

1. `apps/inbox/workflows/index.ts` — import the descriptor, add it to `workflowDescriptors`.
2. `apps/inbox/server/workflows.ts` — add `{ descriptor, bindings: <wf>Server }` to
   `workflowServers`.
3. `apps/inbox/client/src/workflows.ts` — merge `<wf>Meta` into `META`, and add
   `...scope<RenderSpec>(<WF>_ID, <wf>Renders)` / `...scope<HitlSpec>(<WF>_ID, <wf>Hitl)` to the
   spec arrays. **`scope` comes from `@atizar/react`** and stamps each spec with the workflow id
   (then dedups WITHIN the workflow). Import `<WF>_ID` from the workflow's `ids.ts`, never the
   literal.

## Stage 9 — Server tool defs + the `instructions` provider wire

The agents reference tool names; the server needs the concrete tool definitions and the MCP that
exposes them:

- **Mastra tool defs** — `apps/inbox/server/mastra/tools.ts`: a `captureTool(name, schema)` (from
  `@atizar/server`) for every surface/propose/dispatch tool (a no-op the model CALLS; the server
  acts on the observed call), and a `createTool` for each READ tool delegating to the integration
  function. Add the new tools to the `ALL_TOOLS` map.
- **The stdio MCP** — read tools live in a thin stdio-MCP wrapper. For Gmail this is
  `apps/inbox/mcp/gmail-tools.mts` (a `.mts` run via `node --import tsx` because it imports the
  `.ts` `@atizar/server` for `resolveCredential`); the surface/propose tools (pure echoes) live in
  `apps/inbox/mcp/inbox-tools.mjs`. Mirror that pattern for a new service's read tools.
- **The critical wire (verify by CODE):** `apps/inbox/server/providers.ts` passes
  **`instructions: config.instructions`** to BOTH the claude-cli and Mastra factories. This is what
  prepends the composed identity to the turn-only prompts. Without it the turn-only prompts lose all
  identity — and this is INVISIBLE to replay and the browser, so confirm the line is present rather
  than trusting a passing run.

## Stage 10 — Tests (drift guard is mandatory)

Author the tests email-inbox has, adapted:

- **`prompts.test.ts`** — `onStart`/`onInput`/`onResume` route the right tool consts, carry the
  payload, and are turn-only (`expectTurnOnly` asserts identity fragments are ABSENT).
- **`prompts.drift.test.ts`** (MANDATORY) — scan all prompt prose for tool-shaped tokens and assert
  every one is a value in `<WF>_TOOLS`; assert every `handoffs` target on every agent is a value in
  `<WF>_AGENTS`; assert `descriptor.id === <WF>_ID`. This catches a renamed const leaving a
  hand-typed copy behind. (Extend the `TOOL_TOKEN` regex if your tool names use a verb prefix the
  email-inbox regex — `render|save|apply` + snake_case — doesn't cover.)
- **`descriptor.test.ts`** + the shared `descriptors.parse.test.ts` (in `apps/inbox/workflows/`) —
  add cases asserting the new descriptor parses and references its consts.

## Stage 11 — Green gate + foundation check

`yarn typecheck && yarn test && yarn lint && yarn format:check` — all GREEN. Then run the
**`check-foundation`** procedure: a new workflow touches actions/providers/the framework boundary,
so verify it doesn't violate or erode a belief or invariant (read/effect split I2/I9, config-as-data
I7, no engine import into `@atizar/core`). A conflict is a STOP — warn the developer and get direct
confirmation before proceeding.

## Stage 12 — Browser-verify (mandatory)

Unit tests provably miss this repo's bug class. Invoke the **`browser-verify`** procedure and drive
the new workflow in a real browser: START the input agent, watch a dispatch spawn a worker, open a
worker, see its card render, and **run the HITL approval** end-to-end (approve → server effect →
finished). One flow is not "done" — verify EVERY flow, especially every approval. Only call it
verified after you watched it work.

## Gotchas (the lessons this skill encodes)

- **(a) A workflow registers its OWN render cards.** Render/HITL specs are scoped per workflow via
  `scope(WORKFLOW_ID, …)`; a workflow can NOT rely on another to register a shared card (Unit 1).
  Declare every tool it surfaces in its own `client.tsx`.
- **(b) The descriptor↔prompts cycle is broken via `contracts.ts`.** Payload zod schemas live in
  `contracts.ts`, NOT the descriptor, so `prompts.ts` decodes them without importing the descriptor.
  Re-export them from the descriptor for descriptor-as-entry-point consumers.
- **(c) Prompts are turn-only — identity is provider-prepended.** Never bake the agent name or
  workflow rules into prompt prose. The app's claude-cli (and Mastra) factory MUST forward
  `instructions: config.instructions` (`apps/inbox/server/providers.ts`) or identity is lost —
  invisible to replay/browser, verify by code.
- **(d) Consts, not enums (I7).** Every wire string goes through an `as const` map; `as const`
  keeps the value identical to the wire string. A TS enum would break config-as-data.
- **(e) The thin stdio-MCP scaffold.** A new service's READ tools go in a thin stdio `McpServer`
  (`apps/inbox/mcp/gmail-tools.mts` is the worked example — a `.mts` under `node --import tsx`
  because it imports the `.ts` `@atizar/server`); pure surface/propose echoes live in
  `apps/inbox/mcp/inbox-tools.mjs`. Mutations are NEVER model-visible MCP tools — they are
  server-executed effects behind gates.

## Stage 13 — Self-improvement (last; silent skip is the default)

After commits land: did the user correct the same thing twice? Did a stage not match the work? If
nothing systemic surfaced, write one sentence ("Run went smoothly, nothing systemic surfaced.") and
exit. Otherwise propose 1–2 systemic changes to THIS skill (or a Procedure/Rule this run used), each
quoting the motivating run incident verbatim. Do not record code-specific gotchas here — those go in
`rules/` or the workflows section of `docs/CONVENTIONS.md`.
