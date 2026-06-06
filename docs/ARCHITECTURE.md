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

## 4. The `defineAgent` contract 🎯 (next-phase core)

A single object describes an agent; the form/UI, storage split, pauses, and rendering all
*derive* from it:

```ts
defineAgent({
  id, name, description,
  provider: "claude-api",            // ref into the provider registry (§5)
  instructions,                       // base prompt
  fields: {                           // configurable fields → auto-form + storage split
    replyPrompt: { type: "text",   label, editableBy: "manager",   default },
    senderEmail: { type: "string", label, editableBy: "developer" },
    apiKey:      { type: "secret", label, env: "GMAIL_API_KEY" },   // env-sourced
  },
  tools: ["gmailSearch", "gmailSend"],
  approvals: ["gmailSend"],           // actions that pause for human-in-the-loop
  renders: { lead: "LeadCard", approval: "ApprovalDialog" }, // key → component
})
```

- field `type` ∈ string | text | secret | number | boolean | enum.
- Form is generated from `fields` (auto-form from Zod) once there are many fields;
  hand-built is fine while few. Form filters by `currentUser.role` (admin sees more).
- `secret` is sourced from env by name (form shows the var name, never the value).

## 5. Provider registry 🎯

Models are not hardcoded in the agent. A separate registry defines providers; agents
reference one by name:

```ts
defineProviders({
  "claude-cli": { type: "cli", command: "claude" },      // runs Claude Code via CLI
  "claude-api": { type: "api", sdk: "anthropic", model: "claude-opus-4-8", apiKey: env("...") },
  "openai":     { type: "api", sdk: "openai",    model: "gpt-4",            apiKey: env("...") },
})
```

CLI vs API are different execution models, normalized behind one provider interface
(`run(messages, tools) → stream`). The runtime is swappable behind the registry.
**Open question for next session:** which provider to wire for real first.

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
- 🎯 **Next: extract the reusable core** — `defineAgent` contract, provider registry,
  unified message/registry layer (dedupe the toolCallId logic, replace `any` types). Full
  TDD + review loop starts here. See `CLAUDE.md` → "Next Phase".
- 💤 **Then, roughly in order:** real agent (Mastra) → one real integration (Gmail MCP) →
  auth/RBAC/audit → DB + config file/DB split → deploy (Docker, self-host) → (much later)
  mode-2 visual/chat editor, base⊕overrides, `@platform/*` package split.

## 10. Three ways to run (design intent) 🎯

Same files, three modes: local no-docker (`npm run dev`, sqlite, auth off — fast dev);
local docker (`docker compose up`, Postgres, hot-reload — prod parity); server
(`docker compose up -d`, Postgres, `AUTH_ENABLED=true`, client API key, self-host —
execution only). Edit code locally → `git push` → CI/CD deploys to client server.

## 11. How this maps to what exists today

Only `apps/inbox/` is built: a single app (no package split yet), Hono + CopilotKit v2
runtime, a **mock** custom agent (no real model), the consumer card→modal→approval loop
on real CopilotKit + AG-UI. Everything in §3–§5, §7, §10 and most of §6/§8 is design intent
to be built incrementally — starting with the core layer (§9). See the slice spec/plan in
`docs/superpowers/`.
