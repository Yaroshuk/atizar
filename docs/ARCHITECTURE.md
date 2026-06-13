# AiWorkflow — Architecture

The timeless architecture: what the framework **is** and how its pieces fit. This describes the
design, not its build status.

- **Why** the design is shaped this way → [`PHILOSOPHY.md`](PHILOSOPHY.md).
- **Current build status + what's next** → [`HANDOFF.md`](../HANDOFF.md) (living).
- **What was built, chronologically** → [`docs/BUILD-LOG.md`](BUILD-LOG.md).
- **The pipeline build spec** (server-authoritative runtime, beta scope/order) →
  [`docs/pipeline-updated-3.md`](pipeline-updated-3.md). A clean, self-contained pipeline reference
  replaces it once the beta lands.
- **The agentic-first track** (docs / skills / hooks / delivery) → [`docs/AGENTIC.md`](AGENTIC.md).

## 0. Invariants (LOCKED — do not change silently)

The load-bearing decisions that define what this framework **is**. They derive from
[`PHILOSOPHY.md`](PHILOSOPHY.md) (the three beliefs) and the locked pipeline decisions. This list
is the **canonical, protected statement**; the build spec (`pipeline-updated-3.md`) carries the
implementation detail and may change as steps land, but it must not contradict an invariant here.

**Changing any invariant below is dangerous and delicate** — it changes the framework's identity.
It requires an **explicit warning to the developer that it is dangerous, and their direct
confirmation**. Never edit silently. (Backstops: the `guard-foundation-edits` hook; the
`check-foundation` skill stage run by any task.)

_Philosophy-derived:_

- **I1 — Human-in-the-loop by design.** The human starts, steers, and approves; approval gates are
  a first-class entity in the agent contract; no fully autonomous mode; no irreversible meaningful
  action without confirmation; everything is audited.
- **I2 — Machine dispatch allowed, a machine action never.** A machine may create a visible,
  gated work item; it may never fire a consequential action. The **server** executes the approved
  action — the model only proposes.
- **I3 — Thin layer, not an engine.** One minimal contract `AgentRuntime: run(input) →
  AsyncIterable<AGUIEvent>` (+ optional `resume` + `GATE_OPENED`). AG-UI is the only outward
  language. The core knows no concrete engine (no engine import in `@atizar/core`). We do not
  duplicate engine features (memory / RAG / tool-execution live in the provider layer).
- **I4 — Swappability proven, not declared.** ≥2 unlike providers out of the box (Mastra +
  claude-cli); the provider conformance suite is the proof the contract didn't leak.
- **I5 — Framework / userland boundary is physical.** Userland imports only the public SDK
  (`@atizar/core`: `defineAgent` / `defineTool` / `defineProvider`), never internals. No
  fork-and-hack; the core is a versioned dependency.
- **I6 — Skills / knowledge ride inside packages,** versioned with the code they describe
  (discovery from `node_modules`), never in a DB.
- **I7 — Config-as-data.** One Zod object behind an adapter (file → DB → master). The consumer view
  edits only declared leaf fields (prompt / name / description), never code.

_Architecture-locked (pipeline):_

- **I8 — Server-authoritative state in Postgres.** One `transition()` owns every status change
  (guards + the finished-entry guard, in one place); one `dispatch()` chokepoint mints work items.
- **I9 — Server-executed effects.** The model proposes and opens gates; the SERVER executes the
  approved action through the action ledger (key = `workItemId+gateId`), exactly once.
- **I10 — Stop / cancel per agent instance AND per workflow.**
- **I11 — Provider tiers.** Mastra = the production path; claude-cli = dev-only (no terminal-spawn
  in production).
- **I12 — Work item vs instance.** The durable, visible work item is the unit; the ephemeral
  instance only executes. A result is kept until the human closes it.
- **I13 — Approval expiry = a stale badge, never an auto-resolve.**
- **I14 — Thread = Trace render + per-WorkItem SSE tail;** AG-UI is the event vocabulary.
- **I15 — Boot-time tool classification.** Every allow-listed tool is declared
  `readonly | approvals | renders | effects | dispatches`; an unclassified tool → the framework
  refuses to boot. Effects are bound server-side (names in core, functions in the `ServerBinding`);
  `effects ⊆ approvals`. A `dispatches` tool is machine dispatch: the model calls it to produce a
  child **work item** (validated against the agent's `handoffs`), never an action — consistent with
  I2.

## 1. The two views (the spine)

Everything is driven by **config-as-data**: one validated config object (Zod). There are two views
onto the same config + code:

- **Developer view** — edits code + config directly. Full power.
- **Consumer view** — operates the UI (cards, buttons) and may edit a few declared **leaf text
  fields** (prompt / name / description) stored as per-account overrides. Never sees or touches
  code.

A visual / chat config **builder** (a third "edit the pipeline by mouse/chat" mode) was considered
and **dropped**: it is the riskiest, most expensive part (a mini-Claude-Code), and the
config-schema ceiling it implies is the classic low-code trap. What survives is the modest slice
above — field-level overrides in the consumer view, not arbitrary UI authoring.

## 2. Config-as-data behind a source adapter

The runtime receives ONE validated config object; it does not know the source.

- **Structure** (which agents, screens, components) → in **files** (git, engineer). Rarely changes.
- **Manager-editable text** (prompts, tone, messages) → in the **DB** as per-account overrides.
- **Secrets** (API keys) → **env only**, referenced by name; never in git, never plaintext DB.

`editableBy` on a field decides file-vs-DB — storage is a consequence of who edits. The final
config is `base (files) ⊕ per-account overrides (DB)`; overrides are limited to declared leaf text
fields so the merge stays trivial. This backs consumer-view editing — not arbitrary UI authoring.

## 3. The `defineAgent` contract

A single object describes an agent; the UI, the pauses, and the rendering all *derive* from it.
It lives in `@atizar/core` (Zod-validated):

```ts
defineAgent({
  id: 'reply',
  name: 'Reply',
  role: 'worker',                  // 'input' = user-startable + cross-workflow target; 'worker' = handoff-only
  provider: 'claude-cli',          // a name in the provider registry (§4)
  instructions,                    // base prompt
  readonly: ['get_latest_email'],  // pure data tools, no side effects
  tools: ['get_latest_email', 'saveDraft'],
  approvals: ['saveDraft'],        // tools that open a gate (pause for the human)
  effects: ['saveDraft'],          // approved actions the SERVER executes (effects ⊆ approvals)
  renders: { saveDraft: 'ApprovalDialog' }, // tool name → component name
})
```

- **`renders` is keyed by tool name**; the values are component *names*. A client-side registry
  maps names → React components, keeping the shared contract free of React imports.
- **`defineAgent` validates STRUCTURE only** — `approvals ⊆ tools`, `effects ⊆ approvals`,
  `renders` keys ⊆ `tools`. "Provider exists" is enforced at wiring time by the registry, not in
  the contract. Every tool must be classified `readonly | approvals | renders | effects`, or the
  framework refuses to boot (I15).
- **Effect functions live server-side** in the workflow's `ServerBinding` (names here, functions
  there) — the model never sees an effect tool; on approval the server runs it (I9).
- `fields` (configurable fields + `editableBy` + auto-form + the storage split) is **not yet
  built** — it rejoins the contract with the form/DB.

## 4. Provider registry & the `AgentRuntime` contract

Models are not hardcoded in the agent. A separate registry defines providers; agents reference one
by name. The `Provider` interface lives in `@atizar/core`; concrete providers live in
`@atizar/providers`; the runtime registry that wires them lives **server-side** (the real
providers need Node, and `core` is client-imported — so `spawn` is injected to keep the provider
package Node-free).

The interface is `run(input) → AsyncIterable<AGUIEvent>`, plus optional `resume(handle,
resolution)` and a `GATE_OPENED` signal at an approval point. Every provider translates its own
output into AG-UI (I3). The tiers (I11):

- **`claude-cli`** — dev-only. Spawns the real `claude` binary (stream-json, tools via a stdio MCP
  server), maps the stream to AG-UI events, and pauses HITL by **detecting the approval tool call
  and killing the process**; resume is a stateless re-prime.
- **Mastra** — the production path. Emits AG-UI natively; a gate is a workflow suspend; resume is
  native.
- **`mock`** — a scripted AG-UI stream for tests.

A provider conformance suite (`runProviderConformance`) is the definition-of-done that proves the
contract didn't leak across two unlike providers (I4).

## 5. Generative UI & the consumer surface

**Rendering:** the agent emits tool calls that map to React components via the `renders` registry.
Two polarities, with a deliberate default:

- **Named components** (LeadCard, ApprovalDialog, …) for the polished, branded, predictable cases
  — this is the default, and the constraint is a feature (you do not want a model inventing
  arbitrary UI for a client).
- A **primitives kit** (Card, Field, Badge, Button, List) as an escape hatch the agent can compose
  for the long tail — flexible, but still in your style.

**Consumer UX:** a desktop of **agent cards** (name, START, a status indicator). Click opens a
**thread**: the agent streams text + rich result cards and pauses at approvals. The closed card and
the open thread are two renderings of the same run. **Human-in-the-loop** is the core product
moment — the agent pauses at an approval, the human edits/approves, the server executes, audited.

**Packaging:** `@atizar/react` ships the chrome (board, switcher, pipeline tree, thread,
GateForm, Stop, TraceLog, ConnectionStatus) + the card construction kit (CardShell, primitives,
`registerCard`, `useThreadResult`); the hooks are the headless layer; **workflow-specific cards
stay in userland** (demo-app exemplars). Styling is plain CSS over `--atz-*` design tokens
(`tokens.css` + `styles.css`; no Tailwind, no CSS-in-JS), with consumer branding driven by
`editableBy` config-as-data.

## 6. Skills & knowledge

Skills ride **inside packages**, versioned with the code they describe (I6) — discovered from
`node_modules` by convention, never from a DB. They also guide the AI when a developer asks it to
extend the framework (it reads them instead of guessing). `CLAUDE.md` is a thin pointer, not a
duplicate of the knowledge. The full track — layers, authoring conventions, delivery — lives in
[`docs/AGENTIC.md`](AGENTIC.md); skill-authoring rules in
[`.claude/skills/CONVENTIONS.md`](../.claude/skills/CONVENTIONS.md).

## 7. Stack

| Layer | Choice | Role | Swappable? |
|---|---|---|---|
| Agent runtime ("brain") | Mastra (prod) / claude-cli (dev) | agents, tools, memory, orchestration | yes, behind the `AgentRuntime` contract |
| Server ("door") | Hono | serves the UI, auth, OAuth callback, API | yes (fetch / Web-Standards) |
| State | Postgres (Drizzle) | server-authoritative work-item/gate/trace state | behind a StateStore |
| Consumer UI ("face") | React (Vite SPA) + AG-UI vocabulary | streaming, generative UI, human-in-the-loop | — |
| Config | Zod | config-as-data; front and back read it | — |
| Glue | MCP (agent ↔ tools), AG-UI (agent ↔ UI) | — | — |

Principle: **rent and swap the "smart" parts** (the model, the agent loop, the UI plumbing — they
ride the rising tide, behind facades); **invest engineering in what the tide won't carry**: real
integrations, trust / self-host / audit, and last-mile UX.

## 8. Packaging strategy

**One batteries package per axis** (one `@atizar/integrations`, one `@atizar/providers`) with
**subpath entrypoints + optional peer dependencies**, rather than a package per integration or
provider. Promote an integration or provider to its own package only when its **dependencies
diverge** (weight or conflict) or its **release cadence diverges** — not for tidiness. The contract
package (`@atizar/core`) is what enables third-party extension. `@atizar/*` is a placeholder
scope; the framework is named **atizar**, so the locked rename target is **`@atizar/*`** — flip the
code (package names + imports) and the docs together in one pass before any npm publish.
