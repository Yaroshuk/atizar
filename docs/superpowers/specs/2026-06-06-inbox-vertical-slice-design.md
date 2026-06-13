# Design: "Inbox" vertical slice on mocks

- **Date:** 2026-06-06
- **Status:** in review
- **Author:** Sergey + Claude

## 1. Context and goal

Greenfield project: an open-source framework for AI engineers who ship agentic
automations to clients (a split between "developer mode" and "consumer mode").
The default focus is processing inbound flows: email/lead → qualify → human
approval → action.

This is the **first working artifact** — a top-to-bottom vertical slice on fake
data. The goal: in one or two days, get a **live, clickable dashboard** and prove
that the riskiest part of the stack (CopilotKit + AG-UI: streaming, generative
UI, human-in-the-loop) works end-to-end.

The approach is chosen deliberately — **"as close to real as possible" (approach
B)**: all the wiring is real (CopilotKit, AG-UI, Hono, Copilot Runtime); only the
agent itself is fake (a scripted event stream, no real model).

## 2. Scope

### In the slice (we build)

- One screen — a desktop with a single agent card, "EMAIL AGENT".
- Closed card: name, START button, visual status indicator.
- Open card (modal): a chat thread with the agent's work.
- A fake agent that, on START, streams a scripted event sequence.
- Generative UI: the agent renders a lead card (`LeadCard`).
- Human-in-the-loop: a pause for approval (`ApprovalDialog`); a button resumes it.
- Real CopilotKit + AG-UI + Hono + Copilot Runtime.

### Out of the slice (deferred)

- Mastra / a real agentic loop / a real model.
- Real integrations (Gmail, etc.), MCP.
- A database, settings storage, the file/DB split.
- Authentication, roles, RBAC, audit log.
- A `@atizar/*` package split (extracted later, once the loop works).
- A provider registry, the `defineAgent` contract, a visual editor, mode 2/3 in
  full, auto-generating forms from Zod.

## 3. Slice stack

| Layer | Tool | Role |
|---|---|---|
| Interface | React + Vite | renders the card, thread, buttons; fast dev/hot-reload |
| Language | TypeScript | type safety |
| Server | Hono | thin BFF; mounts the Copilot Runtime |
| Agent UI | `@copilotkit/react-core`, `@copilotkit/react-ui` | streaming, generative UI, human-in-the-loop |
| Runtime | `@copilotkit/runtime` (v2) | CopilotKit's server layer |
| Events | `@ag-ui/client` | AG-UI event types for the fake agent |
| Styles | Tailwind CSS | a tidy look without the fuss |

Hono is chosen on purpose: it is built on Web standards (fetch), so
`createCopilotEndpoint` (a fetch handler) mounts into it without adapters. The
server is interchangeable behind a thin layer — it can be swapped for
Express/Fastify without reworking the rest.

## 4. File structure

A single application, with no package split. Client and server run together.

```
apps/inbox/
├── package.json                    # the dev script runs client + server
├── client/                         # interface (Vite + React)
│   └── src/
│       ├── main.tsx                # entry point
│       ├── App.tsx                 # <CopilotKit> provider + desktop
│       ├── actions.ts              # useCopilotAction: renderLead, confirmSend
│       └── components/
│           ├── AgentCard.tsx       # CLOSED card: name, START, status indicator
│           ├── AgentModal.tsx      # OPEN card: chat thread
│           ├── LeadCard.tsx        # lead card (rendered by the agent via render)
│           └── ApprovalDialog.tsx  # approval dialog (renderAndWaitForResponse)
└── server/                         # thin server (Hono)
    ├── index.ts                    # Hono + CopilotRuntime, /api/copilotkit endpoint
    └── mock-agent.ts               # BuiltInAgent type:"custom", scripted event stream
```

## 5. Signal flow (the loop)

```
manager clicks START on the AgentCard
  → client kicks off the agent run on the server (/api/copilotkit)
  → mock-agent (async generator) emits AG-UI events in order:
       1. TEXT_MESSAGE_CHUNK "Checking inbox…"        → thread; status = "working"
       2. TOOL_CALL (renderLead) {lead data}           → CopilotKit renders <LeadCard>
       3. TOOL_CALL (confirmSend) {…}                  → pause, renders <ApprovalDialog>,
                                                          status = "awaiting approval"
  → manager clicks "Send" → respond() → the agent continues
       4. TEXT_MESSAGE_CHUNK "Done — reply sent"       → status = "done"
```

"One run, two views": the closed card and the open modal are two renderings of a
single run. The status indicator is derived from CopilotKit's run state
(idle / working / awaiting approval / done); the full thread is visible in the
modal.

## 6. Card status model

The closed card shows one of these statuses, derived from the run lifecycle:

- `idle` — nothing happening (before START);
- `running` — work in progress (after START, during the stream; a loader);
- `awaiting_approval` — the `ApprovalDialog` is rendered, waiting for a click;
- `done` — the run is finished;
- `error` — an error (minimal, for completeness).

## 7. The fake agent (the key mechanic of approach B)

A CopilotKit server-side custom agent — an async generator that yields AG-UI
events without a model. The reference shape (per the CopilotKit v2 docs):

```ts
import { EventType, type BaseEvent } from "@ag-ui/client";
import {
  CopilotRuntime, createCopilotEndpoint,
  InMemoryAgentRunner, BuiltInAgent,
} from "@copilotkit/runtime/v2";

const agent = new BuiltInAgent({
  type: "custom",
  factory: async function* ({ input, abortSignal }) {
    // 1) text
    // 2) TOOL_CALL_START/ARGS/END → renderLead {lead data}
    // 3) TOOL_CALL_START/ARGS/END → confirmSend {approval text}
    // 4) "done" text (after resume)
  },
});

const runtime = new CopilotRuntime({
  agents: { default: agent },
  runner: new InMemoryAgentRunner(),
});

const endpoint = createCopilotEndpoint({ runtime, basePath: "/api/copilotkit" });
// endpoint (a fetch handler) is mounted into Hono
```

The tool-call names (`renderLead`, `confirmSend`) match the names of the
`useCopilotAction` actions on the client — that is how the agent "invokes" the
right component.

## 8. Generative UI and human-in-the-loop (client)

```ts
// renderLead → renders the lead card (generative UI)
useCopilotAction({
  name: "renderLead",
  render: ({ args }) => <LeadCard lead={args} />,
});

// confirmSend → pause, wait for the manager's answer (human-in-the-loop)
useCopilotAction({
  name: "confirmSend",
  renderAndWaitForResponse: ({ args, respond }) => (
    <ApprovalDialog data={args} onApprove={() => respond("approved")} />
  ),
});
```

The hardcoded lead (sample data) the agent sends:

```json
{ "id": 42, "from": "ivan@acme.ru", "subject": "Order: 10 units", "intent": "order" }
```

## 9. Definition of done (acceptance)

Success = clicking through the whole loop by hand:

1. Opened the dashboard → the "EMAIL AGENT" card is visible, status `idle`.
2. Clicked START → status `running`, the text "Checking inbox…" appears in the thread.
3. The lead card (`LeadCard`) appears with its data.
4. The approval dialog (`ApprovalDialog`) appears, status `awaiting_approval`.
5. Clicked "Send" → the agent appends "Done", status `done`.

We do not write automated tests for this draft. We keep the components clean and
free of unnecessary dependencies so they are easy to cover with tests in the next
steps.

## 10. Open questions / for later

- The exact way to mount `createCopilotEndpoint` into Hono — to be confirmed at the code stage.
- Exactly how to derive the card status from CopilotKit's run state (which hooks) —
  to be confirmed at the code stage.
- The CopilotKit/AG-UI package versions are pinned at install time.
- The git repository is not yet initialized; committing the spec is the user's decision.
