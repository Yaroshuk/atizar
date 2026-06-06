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
- `createCopilotEndpoint({ runtime, basePath, mode })` returns a **Hono app** (HonoBase) whose ONLY route is
  `ALL ${basePath}/*` (`new Hono().basePath(basePath).all("*", c => handler(c.req.raw))`). Mount it with
  `app.route("/", copilot)`. That wildcard DOES match the bare `/api/copilotkit` (verified) — all real routing
  happens INSIDE `handler` (`createCopilotRuntimeHandler`), keyed off `mode`. `createCopilotEndpoint` is a
  deprecated alias of `createCopilotHonoHandler`. Dedicated subpath also exists: `@copilotkit/runtime/v2/hono`.
- **`mode` MUST match the client transport — this is the connection-handshake gotcha:**
  - `mode: "multi-route"` (the library default) exposes REST paths: `GET ${basePath}/info`,
    `POST ${basePath}/agent/:id/run`, etc. There is **no route at the bare `${basePath}`** → bare POST = 404.
  - `mode: "single-route"` exposes ONE endpoint: `POST ${basePath}` dispatched by a JSON envelope
    `{ method, params?, body? }` (e.g. `{ "method": "info" }`).
  - The v2 React client (`@copilotkit/react-core/v2`) defaults to the **single-endpoint transport**
    (`CopilotKitProvider` sets `useSingleEndpoint ?? true`; `@copilotkit/core` maps that to `transport: "single"`).
    Its handshake is `POST <runtimeUrl>` with body `{ "method": "info" }` (NOT `GET <runtimeUrl>/info`). So the
    server must be created with **`mode: "single-route"`**, else that bare POST 404s and the client logs
    `Runtime info request failed with status 404`.
  - **Decision: server uses `mode: "single-route"`** with `basePath: "/api/copilotkit"`; client keeps
    `runtimeUrl="/api/copilotkit"` (no client change needed). Verified headlessly:
    `curl -X POST :4000/api/copilotkit -d '{"method":"info"}'` → 200, and `{"method":"agent/run",...}` → 200 stream.
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

Generative UI — mapping agent-emitted tool calls → React components (Task 3, CONFIRMED):
- The v2 mechanism is **`useRenderTool`** (NOT `useCopilotAction`, which is the v1 API and absent from
  `@copilotkit/react-core/v2`). Import from `@copilotkit/react-core/v2`. Other v2 candidates inspected:
  `useFrontendTool` (client-executed tools w/ a handler), `useHumanInTheLoop` (render + `respond()` resume —
  this is what Task 4 will use for `confirmSend`), `useDefaultRenderTool` (wildcard fallback), `useRenderToolCall`.
- Signature: `useRenderTool({ name, parameters, render }, deps)` where `parameters` is a **Standard Schema**
  (Zod 4 is installed and used). `render` receives `{ name, toolCallId, parameters, status, result }` with
  `status` in `"inProgress" | "executing" | "complete"` — `parameters` is `Partial<T>` while `inProgress`,
  full `T` once `executing`/`complete`. Register inside a component nested under `<CopilotKit>`.
  Registrations live in `client/src/actions.tsx`, exported as `useInboxActions()`.
- **Rendering surface:** registering a renderer is not enough to paint it — something must invoke it.
  `useRenderToolCall()` returns a fn `({ toolCall, toolMessage? }) => ReactElement | null` that renders a single
  AG-UI tool call using the registered renderers. `App.tsx` maps over `agent.messages`, and for each assistant
  message's `toolCalls[]` (`{ id, function: { name, arguments } }`, type `ToolCall` from `@ag-ui/client`) calls
  `renderToolCall({ toolCall })`. (Alternative surface: CopilotKit's `<CopilotChat>`/`CopilotChatView` auto-apply
  these, but the spike uses the headless `useAgent` + manual render path, no chat UI.)
- Task 3 wiring: `renderLead` → `<LeadCard lead={parameters} />` (fully working); `confirmSend` → `<ApprovalDialog>`
  STUB (returns null; Task 4 swaps to `useHumanInTheLoop` with `respond()`).

Toolchain note: Vite 8 uses rolldown; npm did not auto-install the platform binding, so
`@rolldown/binding-darwin-arm64` is pinned as an explicit devDependency (macOS arm64 only — revisit for CI/other OS).

## Commands

Run from `apps/inbox/`:
- `npm run dev` — server (tsx watch, :4000) + client (vite, :5173) via concurrently; `/api` proxied to :4000.
- `npm run dev:server` / `npm run dev:client` — run each half separately.
- `npm run build` — vite production build.
- `npm run typecheck` — `tsc --noEmit`.
