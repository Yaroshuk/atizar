# CopilotKit v2 + AG-UI — confirmed API notes

Hard-won, verified-against-installed-packages notes for this project's CopilotKit v2 +
AG-UI usage. Quick-recall rules also live in `.claude/skills/rules/copilotkit-v2.md`; this
is the longer reference. `CLAUDE.md` links here.

Installed versions (package version is 1.59.5, but a real `/v2` subpath ships inside it):

- `@copilotkit/runtime` 1.59.5
- `@copilotkit/react-core` 1.59.5
- `@ag-ui/client` 0.0.55 (re-exports `@ag-ui/core`)

**v2 subpath imports are required:** server imports come from `@copilotkit/runtime/v2`;
client hooks come from `@copilotkit/react-core/v2` (NOT the package root).

## Server (`@copilotkit/runtime/v2`)

- `new CopilotRuntime({ agents: { default: agent }, runner: new InMemoryAgentRunner() })` —
  `runner` is optional.
- `new BuiltInAgent({ type: "custom", factory })` — custom factory yields raw AG-UI
  `BaseEvent`s. Factory signature:
  `(ctx: { input: RunAgentInput; abortController; abortSignal }) => AsyncIterable<BaseEvent>`.
- `createCopilotEndpoint({ runtime, basePath, mode })` returns a Hono app whose ONLY route is
  `ALL ${basePath}/*`. Mount it with `app.route("/", copilot)`. `createCopilotEndpoint` is a
  deprecated alias of `createCopilotHonoHandler`. Dedicated subpath also exists:
  `@copilotkit/runtime/v2/hono`.
- **`mode` MUST match the client transport:**
  - `mode: "multi-route"` (library default) exposes REST paths (`GET ${basePath}/info`, etc.).
    There is **no route at the bare `${basePath}`** → bare POST = 404.
  - `mode: "single-route"` exposes ONE endpoint: `POST ${basePath}` dispatched by a JSON
    envelope `{ method, params?, body? }`.
  - The v2 React client defaults to single-endpoint transport (`useSingleEndpoint ?? true`),
    handshake is `POST <runtimeUrl>` with body `{ "method": "info" }`. **Server MUST use
    `mode: "single-route"`**, else the bare POST 404s with `Runtime info request failed with
    status 404`.
  - **Decision: server uses `mode: "single-route"`** with `basePath: "/api/copilotkit"`.
    Verified: `curl -X POST :4000/api/copilotkit -d '{"method":"info"}'` → 200.
- AG-UI events from `@ag-ui/client`: `EventType.TEXT_MESSAGE_CHUNK` with fields
  `{ type, role, messageId, delta }`.

## Client (`@copilotkit/react-core/v2`)

- `<CopilotKit runtimeUrl="/api/copilotkit">` provider.
- `useAgent({ agentId: "default", updates: [UseAgentUpdate.OnMessagesChanged] })` returns
  **`{ agent }`** (an AG-UI `AbstractAgent`). Read messages via `agent.messages`; subscribe to
  lifecycle events via `agent.subscribe({ onRunStartedEvent, onRunFinalized, onRunFailed,
  onMessagesChanged })`.
- **CRITICAL — runs MUST go through `copilotkit.runAgent({ agent })`** (from
  `const { copilotkit } = useCopilotKit()`). **Do NOT call bare `agent.runAgent()`.**
  - `agent.runAgent()` (the AG-UI `AbstractAgent` method) only streams one turn and accumulates
    messages. It does NOT run CopilotKit's frontend-tool pipeline. The human-in-the-loop resume
    lives in `CopilotKitCore.runAgent` → `processAgentResult`: that invokes the
    `useHumanInTheLoop` tool handler (resolving the `respond` Promise), splices the resulting
    `role:"tool"` message into `agent.messages`, and — because `followUp` defaults on — fires the
    follow-up `runAgent({ agent })`. That follow-up re-runs the SAME agent, so
    `prepareRunAgentInput` reads the now-populated `agent.messages` (history + the confirmSend tool
    call + the tool result), and the resume POST carries the full conversation instead of `[]`.
  - Calling bare `agent.runAgent()` bypasses all of that — the resume run would send `messages: []`
    and the agent would re-emit turn 1. **Verified: `App.tsx` uses `copilotkit.runAgent({ agent })`.**
- `*.css` side-effect imports need an ambient `declare module "*.css"` (TS 6.0 strictness) — see
  `client/src/vite-env.d.ts`.

## Generative UI

v2 mechanism: **`useRenderTool`** and **`useHumanInTheLoop`** (NOT `useCopilotAction`, which is
v1/absent from `@copilotkit/react-core/v2`). Import from `@copilotkit/react-core/v2`. Register
inside a component nested under `<CopilotKit>`. Registrations live in `client/src/actions.tsx`,
exported as `useInboxActions()`.

- **`renderLead`** — `useRenderTool({ name, parameters, render })`: pure generative UI, maps to
  `<LeadCard />`. `render` receives `{ name, toolCallId, parameters, status, result }`.
  `parameters` is `Partial<T>` while `inProgress`, full `T` once `executing`/`complete`. Note:
  historical tool calls surfaced via `useRenderToolCall({ toolCall })` (no `toolMessage`) are
  reported as `status: "inProgress"` even though arguments are fully streamed — **gate on field
  presence, not status.**
- **`confirmSend`/`saveDraft`** — `useHumanInTheLoop({ name, parameters, render })` (REAL, not a
  stub): the hook registers a frontend tool whose handler returns a Promise that stays pending
  until the user acts. `render` receives `{ args, status, respond }` where `respond` is only
  present while `status === "executing"`. `render` returns `<ApprovalDialog ...
  onApprove={() => respond("approved")} />`. Calling `respond("approved")` resolves the Promise,
  the framework records a `role:"tool"` message with the matching `toolCallId`, and (followUp
  default) re-runs the agent — the resume turn the server detects.

**Rendering surface:** `useRenderToolCall()` returns
`({ toolCall, toolMessage? }) => ReactElement | null`. `AgentModal` maps over `agent.messages`,
pairs each assistant `toolCalls[]` entry with its matching `role:"tool"` message by `toolCallId`,
and calls `renderToolCall({ toolCall, toolMessage? })`.

## Human-in-the-Loop + Resume

Verified end-to-end:

1. Server emits the approval tool-call events. Client-side `useHumanInTheLoop` intercepts it,
   returns an `<ApprovalDialog>` with `respond` live.
2. User clicks approve → `respond("approved")`. `CopilotKitCore` splices a `role:"tool"` message
   into `agent.messages` with the matching `toolCallId`, then fires a follow-up
   `copilotkit.runAgent({ agent })`.
3. Server's `approvalResolved(input)` detects the resumed turn: it collects all assistant approval
   `toolCallId`s, then checks whether any `role:"tool"` message's `toolCallId` matches.
   **AG-UI's `ToolMessageSchema` STRIPS `name`/`toolName`** from tool result messages —
   name-matching cannot work; correlation MUST be by `toolCallId`.
4. Server emits the done message and the run finalizes.

## Status derivation

`useAgentStatus(agent)` in `client/src/useAgentStatus.ts`:

- **Lifecycle** (`running`/`done`/`error`) comes from
  `agent.subscribe({ onRunStartedEvent, onRunFinalized, onRunFailed })`.
- **`awaiting_approval`** is derived from MESSAGE STATE via pure `hasPendingApproval(messages)`:
  an approval tool call exists in messages with no matching `role:"tool"` result.
- This is **render-independent**: the closed AgentCard shows "Awaiting approval" even when the
  modal (and `<ApprovalDialog>`) are not mounted.
- `awaiting_approval` **takes priority over `done`**: `onRunFinalized` fires at the end of turn 1,
  at the exact moment the agent pauses for the human. Without the message-state override, lifecycle
  would read "done" while still awaiting approval. Only a terminal `error` wins over
  `awaiting_approval`.
- **Do NOT derive `awaiting_approval` from a tool's render/executing callback** — that only fires
  when the modal is open (a bug we already hit and fixed).

## Known issues (benign)

- `GET /api/copilotkit/threads?agentId=…` → **405 in single-route mode** is BY DESIGN. Single-route
  serves only the POST envelope endpoint; `/threads` is a multi-route / Intelligence feature. The
  client tolerates it gracefully. Not a bug.
- Toolchain: Vite 8 uses rolldown; npm did not auto-install the platform binding, so
  `@rolldown/binding-darwin-arm64` is pinned as an explicit devDependency (macOS arm64 only —
  revisit for CI/other OS).
