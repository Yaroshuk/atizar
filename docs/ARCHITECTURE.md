# AiWorkflow — Architecture & Vision

> **Status legend:** ✅ BUILT (exists in the repo) · 🎯 DESIGN INTENT (agreed in
> discussion, not yet built) · 💤 DEFERRED (intentionally not now).
> Most of this document is 🎯 — only the vertical slice under `apps/inbox/` is ✅.
> This captures decisions made in conversation so they aren't lost between sessions.

## 1. What this is & positioning

An **open-source framework for AI engineers who ship agentic automations to
clients**: code for the engineer, a polished UI for the client.

The differentiator no one else hits cleanly: **two modes in one open-source product**
- **Developer mode** — the integrator configures agents, pipelines, integrations, skills (code).
- **Consumer mode** — the client's manager/staff use a clean UI (cards, buttons), get work
  done, but never see or touch code.

This fills the gap between "library of building blocks" (CopilotKit) and "closed SaaS"
(Lindy). n8n shows a technical node editor to everyone; Dify gives one builder UI;
CopilotKit is blocks not a product; Lindy is closed and codeless.

**Primary audience = the AI integrator**, a growing profession. We build the tool for
that profession; integrators find their own tools → solves distribution.

**Business model (like Next.js):** the framework is free; money comes from the service
layer — configuring pipelines, verticals, integrations, trust/self-host. The durable
asset in ~2 years is **not the code** (models will rewrite it) but clients, data, baked-in
integrations, trust, and relationships. The framework is a credibility/distribution
funnel, not the moat — so do not over-invest in framework elegance early.

**North star:** from `git clone` to a dashboard ready to show a client — **in an hour.**

**Default vertical:** inbound flows (email/lead/message → qualify → human approval →
action). Narrow in form, broad in reach (every company has it). Not a cage — the default
example and skill focus, while the framework stays extensible.

## 2. The three modes (the architectural spine)

Everything is driven by **config-as-data** (a Zod object). The three modes are three
ways of touching the same config (plus code for the deepest):

```
            ONE source of truth: config (Zod) + code in folders
                                 ▲
   MODE 3: Consumer        MODE 2: Visual + chat        MODE 1: Developer
   read-only, just works   edits CONFIG visually/chat   edits CONFIG and CODE
   (manager)               (in-between, power user)     (engineer)
```

- **Mode 1 (Developer):** edits code + config directly. Full power. ✅ (this is how we work now)
- **Mode 3 (Consumer):** read-only, just operates the UI (cards, buttons). 🎯 (the slice is a first cut of this surface)
- **Mode 2 (Visual + chat):** edits via forms + chat, no code editor. Its power == the
  surface of the config schema ("the more you put in config, the more mode 2 can do
  without code"). 💤 **Far future** — explicitly deferred; the riskiest/most expensive part
  (it embeds a mini-Claude-Code). Do NOT build until clients ask.

## 3. Config-as-data behind a source adapter 🎯

The runtime receives ONE validated config object; it doesn't know the source:

```
config source adapter:
  ├── FileAdapter  → config from repo/code   → MODE 1 (engineer, git, typesafe)   ✅ first
  ├── DbAdapter    → config from Postgres     → MODE 2 (visual/chat edits → DB)    💤
  └── (all read)   → active config            → MODE 3 (consumer just renders)
```

**Storage split (decided):**
- **Structure** (which agents, screens, components) → in **files** (git, engineer). Rarely changes.
- **Manager-editable text** (prompts, tone, messages) → in **DB** (overrides).
- **Secrets** (API keys) → **env only**, referenced by name; never in git, never plaintext DB.

`editableBy` on a field is what decides file-vs-DB — storage is a *consequence* of who edits.

**base⊕overrides layering** 💤 — final config = base (FileAdapter, git, engineer)
⊕ overrides (DbAdapter, visual, client). Keep overrides limited to leaf text fields so the
merge stays trivial. **Deferred** — it's a solution to a problem we don't have until mode 2 exists.

## 4. The `defineAgent` contract ✅ (core built; `fields` deferred)

A single object describes an agent; the UI, pauses, and rendering all *derive* from it.
Built in `@platform/core` (`packages/core/src/defineAgent.ts`, Zod-validated) + the concrete
instance in `apps/inbox/agents/inbox.agent.ts`:

```ts
defineAgent({
  id, name,
  provider: "mock",                  // ref into the provider registry (§5)
  instructions,                       // base prompt (declared; not yet consumed — mock provider scripts its own output)
  tools: ["renderLead", "confirmSend"],
  approvals: ["confirmSend"],         // actions that pause for human-in-the-loop
  renders: { renderLead: "LeadCard", confirmSend: "ApprovalDialog" }, // tool name → component name
})
```

- `renders` is keyed **by tool name** (refinement of the original `key → component` idea):
  keying by tool name lets it drive client tool registration directly. The values are
  component *names*; a client-side registry (`renderRegistry.tsx`) maps names → React
  components, keeping the shared passport free of React imports.
- `defineAgent` validates STRUCTURE only — `approvals ⊆ tools`, `renders` keys ⊆ `tools`.
  The "provider exists" check is enforced at wiring time by `registry.resolve(def.provider)`,
  not in the passport (a passport doesn't know the registry).
- 💤 `fields` (configurable fields + `editableBy` + auto-form + storage split) — **deferred**:
  nothing consumes it until the form/DB land. `type` ∈ string | text | secret | number |
  boolean | enum; `secret` sourced from env by name. Rejoins the contract with the form/DB.

## 5. Provider registry ✅ (interface + registry + mock + `claude-cli` built)

Models are not hardcoded in the agent. A separate registry defines providers; agents
reference one by name. The `Provider` interface + `defineProviders` live in `@platform/core`
(`packages/core/src/providers.ts`); the concrete providers — `mock-provider` (fake) and the
real `claude-cli` provider — live in `@platform/providers` (`packages/providers/src/`). The
runtime registry that wires them lives **server-side** (`apps/inbox/server/providers.ts`):

```ts
defineProviders({
  mock:         createMockInboxProvider(...),          // ✅ scripted AG-UI stream
  'claude-cli': createClaudeCliProvider({ spawn, ... }), // ✅ real `claude` subprocess
  // 'claude-api': anthropic SDK …                      // 💤 deferred (needs API key)
})
```

`claude-cli` (✅, branch `feat/claude-cli-provider`): spawns the real `claude` binary
(`-p --output-format stream-json`, tools via a stdio MCP server), maps the NDJSON stream to
AG-UI events (`core/claude-stream.ts`), and pauses HITL by **detecting the `confirmSend`
tool call and killing the process**; resume is a stateless re-prime. The registry moved to
`server/` because the real provider needs Node and `core/` is client-imported; `spawn` is
injected so `core/claude-cli-provider.ts` stays Node-free.

The `Provider` interface is `run(input: RunAgentInput) → AsyncIterable<BaseEvent>`. CLI vs API
are different execution models normalized behind it; the runtime is swappable behind the
registry. **Decided:** wire `claude-cli` first (no API key; subscription login). `claude-api`
and a real agentic loop (Mastra) remain 💤.

## 5a. Dev record/replay layer ✅ (BUILT, `feat/dev-record-replay`)

A development-speed tool that wraps the real provider in a `Provider → Provider` decorator
(`withRecordReplay`) toggled by the `DEV_RECORD_REPLAY` env var. When set, every agent's
provider is wrapped at build time (`apps/inbox/server/build-agent.ts`); when unset the
production path is byte-identical.

**Cassette identity:** keyed by `wf__agent` (the runtime instance id — same agent in two
workflows = two files; dynamic client instances `wf__agent#N` collapse to the one server key)
PLUS **step** = `resolvedApprovalCount(input)` from `@platform/core` — the number of human
approvals already resolved in the run input. HITL splits one logical run into multiple provider
requests; step 0 = first run, step 1 = after the first approval, etc.

**Storage:** one JSONL file per `wf__agent` under `apps/inbox/.cassettes/`, each line
`{step, event}` (an AG-UI event). `CassetteStore` handles per-step read/write with atomic
writes (temp + rename) and never clobbers on an empty capture or a non-ENOENT read error.
`apps/inbox/.cassettes/` is in `.gitignore` — recordings hold real captured data.

**Mode toggle:** `DEV_RECORD_REPLAY=1` (or `=replay`) → auto (replay a recorded step, else
call the real provider and record); `=record` → force-overwrite always; unset → no wrapper.

**Share-safety:** `scanCassette(text): Finding[]` (pure, exported from
`apps/inbox/server/record-replay.ts`) performs a regex/keyword pass flagging emails, phones,
and token/secret-shaped strings with `{line, kind, snippet}`. It backs the mandatory agent
scan rule in `CLAUDE.md`. Names and addresses are not reliably regex-detectable — the human
is the final reviewer.

Spec: `docs/superpowers/specs/2026-06-08-dev-record-replay-design.md`. Developer guide (the
skill seed): `docs/dev-record-replay.md`. Build narrative: `docs/BUILD-LOG.md` §10.

## 6. Generative UI & the consumer UX 🎯 (slice is a first cut ✅)

**Rendering:** the agent emits tool calls that map to React components via a registry
(`renders` keys). Two polarities, and the chosen balance:
- Named components (LeadCard, ApprovalDialog…) for the polished, branded, predictable
  cases — **this is the default, and the constraint is a feature** (you don't want a model
  inventing arbitrary UI for a client).
- A **primitives kit** (Card, Field, Badge, Button, List) as an escape hatch the agent can
  compose for the long tail — flexibility, but still in your style. (primitives kit = 🎯)

**Consumer desktop UX (the vision):**
- A desktop of **agent cards**. A closed card shows: name, START button, a status indicator
  (idle / working / awaiting approval / done). ✅ built in the slice.
- Click → **modal** opens into a thread: the agent streams text + rich result components
  (e.g. an order card with a gmail icon, subject, and an action button), and pauses at
  approvals. ✅ built (text + LeadCard + ApprovalDialog).
- "One run, two views": closed card and open modal are two renderings of the same run
  (status + thread). ✅.
- **Human-in-the-loop** is the core product moment: the agent pauses at an `approval`,
  the manager clicks, the action proceeds, audit-logged (audit = 💤). ✅ (pause/resume built).

## 7. Skills storage 🎯 (future)

Skills ride **inside packages**, versioned with `npm update` (no drift, no DB):
`node_modules/@platform/*/skills/*/SKILL.md` + project `./skills/*`. Discovery by
convention (glob), not a list. `CLAUDE.md` is a thin pointer, not a duplicate of the
knowledge. Skills are also what make mode-2 chat-editing reliable (the chat agent reads
them instead of hallucinating). (We already do a lightweight version: `.claude/skills/rules/`.)

## 8. Stack & why each layer

| Layer | Choice | Role | Swappable? |
|---|---|---|---|
| Agent runtime ("brain") | Mastra 🎯 (mocked now) | agents, tools, memory, orchestration | yes, behind an `AgentRuntime` facade |
| BFF server ("door") | Hono ✅ | serves UI, auth, OAuth callback, proxy to runtime | yes (Express/Fastify) — but Hono fits CopilotKit's fetch handlers natively |
| Consumer UI ("face") | CopilotKit + AG-UI ✅ | streaming, generative UI, human-in-the-loop | used as a dependency, not competed with |
| Client | Vite + React (SPA) ✅ | thin server only proxies; data lives in runtime → SPA is cleaner than Next |
| Auth | Better Auth + RBAC 🎯, NullAuth now 🎯 | login, roles; design the interface now, run as admin-stub | — |
| DB | Drizzle + Postgres/SQLite 💤 | behind an abstraction; `DATABASE_URL` switch | — |
| Config | Zod ✅ | config-as-data; both front and back read it | — |
| Glue protocols | MCP (agent↔tools) 🎯, AG-UI (agent↔UI) ✅ | — | — |

Principle: rent/swap the "smart" parts (model, agent loop, UI plumbing — they ride the
rising tide); invest your soul in what the model won't take: real integrations,
trust/self-host/audit, last-mile UX, client relationships & context.

## 9. Roadmap

- ✅ **Vertical slice on mocks** — done, browser-verified, merged. (`apps/inbox/`)
- ✅ **Reusable core extracted** — typed message layer (deduped the toolCallId↔toolMessage logic,
  replaced `any`), `Provider` interface + registry + one fake provider, and the `defineAgent`
  contract — all threaded through server & client (TDD + two-stage review; browser-verified).
- ✅ **`@platform/*` package split (core + providers + integrations)** — extracted into a
  yarn-classic workspace: `@platform/core` (isomorphic contract), `@platform/providers`
  (isomorphic; injected spawn), `@platform/integrations` (node-only batteries; subpath exports +
  optional peers). Consumed by `apps/inbox` as raw TS source (no build step; `tsc --build`).
  Browser-verified e2e on real Gmail; 79 unit tests green. `@platform/react` + `@platform/server`
  stay 💤. `@platform/*` is a placeholder scope (rename before publish).
- ✅ **One real integration (Gmail MCP)** — `@platform/integrations/gmail-basic` (read latest /
  create draft, draft-only).
- 💤 **Then, roughly in order:** real agent (Mastra, beside `claude-cli`) → `@platform/react` +
  `@platform/server` extraction → auth/RBAC/audit → DB + config file/DB split → deploy (Docker,
  self-host) → (much later) mode-2 visual/chat editor, base⊕overrides. `fields` stay 💤.

## 10. Three ways to run (design intent) 🎯

Same files, three modes: local no-docker (`npm run dev`, sqlite, auth off — fast dev);
local docker (`docker compose up`, Postgres, hot-reload — prod parity); server
(`docker compose up -d`, Postgres, `AUTH_ENABLED=true`, client API key, self-host —
execution only). Edit code locally → `git push` → CI/CD deploys to client server.

## 11. How this maps to what exists today

Built: a **yarn-classic workspace** — `apps/inbox/` (Hono + CopilotKit v2 runtime, the consumer
card→modal→approval loop on real CopilotKit + AG-UI) consuming three extracted packages:
`@platform/core` (message layer, provider contract, `defineAgent`, handoff — §4/§5 BUILT),
`@platform/providers` (`claude-cli` real provider + mock + stream parser), and
`@platform/integrations` (`gmail-basic`, node-only). Packages are consumed as raw TS source (no
build step). The agent runs on the **real `claude-cli`** provider end-to-end on a real Gmail
account. `@platform/react` + `@platform/server` (extracting the client/server layers out of
`apps/inbox/`) are deferred; `@platform/*` is a placeholder scope to rename before publish.

**Packaging strategy (decision):** ONE batteries package per axis (one `@platform/integrations`,
one `@platform/providers`) with **subpath entrypoints + optional peer dependencies**, rather than
a package per integration/provider — validated against LangChain community / n8n / Vercel AI SDK.
Promote an integration or provider to its own package only when its **dependencies diverge**
(weight or conflict) or its **release cadence diverges** — NOT for tidiness. The contract
(`@platform/core`) is what enables third-party extension.

`fields`, config file/DB split (§3), skills storage (§7), §10, and parts of §6/§8 remain design
intent to be built incrementally. See the spec/plan in `docs/superpowers/`.
