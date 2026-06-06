# Inbox Vertical Slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clickable dashboard with one agent card where pressing START runs a mock agent through the real CopilotKit + AG-UI loop: streams text → renders a lead card → pauses for human approval → resumes on click.

**Architecture:** Single app (no package split yet). A thin Hono server mounts a self-hosted CopilotKit Runtime (`/v2`) backed by a *mock custom agent* (an async generator that yields scripted AG-UI events, no real LLM). A Vite + React client connects via `<CopilotKit runtimeUrl>`, starts the run with the `useAgent` hook, derives card status from AG-UI lifecycle events, and renders generative UI / approval via `useCopilotAction`.

**Tech Stack:** TypeScript, Vite + React, Hono, `@copilotkit/runtime` (`/v2`), `@copilotkit/react-core`, `@ag-ui/client`. Plain CSS for the slice (Tailwind deferred to the real UI layer).

**Verification model:** This slice is verified by **manual click-through in the browser**, not automated tests (per spec §9 — its value is the live CopilotKit integration). The TDD + code-review feedback loop begins in the *next* phase, when we extract the reusable core (the `defineAgent` contract, message/registry layer).

**Deviations from spec:** Tailwind (spec §3) is deferred — plain CSS keeps the proving slice fast. Everything else matches `docs/superpowers/specs/2026-06-06-inbox-vertical-slice-design.md`.

---

## File Structure

```
CLAUDE.md                          # agent-first foundation (Task 0)
.claude/skills/rules/README.md     # grows organically (Task 0)
apps/inbox/
├── package.json                   # scripts: dev (client+server), server, client
├── tsconfig.json
├── vite.config.ts
├── index.html
├── client/src/
│   ├── main.tsx                   # React entry
│   ├── App.tsx                    # <CopilotKit> provider + desktop
│   ├── styles.css                 # plain CSS
│   ├── actions.tsx                # useCopilotAction: renderLead, confirmSend
│   └── components/
│       ├── AgentCard.tsx          # closed card: name, START, status indicator
│       ├── AgentModal.tsx         # open card: chat thread
│       ├── LeadCard.tsx           # generative-UI lead card
│       └── ApprovalDialog.tsx     # human-in-the-loop approval
└── server/
    ├── index.ts                   # Hono + CopilotRuntime endpoint
    └── mock-agent.ts              # BuiltInAgent custom factory (scripted events)
```

---

## Task 0: Agent-first lightweight foundation

**Files:**
- Create: `CLAUDE.md`
- Create: `.claude/skills/rules/README.md`

- [ ] **Step 1: Create `CLAUDE.md`**

```markdown
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

## Commands

(Filled in Task 1 once the app exists.)
```

- [ ] **Step 2: Create `.claude/skills/rules/README.md`**

```markdown
# Code-style rules (grows organically)

Empty by design. Add a rule file here the moment a real, repeated pattern
appears in the code — never invent conventions for code that doesn't exist
yet. Each rule should state: the rule, a wrong example, a correct example, why.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md .claude/skills/rules/README.md
git commit -m "chore: agent-first foundation (CLAUDE.md + rules placeholder)"
```

---

## Task 1: Scaffold app + connection spike (pins the CopilotKit v2 API)

**Goal of this task:** get ONE streamed text message from a mock agent showing in the browser. This pins the exact `/v2` import paths and hook names against the installed package versions before any UI is built on top.

**Files:**
- Create: `apps/inbox/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`
- Create: `apps/inbox/server/index.ts`, `apps/inbox/server/mock-agent.ts`
- Create: `apps/inbox/client/src/main.tsx`, `App.tsx`, `styles.css`

- [ ] **Step 1: Init app + install deps**

```bash
mkdir -p apps/inbox/server apps/inbox/client/src/components
cd apps/inbox
npm init -y
npm i hono @hono/node-server @copilotkit/runtime @copilotkit/react-core @ag-ui/client react react-dom
npm i -D typescript vite @vitejs/plugin-react @types/react @types/react-dom tsx concurrently
```

- [ ] **Step 2: Record exact installed versions + confirm v2 entry points**

Run:
```bash
node -e "for (const p of ['@copilotkit/runtime','@copilotkit/react-core','@ag-ui/client']) console.log(p, require(p+'/package.json').version)"
ls node_modules/@copilotkit/runtime/dist | grep -i v2 || echo "check runtime export map"
```
Expected: prints versions; confirms a `v2` entry exists for `@copilotkit/runtime`.
**Action:** note the confirmed import paths in `CLAUDE.md` under "Decisions". If `@copilotkit/runtime/v2` differs from the doc (e.g. named differently), use the actual export and adjust all later tasks accordingly.

- [ ] **Step 3: `apps/inbox/package.json` scripts**

```json
{
  "name": "inbox",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "concurrently -n server,client -c blue,green \"npm:dev:server\" \"npm:dev:client\"",
    "dev:server": "tsx watch server/index.ts",
    "dev:client": "vite",
    "build": "vite build"
  }
}
```

- [ ] **Step 4: `apps/inbox/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["client/src", "server"]
}
```

- [ ] **Step 5: `apps/inbox/vite.config.ts`** (proxy `/api` to the Hono server on :4000)

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: ".",
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:4000" },
  },
});
```

- [ ] **Step 6: `apps/inbox/index.html`**

```html
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Inbox</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/client/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: `apps/inbox/server/mock-agent.ts`** (spike version — one text message only)

```ts
import { EventType, type BaseEvent } from "@ag-ui/client";
import { BuiltInAgent } from "@copilotkit/runtime/v2";

export const mockAgent = new BuiltInAgent({
  type: "custom",
  factory: async function* ({ input }) {
    const messageId = crypto.randomUUID();
    yield {
      type: EventType.TEXT_MESSAGE_CHUNK,
      role: "assistant",
      messageId,
      delta: "Checking inbox…",
    } as BaseEvent;
  },
});
```

- [ ] **Step 8: `apps/inbox/server/index.ts`** (Hono mounts the runtime endpoint)

```ts
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { mockAgent } from "./mock-agent.js";

const runtime = new CopilotRuntime({
  agents: { default: mockAgent },
  runner: new InMemoryAgentRunner(),
});

const copilot = createCopilotEndpoint({ runtime, basePath: "/api/copilotkit" });

const app = new Hono();
// createCopilotEndpoint returns a fetch handler; mount it on the matching path.
app.all("/api/copilotkit/*", (c) => copilot(c.req.raw));
app.all("/api/copilotkit", (c) => copilot(c.req.raw));

serve({ fetch: app.fetch, port: 4000 });
console.log("server on http://localhost:4000");
```

**Note:** the exact way to invoke `copilot` (fetch handler vs Hono app vs `app.mount`) is the #1 thing to confirm in this spike. If `createCopilotEndpoint` returns a Hono-compatible app, prefer `app.route("/api/copilotkit", copilot)`. Record what works in `CLAUDE.md`.

- [ ] **Step 9: `apps/inbox/client/src/styles.css`** (minimal)

```css
body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; background: #f5f5f7; }
button { cursor: pointer; }
```

- [ ] **Step 10: `apps/inbox/client/src/App.tsx`** (spike — button + streamed text)

```tsx
import { CopilotKit, useAgent } from "@copilotkit/react-core";

function Spike() {
  const { messages, runAgent } = useAgent({ agent: "default" });
  return (
    <div>
      <button onClick={() => runAgent()}>START</button>
      <pre>{JSON.stringify(messages, null, 2)}</pre>
    </div>
  );
}

export default function App() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      <Spike />
    </CopilotKit>
  );
}
```

**Note:** `useAgent` method names (`runAgent`, `messages`) are pinned here. If the installed version differs (e.g. `useCoAgent`, `start()`, `agent.runAgent()`), use the actual API and record it in `CLAUDE.md` — later tasks depend on it.

- [ ] **Step 11: `apps/inbox/client/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>
);
```

- [ ] **Step 12: Run and verify the connection**

Run: `npm run dev`
Open: `http://localhost:5173`
Click START.
Expected: the streamed assistant message "Checking inbox…" appears in the `<pre>` dump. This confirms client → Hono → runtime → mock agent → stream → client works.
If it does not: fix import paths / endpoint mounting / hook names before proceeding. Do NOT continue until one message streams end-to-end.

- [ ] **Step 13: Commit**

```bash
git add apps/inbox CLAUDE.md
git commit -m "feat(inbox): scaffold app + verified CopilotKit v2 connection (spike)"
```

---

## Task 2: Full mock-agent script (text → lead → approval → resume)

The agent must be **stateful on input**: human-in-the-loop resumes as a new turn carrying the approval tool result. First turn emits text + lead + approval tool call; the resume turn (approval result present in `input.messages`) emits the final "done" text.

**Files:**
- Modify: `apps/inbox/server/mock-agent.ts`

- [ ] **Step 1: Replace `mock-agent.ts` factory with the full script**

```ts
import { EventType, type BaseEvent } from "@ag-ui/client";
import { BuiltInAgent } from "@copilotkit/runtime/v2";

const LEAD = { id: 42, from: "ivan@acme.ru", subject: "Order: 10 units", intent: "order" };

// Did a previous turn already resolve the confirmSend approval?
function approvalResolved(input: any): boolean {
  const msgs = input?.messages ?? [];
  return msgs.some(
    (m: any) =>
      m?.role === "tool" &&
      (m?.name === "confirmSend" || m?.toolName === "confirmSend")
  );
}

async function* toolCall(name: string, args: unknown): AsyncGenerator<BaseEvent> {
  const toolCallId = crypto.randomUUID();
  yield { type: EventType.TOOL_CALL_START, parentMessageId: crypto.randomUUID(), toolCallId, toolCallName: name } as BaseEvent;
  yield { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: JSON.stringify(args) } as BaseEvent;
  yield { type: EventType.TOOL_CALL_END, toolCallId } as BaseEvent;
}

export const mockAgent = new BuiltInAgent({
  type: "custom",
  factory: async function* ({ input }) {
    if (approvalResolved(input)) {
      yield {
        type: EventType.TEXT_MESSAGE_CHUNK, role: "assistant",
        messageId: crypto.randomUUID(), delta: "Done — reply sent.",
      } as BaseEvent;
      return;
    }

    yield {
      type: EventType.TEXT_MESSAGE_CHUNK, role: "assistant",
      messageId: crypto.randomUUID(), delta: "Checking inbox… found a lead.",
    } as BaseEvent;

    yield* toolCall("renderLead", LEAD);
    yield* toolCall("confirmSend", { leadId: LEAD.id, message: "Send a reply to this lead?" });
  },
});
```

- [ ] **Step 2: Verify the raw event stream**

Run: `npm run dev`, click START in the browser (still the spike UI).
Expected in the `<pre>` dump: the text message, then a `renderLead` tool call with the lead data, then a `confirmSend` tool call. (The approval won't render yet — no action registered. That's Task 4.)

- [ ] **Step 3: Commit**

```bash
git add apps/inbox/server/mock-agent.ts
git commit -m "feat(inbox): full mock-agent script (text, lead, approval, resume)"
```

---

## Task 3: LeadCard + renderLead generative UI

**Files:**
- Create: `apps/inbox/client/src/components/LeadCard.tsx`
- Create: `apps/inbox/client/src/actions.tsx`
- Modify: `apps/inbox/client/src/App.tsx`

- [ ] **Step 1: `components/LeadCard.tsx`**

```tsx
type Lead = { id: number; from: string; subject: string; intent: string };

export function LeadCard({ lead }: { lead: Lead }) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12, background: "#fff", margin: "8px 0" }}>
      <div style={{ fontSize: 12, color: "#888" }}>✉️ {lead.from}</div>
      <div style={{ fontWeight: 600 }}>{lead.subject}</div>
      <span style={{ fontSize: 12, color: "#0a7" }}>{lead.intent}</span>
    </div>
  );
}
```

- [ ] **Step 2: `actions.tsx`** — register the `renderLead` generative-UI action

```tsx
import { useCopilotAction } from "@copilotkit/react-core";
import { LeadCard } from "./components/LeadCard.js";
import { ApprovalDialog } from "./components/ApprovalDialog.js";

export function useInboxActions() {
  useCopilotAction({
    name: "renderLead",
    render: ({ args }: { args: any }) => <LeadCard lead={args} />,
  });

  useCopilotAction({
    name: "confirmSend",
    renderAndWaitForResponse: ({ args, respond }: { args: any; respond: (r: string) => void }) => (
      <ApprovalDialog data={args} onApprove={() => respond("approved")} />
    ),
  });
}
```

**Note:** `confirmSend` references `ApprovalDialog`, created in Task 4. Create a one-line stub now so this compiles: `apps/inbox/client/src/components/ApprovalDialog.tsx` → `export function ApprovalDialog(_: any) { return null; }`. Task 4 replaces it.

- [ ] **Step 3: Call `useInboxActions()` from App and confirm `useCopilotAction` arg shape**

Update `App.tsx` `Spike` to call `useInboxActions()` before returning. Confirm the `render`/`renderAndWaitForResponse` callback receives `{ args }` / `{ args, respond }` in the installed version; if it streams partial args differently, adjust and record in `CLAUDE.md`.

- [ ] **Step 4: Verify lead renders**

Run: `npm run dev`, click START.
Expected: the `LeadCard` with "Order: 10 units", "ivan@acme.ru", "order" renders in the chat output (instead of/in addition to the raw tool-call dump).

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/client/src/components/LeadCard.tsx apps/inbox/client/src/components/ApprovalDialog.tsx apps/inbox/client/src/actions.tsx apps/inbox/client/src/App.tsx
git commit -m "feat(inbox): LeadCard generative UI via renderLead action"
```

---

## Task 4: ApprovalDialog + human-in-the-loop resume

**Files:**
- Modify: `apps/inbox/client/src/components/ApprovalDialog.tsx`

- [ ] **Step 1: Replace the stub with the real `ApprovalDialog`**

```tsx
type ApprovalData = { leadId: number; message: string };

export function ApprovalDialog({ data, onApprove }: { data: ApprovalData; onApprove: () => void }) {
  return (
    <div style={{ border: "1px solid #f0c000", borderRadius: 10, padding: 12, background: "#fffbe6", margin: "8px 0" }}>
      <div style={{ marginBottom: 8 }}>{data.message}</div>
      <button onClick={onApprove} style={{ background: "#0a7", color: "#fff", border: 0, borderRadius: 6, padding: "6px 14px" }}>
        Send
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify the full pause → resume**

Run: `npm run dev`, click START.
Expected sequence in the browser:
1. text "Checking inbox… found a lead."
2. `LeadCard` renders.
3. `ApprovalDialog` renders with "Send a reply to this lead?" and a button.
4. Click "Send" → the run resumes → final text "Done — reply sent." appears.

If the resume turn does not fire (agent doesn't continue after `respond`): confirm how the approval result is fed back. The mock agent expects the resolved tool result to appear in `input.messages` on the next turn (see Task 2 `approvalResolved`). Adjust the detection to match the actual message shape CopilotKit sends back, and record it in `CLAUDE.md`.

- [ ] **Step 3: Commit**

```bash
git add apps/inbox/client/src/components/ApprovalDialog.tsx
git commit -m "feat(inbox): ApprovalDialog + human-in-the-loop resume"
```

---

## Task 5: AgentCard + AgentModal + status from lifecycle events

Wrap the verified loop in the real UX: a closed card (name, START, status indicator) that opens into a modal showing the thread. Status is derived from AG-UI lifecycle events via `agent.subscribe`.

**Files:**
- Create: `apps/inbox/client/src/components/AgentCard.tsx`
- Create: `apps/inbox/client/src/components/AgentModal.tsx`
- Modify: `apps/inbox/client/src/App.tsx`

- [ ] **Step 1: Status hook — derive status from the run lifecycle**

Add to `App.tsx` (or a small `useAgentStatus.ts`):

```tsx
import { useEffect, useState } from "react";

type Status = "idle" | "running" | "awaiting_approval" | "done" | "error";

// `agent` is the object returned by useAgent. Subscribe to AG-UI lifecycle.
export function useAgentStatus(agent: any): Status {
  const [status, setStatus] = useState<Status>("idle");
  useEffect(() => {
    if (!agent?.subscribe) return;
    const sub = agent.subscribe({
      onRunStartedEvent: () => setStatus("running"),
      onRunFinalized: () => setStatus("done"),
      onRunFailed: () => setStatus("error"),
    });
    return () => sub?.unsubscribe?.();
  }, [agent]);
  return status;
}
```

**Note:** exact subscriber event names (`onRunStartedEvent`, `onRunFinalized`, `onRunFailed`) are pinned here from the v2 docs — confirm against the installed `@ag-ui/client` and adjust if needed. `awaiting_approval` is set in Step 2 (when the approval action renders), since it's a UI state, not a lifecycle event.

- [ ] **Step 2: Set `awaiting_approval` from the approval action**

In `actions.tsx`, accept a status setter and call it when the approval renders/resolves:

```tsx
export function useInboxActions(onAwaitApproval: (waiting: boolean) => void) {
  useCopilotAction({ name: "renderLead", render: ({ args }: any) => <LeadCard lead={args} /> });
  useCopilotAction({
    name: "confirmSend",
    renderAndWaitForResponse: ({ args, respond }: any) => {
      onAwaitApproval(true);
      return <ApprovalDialog data={args} onApprove={() => { onAwaitApproval(false); respond("approved"); }} />;
    },
  });
}
```

- [ ] **Step 3: `components/AgentCard.tsx`** (closed card)

```tsx
type Status = "idle" | "running" | "awaiting_approval" | "done" | "error";

const LABEL: Record<Status, string> = {
  idle: "Idle", running: "Working…", awaiting_approval: "Awaiting approval",
  done: "Done", error: "Error",
};
const DOT: Record<Status, string> = {
  idle: "#bbb", running: "#0a7", awaiting_approval: "#f0c000", done: "#0a7", error: "#e33",
};

export function AgentCard({ name, status, onStart, onOpen }: {
  name: string; status: Status; onStart: () => void; onOpen: () => void;
}) {
  return (
    <div onClick={onOpen} style={{ width: 280, border: "1px solid #ddd", borderRadius: 12, padding: 16, background: "#fff", cursor: "pointer" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>{name}</strong>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#666" }}>
          <span style={{ width: 8, height: 8, borderRadius: 8, background: DOT[status] }} />
          {LABEL[status]}
        </span>
      </div>
      <button onClick={(e) => { e.stopPropagation(); onStart(); }} style={{ marginTop: 12, padding: "6px 16px", borderRadius: 6, border: 0, background: "#111", color: "#fff" }}>
        START
      </button>
    </div>
  );
}
```

- [ ] **Step 4: `components/AgentModal.tsx`** (open card — thread)

```tsx
export function AgentModal({ title, messages, onClose }: { title: string; messages: any[]; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", display: "grid", placeItems: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 480, maxHeight: "80vh", overflow: "auto", background: "#fff", borderRadius: 12, padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <strong>{title}</strong>
          <button onClick={onClose} style={{ border: 0, background: "transparent", fontSize: 18 }}>×</button>
        </div>
        <div style={{ marginTop: 12 }}>
          {messages.map((m, i) => (
            <div key={i}>
              {typeof m?.content === "string" ? <p>{m.content}</p> : null}
              {m?.generativeUI ?? m?.render ?? null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

**Note:** how rendered generative-UI/actions appear inside `messages` is version-specific. Confirm the message shape from Task 1's `<pre>` dump and map text vs rendered-component accordingly. If CopilotKit exposes a ready chat thread component (`@copilotkit/react-ui`), prefer rendering that inside the modal instead of hand-mapping.

- [ ] **Step 5: Rewire `App.tsx` to the real UX**

```tsx
import { useState } from "react";
import { CopilotKit, useAgent } from "@copilotkit/react-core";
import { AgentCard } from "./components/AgentCard.js";
import { AgentModal } from "./components/AgentModal.js";
import { useInboxActions } from "./actions.js";
import { useAgentStatus } from "./useAgentStatus.js";

function Desktop() {
  const agent = useAgent({ agent: "default" });
  const lifecycle = useAgentStatus(agent);
  const [awaiting, setAwaiting] = useState(false);
  const [open, setOpen] = useState(false);
  useInboxActions(setAwaiting);

  const status = awaiting ? "awaiting_approval" : lifecycle;

  return (
    <>
      <AgentCard name="EMAIL AGENT" status={status} onStart={() => agent.runAgent()} onOpen={() => setOpen(true)} />
      {open && <AgentModal title="EMAIL AGENT" messages={agent.messages ?? []} onClose={() => setOpen(false)} />}
    </>
  );
}

export default function App() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit"><Desktop /></CopilotKit>
  );
}
```

(Move `useAgentStatus` into its own `useAgentStatus.ts` per the import.)

- [ ] **Step 6: Verify the full UX loop**

Run: `npm run dev`, open `http://localhost:5173`.
Expected:
1. Card "EMAIL AGENT", status dot grey "Idle".
2. Click START → status "Working…".
3. Open the card → modal shows streamed text + LeadCard.
4. Approval appears → card status "Awaiting approval" (yellow).
5. Click "Send" → final text "Done" → status "Done".

- [ ] **Step 7: Commit**

```bash
git add apps/inbox/client/src
git commit -m "feat(inbox): AgentCard + AgentModal + status from lifecycle events"
```

---

## Task 6: Final manual verification against the spec

**Files:** none (verification + cleanup only)

- [ ] **Step 1: Run the spec §9 acceptance walk-through**

Run: `npm run dev`. Execute every step of spec §9 (idle → START → running → lead → approval → resume → done). All five states must be observable on the closed card and the thread visible in the modal.

- [ ] **Step 2: Update `CLAUDE.md` Commands section + confirmed API notes**

Fill the Commands table (`npm run dev`, ports) and the confirmed CopilotKit v2 import paths / hook names discovered during the spike.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record verified slice commands + CopilotKit v2 API notes"
```

---

## Next phase (out of scope for this plan)

Once the slice proves the loop works, extract the reusable core — the `defineAgent` contract (fields/editableBy/renders/approvals), the provider registry, the message/registry layer — and **at that point switch on the full feedback loop**: TDD per the test-driven-development skill and the structured code-review loop. That is the first code worth rigorous testing, per the agreed timing.
