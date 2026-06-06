# AiWorkflow — Open-source framework for agent automations

Framework for AI engineers who ship agentic automations to clients:
code for the engineer, a polished UI for the client. Default focus —
inbound flows (email/leads → qualify → human approval → action).

## Agent-First Project — Continuous Learning

This is an **agent-first project**. Every correction or decision that
isn't persisted is one that will repeat.

- New pattern / preference / decision → update this file or `.claude/skills/rules/`
- Architectural decision → record it here under "Decisions"
- These rules grow **organically** — add a rule the moment a real pattern
  appears in the code, not before.

## Current State

First milestone: vertical slice on mocks — one agent card, START runs a
mock agent through the real CopilotKit + AG-UI loop (text → lead card →
approval → resume). See:
- Spec: `docs/superpowers/specs/2026-06-06-inbox-vertical-slice-design.md`
- Plan: `docs/superpowers/plans/2026-06-06-inbox-vertical-slice.md`

## Stack

- Client: Vite + React + TypeScript
- Server: Hono (thin BFF)
- Agent UI: CopilotKit + AG-UI (`@copilotkit/runtime` v2, `@copilotkit/react-core`)
- Mocked for now: real model, Mastra, Gmail, DB, auth

## Decisions

- Server = Hono (Web-Standards / fetch; mounts CopilotKit endpoint without adapters). Swappable behind a thin layer.
- Slice verified by manual click-through; TDD + review loop starts with the reusable core layer (next phase).
- Config split (later): structure in files, manager-editable text fields in DB; secrets in env only.
- Models accessed via a separate provider registry (CLI / API); agents reference a provider by name.

### CopilotKit v2 API — CONFIRMED against installed packages (Task 1 spike)

Installed versions (note: package version is 1.59.5, but a real `/v2` subpath ships inside it):
- `@copilotkit/runtime` 1.59.5
- `@copilotkit/react-core` 1.59.5
- `@ag-ui/client` 0.0.55 (re-exports `@ag-ui/core`)

Server (import from `@copilotkit/runtime/v2`):
- `new CopilotRuntime({ agents: { default: agent }, runner: new InMemoryAgentRunner() })` — `runner` is optional.
- `new BuiltInAgent({ type: "custom", factory })` — custom factory yields raw AG-UI `BaseEvent`s.
  Factory signature: `(ctx: { input: RunAgentInput; abortController; abortSignal }) => AsyncIterable<BaseEvent>`.
  (The `({ input })` destructure works but isn't required for the spike.)
- `createCopilotEndpoint({ runtime, basePath: "/api/copilotkit" })` returns a **Hono app** (HonoBase) with the
  route `ALL ${basePath}/*` already baked in. Mount it with `app.route("/", copilot)` (NOT a raw fetch handler,
  NOT `app.all(...)(c.req.raw)`). `createCopilotEndpoint` is a deprecated alias of `createCopilotHonoHandler`.
  Dedicated subpath also exists: `@copilotkit/runtime/v2/hono`.
- AG-UI events from `@ag-ui/client`: `EventType.TEXT_MESSAGE_CHUNK` with fields `{ type, role, messageId, delta }`
  (all optional in schema). `BaseEvent` type imported from the same package.

Client (import from `@copilotkit/react-core/v2` — the v2 hooks are NOT on the package root):
- `<CopilotKit runtimeUrl="/api/copilotkit">` provider (component; `CopilotKitProvider` is the underlying FC).
- `useAgent({ agentId: "default", updates: [UseAgentUpdate.OnMessagesChanged] })` returns **`{ agent }`**
  (an AG-UI `AbstractAgent`) — NOT `{ messages, runAgent }`.
  - Run with `agent.runAgent()`. Read messages via `agent.messages`.
  - Pass `updates: [UseAgentUpdate.OnMessagesChanged]` so React re-renders as the stream mutates `agent.messages`.
- `*.css` side-effect imports need an ambient `declare module "*.css"` (TS 6.0 strictness) — see
  `client/src/vite-env.d.ts`.

Toolchain note: Vite 8 uses rolldown; npm did not auto-install the platform binding, so
`@rolldown/binding-darwin-arm64` is pinned as an explicit devDependency (macOS arm64 only — revisit for CI/other OS).

## Commands

Run from `apps/inbox/`:
- `npm run dev` — server (tsx watch, :4000) + client (vite, :5173) via concurrently; `/api` proxied to :4000.
- `npm run dev:server` / `npm run dev:client` — run each half separately.
- `npm run build` — vite production build.
- `npm run typecheck` — `tsc --noEmit`.
