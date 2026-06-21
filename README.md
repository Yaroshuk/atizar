<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/atizar-dark.svg" />
  <img alt="Atizar" src="assets/atizar-mark.svg" width="120" />
</picture>

# Atizar

### Not a 24/7 agent. A workflow you can _actually trust_.

_Open-source · Human-in-the-loop · TypeScript_

[![Website](https://img.shields.io/badge/website-atizar.io-e6562e.svg)](https://atizar.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-e6562e.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-e6562e.svg)](https://www.typescriptlang.org/)
[![Status: beta](https://img.shields.io/badge/status-beta-e6562e.svg)](#status)

[Website](https://atizar.io) · [Live demo](https://atizar.io/demo) · [**Use the template →**](https://github.com/Yaroshuk/atizar-demo-inbox) · [Quick start](#quick-start) · [Why atizar](#why-atizar) · [How it works](#how-it-works) · [Philosophy](docs/PHILOSOPHY.md)

</div>

---

Autonomous agents are easy to start and impossible to trust the moment they touch your inbox, your data, or your money. **Atizar keeps a human's hand on every step that matters** — the agent proposes, you approve, the server acts. Safe, predictable, auditable.

You build the automation in real TypeScript. The people who run it get a clean board — cards and buttons, never your codebase. One framework, two faces.

> **Developer builds · Human directs · Agent runs.**

## Why atizar

**🤖 Agentic-first — you don't write the pipeline.**
The coding agent plans, writes, and tests your workflow, guided by skills baked into the framework. Test-driven by default. You point it and stay in control.

**🔒 Safe by code — approval is a guarantee, not a prompt.**
Effect tools bind to server-side functions the model never sees, and run through an action ledger exactly once — only after you approve. A jailbroken prompt still cannot fire an action.

**🪟 Two faces — node editors fail everyone.**
Too low-ceiling for a developer (faster to open an editor), too noisy for an operator (they just want buttons). Atizar gives each its own: real TypeScript for you, a clean board for them.

**🔌 Engine-agnostic — swap the runtime, keep the code.**
Mastra, claude-cli, or your own runtime sit behind one thin contract — proven by a provider conformance suite, not just claimed.

> **You don't need 400+ integrations.** When the agent can write you any one in ~10 minutes — skills included — a marketplace is just lock-in.

## What "safe" actually means

- **Nothing irreversible without a yes.** Every consequential action waits behind an approval gate — edit it, approve it, or reject it.
- **Stop, instantly.** Halt one agent, one workflow, or everything at once, at any moment, no matter what's running.
- **Total transparency.** Every step the agent took is in the activity & trace log. Nothing happens off-screen.

The name is the Spanish verb _atizar_ — to stoke a fire that's already burning. The agent is the fire; you're the one tending it.

## Quick start

> **Beta.** The zero-credential demo runs entirely on an in-process database and recorded cassettes — no Docker, no API keys, no LLM provider.

Try it instantly, nothing to install: **[atizar.io/demo](https://atizar.io/demo)**.

### 👉 Build & deploy your own — start here

The **[`atizar-demo-inbox`](https://github.com/Yaroshuk/atizar-demo-inbox)** template is the place to
begin: a standalone project that installs `@atizar/*` straight from npm (nothing vendored), so you
clone it, run the demo, then edit the workflow to make it yours.

```bash
git clone https://github.com/Yaroshuk/atizar-demo-inbox
cd atizar-demo-inbox
npm install
npm run demo            # → http://localhost:5173  (zero-credential demo)
```

Then point it at your own Gmail, or build a new workflow with the `add-workflow` skill — its README
walks you through both.

---

Or explore the framework **source** in this monorepo:

```bash
yarn install --ignore-engines
yarn demo            # → http://localhost:5173  (landing → Open demo → the live pipeline)
```

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

**Building your own?** The same inbox also lives as a standalone project that installs the framework straight from npm — **[atizar-demo-inbox](https://github.com/Yaroshuk/atizar-demo-inbox)**. It's pure userland (workflow policy + UI cards, no framework source vendored), so it's the template to copy when you start your own automation: `npm install`, `npm run demo`, done.

## Run the inbox yourself

The demo above is zero-credential. To run the **real** inbox against your own Gmail, you supply three things: a Postgres database, an LLM provider, and a Google OAuth app. Everything is configured through environment variables — copy [`.env.example`](.env.example) to `.env.local` (gitignored) and fill only what you use.

### 1. Install & database

```bash
yarn install --ignore-engines
docker compose up -d postgres        # default DATABASE_URL already matches compose
yarn workspace inbox db:migrate      # create the schema
```

The Postgres URL resolves in order `ATIZAR_DATABASE_URL` → `DATABASE_URL` → the docker-compose default — so with the standard `docker compose up` you set nothing.

### 2. Credentials

| Variable                                                   | Required for          | What it is / where to get it                                                                                                                                                                                                         |
| ---------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ATIZAR_SECRET_KEY`                                        | any OAuth integration | AES master key for the **encrypted credential store**. Any strong random string (e.g. `openssl rand -hex 32`). Per-user OAuth tokens are encrypted with it at rest.                                                                  |
| `ANTHROPIC_API_KEY`                                        | production provider   | Anthropic API key, used when `PROVIDER=mastra`. (Vendor convention — **not** namespaced.)                                                                                                                                            |
| `ATIZAR_GOOGLE_CLIENT_ID`<br>`ATIZAR_GOOGLE_CLIENT_SECRET` | Gmail                 | One-time OAuth app from **Google Cloud Console → APIs & Services → Credentials → OAuth client ID**. Enable the Gmail API on the project. The per-user token is obtained later through the in-app **Connect** flow — not pasted here. |
| `ATIZAR_AUTH_TOKEN`                                        | recommended           | Shared bearer token guarding all mutation routes. Set it and send `Authorization: Bearer <token>` from the client.                                                                                                                   |

Choose a provider:

- **`PROVIDER=mastra`** — the production path. Needs `ANTHROPIC_API_KEY`. (Optional `MASTRA_MODEL` to pick the model.)
- **`PROVIDER=claude-cli`** — dev only. Uses your local Claude Code **subscription** via the macOS keychain — no API key — but spawns the `claude` binary, so it's not for production.

A minimal `.env.local` for a real Gmail run:

```bash
ATIZAR_SECRET_KEY=<openssl rand -hex 32>
PROVIDER=mastra
ANTHROPIC_API_KEY=sk-ant-...
ATIZAR_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
ATIZAR_GOOGLE_CLIENT_SECRET=...
ATIZAR_AUTH_TOKEN=<openssl rand -hex 32>
# DATABASE_URL defaults to the docker-compose Postgres — leave unset for the standard setup
```

### 3. Run & connect

```bash
yarn dev        # server (:4000) + client (:5173)
```

Open the app, **Connect** your Google account (the OAuth flow stores an encrypted per-user token), and the inbox workflow goes live: new mail is qualified, replies are drafted, and every consequential action waits for your approval before the server runs it.

> For a production build, run `yarn build:web` and start the server with `NODE_ENV=production`; the server serves the built client from `apps/inbox/dist`. The listen port comes from `PORT` (default `4000`).

## What's included

| Package                | What it is                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `@atizar/core`         | The isomorphic contract: `defineAgent`, the message layer, the provider interface, gates. React- and Node-free. |
| `@atizar/providers`    | Agent runtimes behind one interface: Mastra, claude-cli, and a mock for tests.                                  |
| `@atizar/integrations` | Batteries (e.g. Gmail) as injectable functions + read-only MCP wrappers.                                        |
| `@atizar/server`       | The server spine: Postgres-authoritative state, the dispatch chokepoint, server-executed effects, SSE.          |
| `@atizar/react`        | The UI: board, thread, approval gates, and the card-construction kit.                                           |

## Coding-agent skills

Atizar is agentic-first: the knowledge a coding agent needs to extend the framework ships **inside the packages**, right next to the code it describes — not in a separate wiki that drifts.

- `@atizar/core` carries the **`add-workflow`** skill — it scaffolds a new workflow end-to-end (ids, contracts, prompts, descriptor, server bindings, cards, the drift-guard test).
- `@atizar/integrations` carries the **`gmail`** skill, and `write-integration` rides inside the framework — connect a new service in minutes.

Claude Code reads skills from `.claude/skills/`, not from `node_modules`, so a small bridge wires them up. In your project, once:

```bash
npm i -D skills-npm
npx skills-npm setup     # adds a "prepare" hook to package.json
```

From then on, every `npm install` symlinks the skills shipped by your installed `@atizar/*` packages into `.claude/skills/`. Your coding agent then sees them — invoke `/add-workflow` and it builds the workflow with you. (This is exactly how [atizar-demo-inbox](https://github.com/Yaroshuk/atizar-demo-inbox) is set up.)

## Status

**Beta — building in the open.** The framework is validated end-to-end in the browser: the server spine (Postgres-authoritative state, server-executed effects, Stop/cancel), both providers (Mastra + claude-cli) behind one conformance-tested contract, the Gmail integration on an OAuth credential contract, and the operator UI (board, thread, approval gates, activity & trace log).

Recently shipped: **the npm release** — all five `@atizar/*` packages install as versioned dependencies (see [atizar-demo-inbox](https://github.com/Yaroshuk/atizar-demo-inbox) for a project that consumes them) — plus the zero-credential demo mode (`DEMO=1`), the `@platform/* → @atizar/*` scope rename, a shared bearer token on mutation routes, and per-workflow golden-set evals. APIs may still shift. Stars and feedback are very welcome.

## Roadmap

- **Workflows that learn** _(planned — not built yet)._ A direction we're designing toward: the agent improves from how you correct it, without fine-tuning. Two channels — implicit few-shot memory from past corrections, and explicit rules a distiller proposes and **you approve**. The model never changes, only the context it receives.

## Docs & community

- [Architecture](docs/ARCHITECTURE.md) · [Philosophy](docs/PHILOSOPHY.md)
- Examples: the [inbox workflows](apps/inbox)
- Questions & ideas: open a GitHub Discussion or Issue.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Atizar is agentic-first by design: the skills shipped inside each package guide you — and your coding agent — when you extend the framework or add an integration. That's the intended way in.

## Contact & feedback

Feedback, ideas, and proposals are very welcome — reach out any time:

- **Email:** [yaroshukmail@gmail.com](mailto:yaroshukmail@gmail.com)
- **Telegram:** [@yaroshuk](https://t.me/yaroshuk)
- **LinkedIn:** [in/syaroshuk](https://www.linkedin.com/in/syaroshuk)

## License

[MIT](LICENSE) © Atizar contributors. Security disclosures: [SECURITY.md](SECURITY.md).

<div align="center">
<sub>atizar — to stoke a fire. Keep it alive.</sub>
</div>
