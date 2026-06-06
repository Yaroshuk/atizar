# Design: reusable core layer (defineAgent + providers + message layer)

- **Date:** 2026-06-06
- **Status:** in review
- **Author:** Sergey + Claude

## 1. Context and goal

The vertical slice (`apps/inbox/`) proved the end-to-end loop on mocks:
card → modal → streamed text → `LeadCard` → human-in-the-loop `ApprovalDialog`
→ resume → "Done". The slice review flagged the first reusable, logic-heavy
pieces worth extracting under a full **TDD + code-review loop** (the slice itself
was verified by manual click-through; rigor starts here).

This spec extracts the framework's **reusable core** from the slice:

1. a typed **message layer** that unifies the `toolCallId↔toolMessage`
   correlation currently duplicated in three files,
2. a **provider registry** so the model/runtime is referenced by name and
   swappable, and
3. the **`defineAgent` contract** — one "agent passport" object that both server
   and client read, replacing today's hardcoded tool-name strings.

We build **bottom-up** in dependency order: message layer → provider registry →
`defineAgent` on top.

See `docs/ARCHITECTURE.md` §4 (`defineAgent`), §5 (providers), §6 (generative UI)
for the broader vision. This spec is the next concrete increment of that vision.

## 2. Scope

### In scope (we build)

- **Message layer** (`core/messages.ts`): reuse `@ag-ui/core` types in full;
  extract the duplicated correlation logic into pure, tested functions.
- **Provider registry** (`core/providers.ts` + `core/mock-provider.ts`): a
  `Provider` interface (`run(input) → AsyncIterable<BaseEvent>`), a registry with
  name-based lookup, and **one fake provider** that emits the existing scripted
  inbox events. This makes the "agent → resolves provider by name → provider
  yields the event stream" path real and testable.
- **`defineAgent` contract** (`core/defineAgent.ts` + `core/inbox.agent.ts`): a
  typed, Zod-validated "agent passport" threaded through **both** server and
  client, removing the hardcoded `"confirmSend"` / `"renderLead"` / `"LeadCard"`
  strings.

### Out of scope (deferred — unchanged from the slice)

- A real model / Mastra / a real agentic loop (the only provider is the fake one).
- Real integrations (Gmail, MCP).
- A database; config file/DB split; base⊕overrides layering.
- Auth, roles, RBAC, audit.
- The `@platform/*` package split — the core lives in `apps/inbox/core/` for now
  and migrates to a package later, once the contract shape settles and a second
  consumer exists.
- `defineAgent.fields` (configurable fields + auto-form + storage split): nothing
  consumes it this phase (no form, no DB), so it is **explicitly deferred**. It
  joins the contract when the form/DB arrive.
- Mode-2 visual/chat editor.

## 3. Module layout

Everything lands in `apps/inbox/core/`, imported by **both** `client/` and
`server/`. Hard constraint: `core/` contains **no React** and **no server-only
code** (`BuiltInAgent` from `@copilotkit/runtime/v2`). Only types, pure
functions, `@ag-ui`, and `zod`.

```
apps/inbox/core/
  messages.ts       — @ag-ui types re-exported + shared pure functions  (layer 1)
  providers.ts      — Provider interface + registry + lookup             (layer 2)
  mock-provider.ts  — the fake "tape recorder" inbox provider            (layer 2)
  defineAgent.ts    — the agent passport: type + Zod validation          (layer 3)
  inbox.agent.ts    — concrete instance: inbox agent passport + registry (layer 3)
```

- **Server-only glue** stays in `server/`: a thin adapter that builds a
  `BuiltInAgent` whose factory delegates to the resolved provider's `run()`.
- **Client-only glue** stays in `client/`: a registry mapping component *names*
  (`"LeadCard"`, `"ApprovalDialog"`) to real React components.

Both halves import the shared contract and data from `core/`.

## 4. Layer 1 — message layer (`core/messages.ts`)

We use `@ag-ui/core` types **in full** — no parallel domain model. AG-UI is the
agent↔UI wire protocol we have committed to (`ARCHITECTURE.md` §8); messages
crossing that boundary *are* AG-UI messages by definition. The swappable seam is
the provider/runtime, not the message shape. Defining our own message types would
mean writing adapters in both directions for a format we cannot diverge from —
pure overhead.

What we add is **behavior**, not structure: the domain logic about *our* approval
protocol, extracted once instead of copied three times. Approval tool names are
passed as a **parameter** (sourced from `def.approvals` at the top layer), never
hardcoded.

Reused types (from `@ag-ui/core`): `Message`, `AssistantMessage`, `ToolMessage`,
`ToolCall`. Confirmed shapes:

- `AssistantMessage` = `{ role:"assistant", id, content?, toolCalls?: ToolCall[] }`
- `ToolMessage` = `{ role:"tool", id, content, toolCallId, error? }` — note:
  AG-UI's schema **strips** `name`/`toolName`, so correlation MUST be by
  `toolCallId` (never by name).
- `ToolCall` = `{ id, type:"function", function:{ name, arguments } }`
- `Message` is a discriminated union on `role`, so `m.role === "assistant"`
  narrows to `AssistantMessage` and `m.role === "tool"` narrows to `ToolMessage`.

Exported functions:

- `hasPendingApproval(messages, approvalNames): boolean` — true when an assistant
  tool call whose name ∈ `approvalNames` has **no** matching `role:"tool"` result.
  (Extracted from `client/src/useAgentStatus.ts`.)
- `approvalResolved(messages, approvalNames): boolean` — true when some
  `role:"tool"` message answers an approval tool call (the resume detection;
  extracted from `server/mock-agent.ts`). The same correlation viewed from the
  other end.
- `pairToolResults(messages): Map<string, ToolMessage>` — index tool results by
  `toolCallId` so each assistant tool call pairs with its result. (Extracted from
  `components/AgentModal.tsx`.)
- Type guards: `isAssistant(m)`, `isToolMessage(m)`, `toolCallsOf(m)`.

## 5. Layer 2 — provider registry (`core/providers.ts` + `core/mock-provider.ts`)

Models are not hardcoded in the agent; a registry defines providers and the agent
references one by name. CLI vs API are different execution models normalized
behind one interface (`ARCHITECTURE.md` §5). The real model is deferred, so this
phase ships the interface, the registry, and **one fake provider**.

- `Provider` — interface: `run(input: RunAgentInput) => AsyncIterable<BaseEvent>`.
  This is the seam a real CLI/API provider will implement later.
- `defineProviders(map)` → a registry object with `resolve(name): Provider`.
  `resolve` throws on an unknown name (typed, tested).
- `mockInboxProvider` — the fake provider whose `run()` yields the existing
  scripted sequence: turn 1 = text → `renderLead` tool call → `confirmSend` tool
  call; resume = "Done — reply sent." It branches on
  `approvalResolved(input.messages, approvalNames)` from layer 1. This is the
  stand-in for "the model's output."

This makes the full path real: **agent → resolve provider by name → provider
yields the AG-UI event stream**, with only the model faked.

## 6. Layer 3 — `defineAgent` contract (`core/defineAgent.ts` + `core/inbox.agent.ts`)

A single object describes the agent; server behavior and client rendering both
*derive* from it. Pure data, Zod-validated, **no React**.

```ts
defineAgent({
  id, name,
  provider: "mock",                 // reference into the provider registry (§5)
  instructions,                     // base prompt (threaded to the provider)
  tools: ["renderLead", "confirmSend"],
  approvals: ["confirmSend"],       // which tool calls pause for human-in-the-loop
  renders: { renderLead: "LeadCard", confirmSend: "ApprovalDialog" },
})
```

- `renders` is keyed **by tool name** (a deliberate refinement of
  `ARCHITECTURE.md` §4's abstract key→component map): keying by tool name lets it
  drive client registration directly.
- `fields` is **omitted** this phase (see §2 — deferred).
- Zod validation rejects: a `provider` not present in the registry; an `approvals`
  entry not also in `tools`; a `renders` key not also in `tools`.

`inbox.agent.ts` exports the concrete inbox agent passport plus the provider
registry instance (mapping `"mock"` → `mockInboxProvider`).

## 7. Threading the passport through (removing the hardcode)

The point of the contract is that something *consumes* it. Both sides do:

**Server** (`server/`):
- A thin adapter resolves `def.provider` against the registry and builds the
  `BuiltInAgent`, whose factory delegates to `provider.run(input)`.
- The resume/turn-1 branch uses `approvalResolved(messages, def.approvals)` —
  the hardcoded `"confirmSend"` disappears.

**Client** (`client/`):
- A name→component registry maps `def.renders` values (`"LeadCard"`,
  `"ApprovalDialog"`) to real React components.
- `useInboxActions` registers `useRenderTool` / `useHumanInTheLoop` by iterating
  `def.renders`; `def.approvals` decides which entry is human-in-the-loop.
- `useAgentStatus` calls `hasPendingApproval(messages, def.approvals)`.
- `AgentModal` uses `pairToolResults` + the registered renderers; the card name is
  `def.name`.

## 8. Data flow (unchanged behavior, now contract-driven)

1. START → `copilotkit.runAgent({ agent })`. Server factory calls
   `provider.run(input)`.
2. `approvalResolved(input.messages, def.approvals)` is false (turn 1) → provider
   streams text → `renderLead` → `confirmSend`.
3. Client renders `LeadCard` (via `renders`) and pauses at `ApprovalDialog` (via
   `approvals`). The closed card shows "Awaiting approval" derived from
   `hasPendingApproval(agent.messages, def.approvals)` — render-independent, as in
   the slice.
4. Approve → `respond("approved")` → a `role:"tool"` message is spliced in →
   follow-up run.
5. `approvalResolved(input.messages, def.approvals)` is now true (resume) →
   provider emits "Done — reply sent." → run finalizes.

## 9. Testing (TDD)

The core is pure logic, so it is unit-tested directly; the slice's end-to-end
behavior is re-verified by the existing manual click-through (no regression).

- **`messages.ts`** — synthetic `Message[]` fixtures:
  - `hasPendingApproval`: no tool calls; an unanswered approval; an answered
    approval; multiple approvals (some answered); a non-approval tool call ignored.
  - `approvalResolved`: mirror cases.
  - `pairToolResults`: pairs by `toolCallId`; orphan tool call → no entry.
  - guards narrow correctly.
- **`providers.ts` / `mock-provider.ts`** — `resolve` returns the provider;
  unknown name throws; `mockInboxProvider.run` yields the expected event sequence
  for both turn 1 and resume (assert on event types and tool names).
- **`defineAgent.ts`** — Zod: a valid passport passes; invalid ones (provider not
  in registry, approval not in tools, render key not in tools) are rejected.
- **Regression** — manual browser click-through of the inbox slice still works
  end-to-end.

## 10. Risks / open questions

- **Which real provider to wire first** (CLI vs API) is still open — out of scope
  here, but the `Provider` interface is the seam that decision will fill.
- **`renders` keyed by tool name** diverges slightly from `ARCHITECTURE.md` §4;
  the architecture doc should be updated to match once this lands.
- **Client bundle** importing `core/` must not pull server-only or React code;
  the layout in §3 enforces this, and `npm run build` / `typecheck` will catch
  violations.
