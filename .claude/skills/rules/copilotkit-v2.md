# CopilotKit v2 + AG-UI — Must-Not-Rediscover Rules

Hard-won gotchas from the inbox vertical slice. Each rule is a one-liner;
✗/✓ shows the wrong and right forms.

---

## Imports

**v2 hooks/exports live under subpath exports, NOT the package root.**

- ✗ `import { useAgent } from "@copilotkit/react-core"`
- ✓ `import { useAgent } from "@copilotkit/react-core/v2"`
- ✗ `import { CopilotRuntime } from "@copilotkit/runtime"`
- ✓ `import { CopilotRuntime } from "@copilotkit/runtime/v2"`

---

## Server mode must match client transport

`mode: "single-route"` MUST pair with the v2 client's default single-endpoint transport;
`mode: "multi-route"` (the library default) has no route at the bare basepath → bare POST 404.

- ✗ `createCopilotEndpoint({ ..., mode: "multi-route" })` with default v2 React client
- ✓ `createCopilotEndpoint({ ..., mode: "single-route" })` — client handshake is `POST /api/copilotkit` with `{"method":"info"}`

---

## Generative UI hook

In v2 the generative-UI hook is `useRenderTool` (+ `useHumanInTheLoop` for HITL); `useCopilotAction` is v1 and absent.

- ✗ `useCopilotAction({ name: "renderLead", render: ... })`
- ✓ `useRenderTool({ name: "renderLead", parameters: zodSchema, render: ... })`

---

## Starting / resuming runs

Runs MUST go through `copilotkit.runAgent({ agent })` (from `useCopilotKit()`), NOT bare `agent.runAgent()`.

- ✗ `agent.runAgent()` — bypasses `CopilotKitCore`'s frontend-tool pipeline; HITL `respond()` never splices the tool-result message; follow-up sends `messages:[]` → agent re-runs turn 1.
- ✓ `const { copilotkit } = useCopilotKit(); copilotkit.runAgent({ agent })`

---

## Human-in-the-loop

HITL = `useHumanInTheLoop({ name, parameters, render })`. The `render` callback receives `respond` only while `status === "executing"`. Call `respond(value)` to resume the agent.

- ✓ `render: ({ args, status, respond }) => <ApprovalDialog onApprove={() => respond("approved")} />`
- Surface the matching `toolMessage` (by `toolCallId`) into `renderToolCall({ toolCall, toolMessage })` so the tool completes in the UI after approval.

---

## AG-UI ToolMessageSchema strips name

`ToolMessageSchema` strips `name`/`toolName` from tool result messages. Name-matching on tool results cannot work.

- ✗ Match tool results by `toolName === "confirmSend"`
- ✓ Collect assistant `confirmSend` tool call ids; match `role:"tool"` messages by `toolCallId`

---

## Derive UI state from message state, not render callbacks

Render callbacks only fire when the component is mounted. For status that must be visible even when the modal is closed, derive from `agent.messages`.

- ✗ `useHumanInTheLoop({ render: () => { setAwaitingApproval(true); ... } })` — only fires when modal is open
- ✓ `hasPendingApproval(agent.messages)` — pure function, render-independent: a `confirmSend` tool call with no matching `role:"tool"` result

---

## /threads 405 in single-route mode is benign

`GET /api/copilotkit/threads?agentId=...` → 405 is BY DESIGN in single-route mode.
Single-route serves only the POST envelope endpoint; `/threads` is a multi-route/Intelligence feature.
The client tolerates it. Not a bug, not worth investigating.
