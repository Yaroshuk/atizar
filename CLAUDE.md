# AiWorkflow — Open-source framework for agent automations

Framework for AI engineers who ship agentic automations to clients:
code for the engineer, a polished UI for the client. Default focus —
inbound flows (email/leads → qualify → human approval → action).

📐 **Read `docs/ARCHITECTURE.md` first** — the full vision & architecture
(three modes, config-as-data, `defineAgent`, providers, generative UI, roadmap),
with each item marked BUILT / DESIGN INTENT / DEFERRED. This file is the
operational index; that file is the big picture.

## Agent-First Project — Continuous Learning

This is an **agent-first project**. Every correction or decision that
isn't persisted is one that will repeat.

- New pattern / preference / decision → update this file or `.claude/skills/rules/`
- Architectural decision → record it here under "Decisions"
- These rules grow **organically** — add a rule the moment a real pattern
  appears in the code, not before.

## Conventions

All project content — docs, code, comments, identifiers, and user-facing/demo
strings — is written in English, regardless of the language used in chat.

## Skills / Rules

Hard-won API gotchas are distilled into rule files for quick recall:
- `.claude/skills/rules/copilotkit-v2.md` — CopilotKit v2 + AG-UI must-not-rediscover rules

## Current State

**COMPLETE — browser-verified.** The vertical slice loop works AND the reusable
core layer is extracted under `apps/inbox/core/`:
- `core/messages.ts` — typed message layer over `@ag-ui` (`hasPendingApproval`,
  `approvalResolved`, `pairToolResults`, guards). Replaces the `toolCallId↔toolMessage`
  logic that was duplicated in 3 files; no more `any`.
- `core/providers.ts` + `core/mock-provider.ts` — `Provider` interface
  (`run(input) → AsyncIterable<BaseEvent>`) + `defineProviders` registry + one fake
  provider that emits the scripted inbox stream.
- `core/defineAgent.ts` + `core/inbox.agent.ts` — the Zod-validated agent passport +
  the concrete inbox instance (`inboxAgent`, `providerRegistry`).
- Threaded through both sides: server (`server/build-agent.ts`) builds the
  `BuiltInAgent` from the passport + registry; client (`client/src/renderRegistry.tsx`,
  `actions.tsx`, `useAgentStatus.ts`, `AgentModal.tsx`, `App.tsx`) reads the passport.
  The hardcoded `"confirmSend"`/`"renderLead"`/`"LeadCard"` strings are gone.

Behavior is identical to the slice (closed card Idle → Working → Awaiting approval →
Done; modal thread = assistant text + LeadCard + ApprovalDialog; approve → resume →
"Done — reply sent."). 28 unit tests pass; browser click-through re-verified. See:
- Slice: `docs/superpowers/specs/2026-06-06-inbox-vertical-slice-design.md` (+ plan)
- Core layer: `docs/superpowers/specs/2026-06-06-core-layer-design.md`
  + `docs/superpowers/plans/2026-06-06-core-layer.md`

## Next Phase — first real provider (NOT STARTED)

The core proved the contract on a fake provider. Next: wire ONE real provider behind
the `Provider` interface (`core/providers.ts`). **Open question to decide first:**
`claude-cli` vs `claude-api`. Then a real agentic loop (Mastra) and one real integration
(Gmail/MCP). Go through brainstorm → spec → plan → execution as before.

**Still deferred (don't pull in yet):** `defineAgent.fields` (+ auto-form), DB + config
file/DB layering (base⊕overrides), auth/RBAC/audit, the `@platform/*` package split,
mode-2 visual/chat editor.

**Read before starting:** this file (Decisions + the CopilotKit v2 API notes below),
`.claude/skills/rules/copilotkit-v2.md`, `docs/ARCHITECTURE.md`, and `apps/inbox/core/`.

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
- Core layer lives in `apps/inbox/core/` (shared by client+server, no React/runtime imports). NOT a package yet — `@platform/*` split deferred until the contract settles and a 2nd consumer exists.
- Message layer reuses `@ag-ui` types IN FULL (import `Message`/`ToolCall` from `@ag-ui/client`; derive per-role types via `Extract<Message,{role}>` — `@ag-ui/client` doesn't export `AssistantMessage`/`ToolMessage` by name). We add behavior (pure functions), not a parallel domain model. Approval tool names are a PARAMETER (from `def.approvals`), never hardcoded.
- `defineAgent.renders` is keyed BY TOOL NAME (`{ renderLead: "LeadCard", confirmSend: "ApprovalDialog" }`), refining the doc's abstract `key→component`; it drives client registration directly. Values are component *names*; the client `renderRegistry` maps name→React component (keeps `core/` React-free).
- `defineAgent` validates STRUCTURE only (`approvals ⊆ tools`, `renders` keys ⊆ `tools`). Provider-existence is enforced by `registry.resolve(def.provider)` at wiring time, not in the passport.
- `defineAgent(def)` param is typed as `AgentDefinition` (the output type), not `unknown` — deliberate: the only caller is a hand-authored literal that benefits from compile-time field checks, and `parse()` still runs the cross-field rules. Switch to `unknown` (+ `.strict()`) when config is loaded from file/DB (deferred).
- `zod` is now an explicit dependency of `apps/inbox` (was transitive); `core/defineAgent.ts` uses it directly. zod v3 API.
- AgentCard status is a **string literal union, deliberately NOT a TS `enum`** (zero runtime cost, value IS the wire string, `Record<Status,…>` gives exhaustiveness — enum adds a runtime object + `const enum`/bundler footguns). Single source of truth: `client/src/status.ts` — `STATUSES` (`as const` array, also a runtime list) → `Status` (derived union) → `Lifecycle` (`Exclude<Status,"awaiting_approval">`, the run-lifecycle subset). Client-only: server/provider never reference status, so it lives in `client/`, not `core/`.

### CopilotKit v2 API — CONFIRMED against installed packages

Installed versions (note: package version is 1.59.5, but a real `/v2` subpath ships inside it):
- `@copilotkit/runtime` 1.59.5
- `@copilotkit/react-core` 1.59.5
- `@ag-ui/client` 0.0.55 (re-exports `@ag-ui/core`)

**v2 subpath imports are required:** server imports come from `@copilotkit/runtime/v2`;
client hooks come from `@copilotkit/react-core/v2` (NOT the package root).

Server (import from `@copilotkit/runtime/v2`):
- `new CopilotRuntime({ agents: { default: agent }, runner: new InMemoryAgentRunner() })` — `runner` is optional.
- `new BuiltInAgent({ type: "custom", factory })` — custom factory yields raw AG-UI `BaseEvent`s.
  Factory signature: `(ctx: { input: RunAgentInput; abortController; abortSignal }) => AsyncIterable<BaseEvent>`.
- `createCopilotEndpoint({ runtime, basePath, mode })` returns a Hono app whose ONLY route is
  `ALL ${basePath}/*`. Mount it with `app.route("/", copilot)`. `createCopilotEndpoint` is a
  deprecated alias of `createCopilotHonoHandler`. Dedicated subpath also exists: `@copilotkit/runtime/v2/hono`.
- **`mode` MUST match the client transport:**
  - `mode: "multi-route"` (library default) exposes REST paths (`GET ${basePath}/info`, etc.). There is **no route
    at the bare `${basePath}`** → bare POST = 404.
  - `mode: "single-route"` exposes ONE endpoint: `POST ${basePath}` dispatched by a JSON envelope
    `{ method, params?, body? }`.
  - The v2 React client defaults to single-endpoint transport (`useSingleEndpoint ?? true`), handshake is
    `POST <runtimeUrl>` with body `{ "method": "info" }`. **Server MUST use `mode: "single-route"`**, else
    the bare POST 404s with `Runtime info request failed with status 404`.
  - **Decision: server uses `mode: "single-route"`** with `basePath: "/api/copilotkit"`.
    Verified: `curl -X POST :4000/api/copilotkit -d '{"method":"info"}'` → 200.
- AG-UI events from `@ag-ui/client`: `EventType.TEXT_MESSAGE_CHUNK` with fields `{ type, role, messageId, delta }`.

Client (import from `@copilotkit/react-core/v2`):
- `<CopilotKit runtimeUrl="/api/copilotkit">` provider.
- `useAgent({ agentId: "default", updates: [UseAgentUpdate.OnMessagesChanged] })` returns **`{ agent }`**
  (an AG-UI `AbstractAgent`). Read messages via `agent.messages`; subscribe to lifecycle events via
  `agent.subscribe({ onRunStartedEvent, onRunFinalized, onRunFailed, onMessagesChanged })`.
- **CRITICAL — runs MUST go through `copilotkit.runAgent({ agent })`** (from `const { copilotkit } = useCopilotKit()`).
  **Do NOT call bare `agent.runAgent()`.**
  - `agent.runAgent()` (the AG-UI `AbstractAgent` method) only streams one turn and accumulates messages.
    It does NOT run CopilotKit's frontend-tool pipeline. The human-in-the-loop resume lives in
    `CopilotKitCore.runAgent` → `processAgentResult`: that is what invokes the `useHumanInTheLoop` tool
    handler (resolving the `respond` Promise), splices the resulting `role:"tool"` message into
    `agent.messages`, and — because `followUp` defaults on — fires the follow-up `runAgent({ agent })`.
    That follow-up re-runs the SAME agent, so `prepareRunAgentInput` reads the now-populated
    `agent.messages` (history + the confirmSend tool call + the tool result), and the resume POST carries
    the full conversation instead of `[]`.
  - Calling bare `agent.runAgent()` bypasses all of that. The resume run would send `messages: []` and the
    agent would re-emit turn 1 instead of resuming. **Verified: `App.tsx` uses `copilotkit.runAgent({ agent })`.**
- `*.css` side-effect imports need an ambient `declare module "*.css"` (TS 6.0 strictness) — see
  `client/src/vite-env.d.ts`.

### Generative UI

v2 mechanism: **`useRenderTool`** and **`useHumanInTheLoop`** (NOT `useCopilotAction`, which is v1/absent from
`@copilotkit/react-core/v2`). Import from `@copilotkit/react-core/v2`. Register inside a component nested
under `<CopilotKit>`. Registrations live in `client/src/actions.tsx`, exported as `useInboxActions()`.

Tool registrations (both REAL and working):
- **`renderLead`** — `useRenderTool({ name, parameters, render })`: pure generative UI, maps to `<LeadCard />`.
  `render` receives `{ name, toolCallId, parameters, status, result }`. `parameters` is `Partial<T>` while
  `inProgress`, full `T` once `executing`/`complete`. Note: historical tool calls surfaced via
  `useRenderToolCall({ toolCall })` (no `toolMessage`) are reported as `status: "inProgress"` even though
  arguments are fully streamed — gate on field presence, not status.
- **`confirmSend`** — `useHumanInTheLoop({ name, parameters, render })` (REAL, not a stub):
  the hook registers a frontend tool whose handler returns a Promise that stays pending until the user acts.
  `render` receives `{ args, status, respond }` where `respond` is only present while `status === "executing"`.
  `render` returns `<ApprovalDialog ... onApprove={() => respond("approved")} />`. Calling `respond("approved")`
  resolves the Promise, the framework records a `role:"tool"` message with the matching `toolCallId`, and
  (followUp default) re-runs the agent — this is the resume turn the server detects in `approvalResolved`.

**Rendering surface:** `useRenderToolCall()` returns `({ toolCall, toolMessage? }) => ReactElement | null`.
`App.tsx` maps over `agent.messages`; `<AgentModal>` pairs each assistant `toolCalls[]` entry with its
matching `role:"tool"` message by `toolCallId` and calls `renderToolCall({ toolCall, toolMessage? })`.

### Human-in-the-Loop + Resume

The HITL flow (verified end-to-end):
1. Server emits `confirmSend` tool call events. Client-side `useHumanInTheLoop` intercepts it, returns an
   `<ApprovalDialog>` with `respond` live.
2. User clicks approve → `respond("approved")`. `CopilotKitCore` splices a `role:"tool"` message into
   `agent.messages` with the matching `toolCallId`, then fires a follow-up `copilotkit.runAgent({ agent })`.
3. Server's `approvalResolved(input)` detects the resumed turn: it collects all assistant `confirmSend`
   `toolCallId`s, then checks whether any `role:"tool"` message's `toolCallId` matches.
   **AG-UI's `ToolMessageSchema` STRIPS `name`/`toolName`** from tool result messages — name-matching cannot
   work; correlation MUST be by `toolCallId`.
4. Server emits "Done — reply sent." and the run finalizes.

### Status Derivation

`useAgentStatus(agent)` in `client/src/useAgentStatus.ts`:
- **Lifecycle** (`running`/`done`/`error`) comes from `agent.subscribe({ onRunStartedEvent, onRunFinalized, onRunFailed })`.
- **`awaiting_approval`** is derived from MESSAGE STATE via pure `hasPendingApproval(messages)`:
  a `confirmSend` tool call exists in messages with no matching `role:"tool"` result.
- This is **render-independent**: the closed AgentCard shows "Awaiting approval" even when the modal (and
  `<ApprovalDialog>`) are not mounted.
- `awaiting_approval` **takes priority over `done`**: `onRunFinalized` fires at the end of turn 1, at the
  exact moment the agent pauses for the human. Without the message-state override, lifecycle would read "done"
  while still awaiting approval. Only a terminal `error` wins over `awaiting_approval`.
- **Do NOT derive `awaiting_approval` from a tool's render/executing callback** — that only fires when the
  modal is open (a bug we already hit and fixed).

### Known Issues (Benign)

- `GET /api/copilotkit/threads?agentId=default` → **405 in single-route mode** is BY DESIGN. Single-route
  serves only the POST envelope endpoint; `/threads` is a multi-route / Intelligence feature. The client
  tolerates it gracefully. Not a bug.

Toolchain note: Vite 8 uses rolldown; npm did not auto-install the platform binding, so
`@rolldown/binding-darwin-arm64` is pinned as an explicit devDependency (macOS arm64 only — revisit for CI/other OS).

## Commands

Run from `apps/inbox/`:
- `npm run dev` — server (tsx watch, :4000) + client (vite, :5173) via concurrently; `/api` proxied to :4000.
- `npm run dev:server` / `npm run dev:client` — run each half separately.
- `npm run build` — vite production build.
- `npm run typecheck` — `tsc --noEmit`.
- `npm test` — run vitest (unit tests).
