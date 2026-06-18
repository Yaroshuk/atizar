<!--
  DRAFT — do not publish/merge to a public default branch until:
  (1) the DEMO=1 quick-start command lands (see docs/superpowers/specs/2026-06-12-demo-mode-zero-cred-design.md),
  (2) the @platform/* → @atizar/* rename is done,
  (3) the approval-gate demo GIF is recorded.
  Design: docs/superpowers/specs/2026-06-12-readme-repo-presentation-design.md
-->

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/atizar-dark.svg" />
  <img alt="Atizar" src="assets/atizar-mark.svg" width="120" />
</picture>

# Atizar

**Developer builds. Human directs. Agent runs.**

_Don't light a fire and walk away. Tend it._

An open-source TypeScript framework for building agentic automations — agentic-first, human-in-the-loop.

[![License: MIT](https://img.shields.io/badge/License-MIT-e6562e.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-e6562e.svg)](https://www.typescriptlang.org/)
[![Status: beta](https://img.shields.io/badge/status-beta-e6562e.svg)](#status)

[Quick start](#quick-start) · [How it works](#how-it-works) · [Concepts](#core-concepts) · [Philosophy](docs/PHILOSOPHY.md) · [Contributing](CONTRIBUTING.md)

</div>

<!-- TODO: approval-gate demo GIF here once DEMO=1 lands -->

---

Autonomous agents are easy to start and hard to trust. The moment one touches your inbox, your data, or your money, "fire and forget" stops being a feature and starts being a liability.

**Atizar keeps a human's hand on the poker.** The agent does the work — reads, drafts, proposes — and a person approves every step that matters. The approved action is run by the server, never by the model. Everything is audited.

The name is the Spanish verb _atizar_ — to stoke a fire that's already burning. That's the whole idea: the agent is the fire, you're the one tending it.

### Built for developers — agentic-first.

You don't hand-write pipelines. The agent **plans, writes, and tests** — guided by **skills baked into the framework**. Your job is to point it at the right one and stay in control. Need an integration? Ask, and it's written in ~10 minutes. No 400-node marketplace.

### Two views of one pipeline.

Developers want code. The people who run it want a UI. So atizar gives each its own:

- **Developer → code.** Real TypeScript, no node canvas.
- **Consumer → a clean UI.** Cards and buttons, never your codebase.

### Safe by design — you're always in control.

No 24/7 agents running loose. Every consequential step is **proposed by the agent, approved by a human, executed by the server** — never the model — and fully audited.

- **Trace & activity log** — every step the agent took, visible.
- **Stop, instantly** — Stop agent · Stop workflow · Stop all.

Safety isn't bolted on. It's the foundation.

## See it work

<!-- TODO: GIF — agent board → thread → approval-gate card → approve → action executed & audited -->
<!-- TODO: side-by-side — a defineAgent snippet next to the clean operator UI -->

_Demo media lands with the zero-credential demo mode — see [Status](#status)._

## Quick start

> **Beta.** The zero-credential demo runs entirely on an in-process database and recorded cassettes — no Docker, no API keys.

Try the live demo locally:

```bash
yarn install --ignore-engines
yarn demo            # → http://localhost:5173  (landing → Open demo → the live pipeline)
```

Or run it as a single deployable process (`yarn build && yarn start:demo`) — see [deploying the demo](docs/DEPLOY.md).

The smallest thing you write looks like this:

```ts
import { defineAgent } from '@atizar/core'

export const reply = defineAgent({
  id: 'reply',
  name: 'Reply',
  role: 'worker',
  provider: 'claude-cli', // a name in the provider registry
  instructions: 'Draft a reply to the latest email.',
  readonly: ['get_latest_email'], // pure reads, no side effects
  tools: ['get_latest_email', 'saveDraft'],
  approvals: ['saveDraft'], // opens a gate — pauses for a human
  effects: ['saveDraft'], // the SERVER runs this once approved
  renders: { saveDraft: 'ApprovalDialog' }, // tool name → UI component
})
```

The agent drafts a reply and proposes it; the human approves; the server saves the draft. The model never sends anything on its own.

## How it works

Atizar is a thin layer, not another engine. You bring an agent runtime; atizar gives it a spine and two faces.

```
  Developer code + config        defineAgent / defineWorkflow  (TypeScript)
            │
            ▼
  Swappable runtime              Mastra (production)  ·  claude-cli (dev)
            │
            ▼
  Server spine                   Postgres state · server-executed effects · audit ledger
            │
            ▼
  AG-UI events  ───────────────▶ React UI — two views:
                                   code for the developer · a clean UI for the operator
```

The core knows no concrete engine. Swap the runtime without rewriting your workflows — a provider **conformance suite** proves the contract holds across both.

## Core concepts

- **Human-in-the-loop is a first-class gate.** Approvals are part of the agent contract (`approvals`), not a bolted-on callback. No consequential action runs without a human's yes.
- **The model proposes, the server executes.** On approval the _server_ runs the effect through an action ledger (keyed `workItemId + gateId`), exactly once. The model never holds the trigger.
- **Two views from one config.** A single validated config drives both faces: the developer edits code; the operator edits only declared leaf fields (prompt, name) through the UI.
- **Agentic-first: skills ride inside the packages.** Knowledge ships _with_ the code it describes, so your coding agent reads it to extend the framework instead of guessing.
- **Integrations on demand.** No marketplace. The `write-integration` skill walks an agent through a new integration in minutes (the Gmail integration was built this way).
- **Swap the runtime, keep the code.** Providers (Mastra, claude-cli, a test mock) sit behind one `AgentRuntime` contract — proven, not just declared, by the conformance suite.

## The flagship example: an inbox

The canonical workflow ships in [`apps/inbox`](apps/inbox): email or leads come in → an agent **qualifies** them → it **drafts** a reply or proposes actions → a human **approves** → the server acts (saves the draft, applies the labels). It runs on both providers and is the best place to see every concept above working together.

## What's included

| Package                | What it is                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `@atizar/core`         | The isomorphic contract: `defineAgent`, the message layer, the provider interface, gates. React- and Node-free. |
| `@atizar/providers`    | Agent runtimes behind one interface: Mastra, claude-cli, and a mock for tests.                                  |
| `@atizar/integrations` | Batteries (e.g. Gmail) as injectable functions + read-only MCP wrappers.                                        |
| `@atizar/server`       | The server spine: Postgres-authoritative state, the dispatch chokepoint, server-executed effects, SSE.          |
| `@atizar/react`        | The UI: board, thread, approval gates, and the card-construction kit.                                           |

## Status

**Beta — building in the open.** The framework is validated end-to-end in the browser: the server spine (Postgres-authoritative state, server-executed effects, Stop/cancel), both providers (Mastra + claude-cli) behind one conformance-tested contract, the Gmail integration on an OAuth credential contract, and the operator UI (board, thread, approval gates, activity & trace log).

Recently shipped: the zero-credential demo mode (`DEMO=1`), the `@platform/* → @atizar/*` scope rename, a shared bearer token on mutation routes, and per-workflow golden-set evals. Not done yet: an npm release. APIs may still shift. Stars and feedback are very welcome.

## Roadmap

- **npm release** — publish the `@atizar/*` packages so the framework installs as a versioned dependency.
- **Workflows that learn** _(planned — not built yet)._ A direction we're designing toward: the agent improves from how you correct it, without fine-tuning. Two channels — implicit few-shot memory from past corrections, and explicit rules a distiller proposes and **you approve**. The model never changes, only the context it receives.

## Docs & community

- [Architecture](docs/ARCHITECTURE.md) · [Philosophy](docs/PHILOSOPHY.md)
- Examples: the [inbox workflows](apps/inbox)
- Questions & ideas: open a GitHub Discussion or Issue.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Atizar is agentic-first by design: the skills shipped inside each package guide you — and your coding agent — when you extend the framework or add an integration. That's the intended way in.

## License

[MIT](LICENSE) © Atizar contributors. Security disclosures: [SECURITY.md](SECURITY.md).

<div align="center">
<sub>atizar — to stoke a fire. Keep it alive.</sub>
</div>
