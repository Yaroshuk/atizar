# Reusable Core Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the framework's reusable core from the inbox slice — a typed message layer, a provider registry with one fake provider, and a `defineAgent` contract threaded through both server and client — removing the hardcoded tool-name strings.

**Architecture:** Build bottom-up in `apps/inbox/core/` (imported by both `client/` and `server/`; **no React, no server-only code** inside `core/`). Layer 1 = pure message helpers over `@ag-ui` types. Layer 2 = `Provider` interface + registry + a mock provider that emits the existing scripted events. Layer 3 = a Zod-validated agent "passport" that the server adapter and client glue both read.

**Tech Stack:** TypeScript, Vitest (happy-dom), Zod 3.25.x, `@ag-ui/client` (re-exports `@ag-ui/core`), CopilotKit v2 (`@copilotkit/runtime/v2`, `@copilotkit/react-core/v2`).

**Spec:** `docs/superpowers/specs/2026-06-06-core-layer-design.md`

**Key conventions (read before starting):**
- All run commands are from `apps/inbox/`.
- Import AG-UI types from `@ag-ui/client` (matches the slice). It re-exports `Message`, `ToolCall`, `RunAgentInput`, `BaseEvent`, `EventType` — but **not** `AssistantMessage`/`ToolMessage` by name, so derive those via `Extract<Message, { role: "..." }>`.
- Correlate tool calls and results by `toolCallId` only — AG-UI's `ToolMessageSchema` strips the tool name.
- Relative imports inside `core/` use the `.js` extension (ESNext + `moduleResolution: "bundler"`; the slice already writes `./mock-agent.js`).
- Commit after every task.

---

## File Structure

Created in this plan:
- `apps/inbox/core/messages.ts` — AG-UI types re-exported + pure correlation functions (layer 1).
- `apps/inbox/core/messages.test.ts` — unit tests for layer 1.
- `apps/inbox/core/providers.ts` — `Provider` interface, `defineProviders`, registry `resolve` (layer 2).
- `apps/inbox/core/providers.test.ts` — unit tests for the registry.
- `apps/inbox/core/mock-provider.ts` — the fake inbox provider (layer 2).
- `apps/inbox/core/mock-provider.test.ts` — unit tests for the mock provider's event stream.
- `apps/inbox/core/defineAgent.ts` — `defineAgent` + `AgentDefinitionSchema` + types (layer 3).
- `apps/inbox/core/defineAgent.test.ts` — unit tests for validation.
- `apps/inbox/core/inbox.agent.ts` — the concrete inbox passport + provider registry instance (layer 3).
- `apps/inbox/core/inbox.agent.test.ts` — sanity tests for the concrete wiring.
- `apps/inbox/server/build-agent.ts` — server-only adapter: `def` + registry → `BuiltInAgent`.
- `apps/inbox/client/src/renderRegistry.tsx` — client-only name→component map.

Modified:
- `apps/inbox/vitest.config.ts` — widen `include` to cover `core/`.
- `apps/inbox/tsconfig.json` — add `core` to `include`.
- `apps/inbox/package.json` — add `zod` as an explicit dependency.
- `apps/inbox/server/index.ts` — build the agent via `build-agent.ts`.
- `apps/inbox/server/mock-agent.ts` — **deleted** (logic moves to `core/` + `build-agent.ts`).
- `apps/inbox/client/src/actions.tsx` — drive registrations from the agent definition.
- `apps/inbox/client/src/useAgentStatus.ts` — use `core` `hasPendingApproval` + `def.approvals`.
- `apps/inbox/client/src/components/AgentModal.tsx` — use `core` `pairToolResults`; type `Message`.
- `apps/inbox/client/src/App.tsx` — pass `def.name` / `def.approvals` down.

---

## Task 1: Test harness config + message types & guards

**Files:**
- Modify: `apps/inbox/vitest.config.ts`
- Modify: `apps/inbox/tsconfig.json`
- Create: `apps/inbox/core/messages.ts`
- Test: `apps/inbox/core/messages.test.ts`

- [ ] **Step 1: Widen Vitest `include` to cover `core/`**

In `apps/inbox/vitest.config.ts`, change the `include` line:

```ts
    include: ["client/src/**/*.test.{ts,tsx}", "core/**/*.test.ts"],
```

- [ ] **Step 2: Add `core` to the TypeScript project**

In `apps/inbox/tsconfig.json`, change the `include` array:

```json
  "include": ["client/src", "server", "core"]
```

- [ ] **Step 3: Write the failing test for types & guards**

Create `apps/inbox/core/messages.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  isAssistant,
  isToolMessage,
  toolCallsOf,
  type Message,
} from "./messages.js";

// Fixture builders — minimal valid AG-UI messages.
function assistantWithToolCall(name: string, id = "tc1"): Message {
  return {
    role: "assistant",
    id: "a1",
    toolCalls: [{ id, type: "function", function: { name, arguments: "{}" } }],
  };
}
function assistantText(content: string): Message {
  return { role: "assistant", id: "a1", content };
}
function toolResult(toolCallId: string): Message {
  return { role: "tool", id: "t1", content: "ok", toolCallId };
}

describe("guards", () => {
  it("isAssistant narrows assistant messages", () => {
    expect(isAssistant(assistantText("hi"))).toBe(true);
    expect(isAssistant(toolResult("tc1"))).toBe(false);
  });

  it("isToolMessage narrows tool messages", () => {
    expect(isToolMessage(toolResult("tc1"))).toBe(true);
    expect(isToolMessage(assistantText("hi"))).toBe(false);
  });

  it("toolCallsOf returns the tool calls of an assistant message, else []", () => {
    expect(toolCallsOf(assistantWithToolCall("confirmSend"))).toHaveLength(1);
    expect(toolCallsOf(assistantText("hi"))).toEqual([]);
    expect(toolCallsOf(toolResult("tc1"))).toEqual([]);
  });
});

export { assistantWithToolCall, assistantText, toolResult };
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- core/messages.test.ts`
Expected: FAIL — cannot resolve `./messages.js` (module does not exist yet).

- [ ] **Step 5: Implement types & guards**

Create `apps/inbox/core/messages.ts`:

```ts
import type { Message, ToolCall } from "@ag-ui/client";

// AG-UI is the agent↔UI wire protocol; we reuse its types in full and add only
// behavior. `@ag-ui/client` re-exports `Message`/`ToolCall` but not the per-role
// message types, so derive them by narrowing the discriminated union.
export type { Message, ToolCall };
export type AssistantMessage = Extract<Message, { role: "assistant" }>;
export type ToolMessage = Extract<Message, { role: "tool" }>;

export function isAssistant(m: Message): m is AssistantMessage {
  return m.role === "assistant";
}

export function isToolMessage(m: Message): m is ToolMessage {
  return m.role === "tool";
}

export function toolCallsOf(m: Message): ToolCall[] {
  return isAssistant(m) && Array.isArray(m.toolCalls) ? m.toolCalls : [];
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- core/messages.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/inbox/vitest.config.ts apps/inbox/tsconfig.json apps/inbox/core/messages.ts apps/inbox/core/messages.test.ts
git commit -m "feat(core): message-layer types and guards over @ag-ui"
```

---

## Task 2: `hasPendingApproval`

**Files:**
- Modify: `apps/inbox/core/messages.ts`
- Test: `apps/inbox/core/messages.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/inbox/core/messages.test.ts` (add `hasPendingApproval` to the import from `./messages.js`):

```ts
import { hasPendingApproval } from "./messages.js";

describe("hasPendingApproval", () => {
  const APPROVALS = ["confirmSend"];

  it("false when there are no tool calls", () => {
    expect(hasPendingApproval([assistantText("hi")], APPROVALS)).toBe(false);
  });

  it("true when an approval tool call has no matching tool result", () => {
    const msgs = [assistantWithToolCall("confirmSend", "x1")];
    expect(hasPendingApproval(msgs, APPROVALS)).toBe(true);
  });

  it("false when the approval tool call has been answered", () => {
    const msgs = [assistantWithToolCall("confirmSend", "x1"), toolResult("x1")];
    expect(hasPendingApproval(msgs, APPROVALS)).toBe(false);
  });

  it("ignores non-approval tool calls", () => {
    const msgs = [assistantWithToolCall("renderLead", "x1")];
    expect(hasPendingApproval(msgs, APPROVALS)).toBe(false);
  });

  it("true when one of several approvals is unanswered", () => {
    const msgs = [
      assistantWithToolCall("confirmSend", "x1"),
      toolResult("x1"),
      assistantWithToolCall("confirmDelete", "x2"),
    ];
    expect(hasPendingApproval(msgs, ["confirmSend", "confirmDelete"])).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- core/messages.test.ts`
Expected: FAIL — `hasPendingApproval` is not exported.

- [ ] **Step 3: Implement `hasPendingApproval`**

Append to `apps/inbox/core/messages.ts`:

```ts
// Render-independent detection of a pending human-in-the-loop approval: an
// approval tool call exists whose toolCallId has no matching role:"tool" result.
// Approval names are passed in (from `def.approvals`), never hardcoded.
export function hasPendingApproval(
  messages: readonly Message[],
  approvalNames: readonly string[],
): boolean {
  const answered = new Set<string>();
  for (const m of messages) {
    if (isToolMessage(m) && typeof m.toolCallId === "string") {
      answered.add(m.toolCallId);
    }
  }
  for (const m of messages) {
    for (const tc of toolCallsOf(m)) {
      if (
        approvalNames.includes(tc.function.name) &&
        typeof tc.id === "string" &&
        !answered.has(tc.id)
      ) {
        return true;
      }
    }
  }
  return false;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- core/messages.test.ts`
Expected: PASS (all message tests, including the 5 new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/core/messages.ts apps/inbox/core/messages.test.ts
git commit -m "feat(core): hasPendingApproval over message state"
```

---

## Task 3: `approvalResolved`

**Files:**
- Modify: `apps/inbox/core/messages.ts`
- Test: `apps/inbox/core/messages.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/inbox/core/messages.test.ts` (add `approvalResolved` to the `./messages.js` import):

```ts
import { approvalResolved } from "./messages.js";

describe("approvalResolved", () => {
  const APPROVALS = ["confirmSend"];

  it("false on turn 1 (approval requested, not answered)", () => {
    const msgs = [assistantWithToolCall("confirmSend", "x1")];
    expect(approvalResolved(msgs, APPROVALS)).toBe(false);
  });

  it("true on resume (a tool result answers the approval call)", () => {
    const msgs = [assistantWithToolCall("confirmSend", "x1"), toolResult("x1")];
    expect(approvalResolved(msgs, APPROVALS)).toBe(true);
  });

  it("false when a tool result answers a non-approval call", () => {
    const msgs = [assistantWithToolCall("renderLead", "x1"), toolResult("x1")];
    expect(approvalResolved(msgs, APPROVALS)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- core/messages.test.ts`
Expected: FAIL — `approvalResolved` is not exported.

- [ ] **Step 3: Implement `approvalResolved`**

Append to `apps/inbox/core/messages.ts`:

```ts
// The resume-detection counterpart of hasPendingApproval, viewed from the other
// end: true when some role:"tool" message answers an approval tool call. Used by
// the (server-side) provider to decide turn-1 vs resume. Correlates by
// toolCallId because AG-UI strips the tool name from tool result messages.
export function approvalResolved(
  messages: readonly Message[],
  approvalNames: readonly string[],
): boolean {
  const approvalCallIds = new Set<string>();
  for (const m of messages) {
    for (const tc of toolCallsOf(m)) {
      if (approvalNames.includes(tc.function.name) && tc.id) {
        approvalCallIds.add(tc.id);
      }
    }
  }
  return messages.some(
    (m) =>
      isToolMessage(m) &&
      typeof m.toolCallId === "string" &&
      approvalCallIds.has(m.toolCallId),
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- core/messages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/core/messages.ts apps/inbox/core/messages.test.ts
git commit -m "feat(core): approvalResolved resume detection"
```

---

## Task 4: `pairToolResults`

**Files:**
- Modify: `apps/inbox/core/messages.ts`
- Test: `apps/inbox/core/messages.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/inbox/core/messages.test.ts` (add `pairToolResults` to the `./messages.js` import):

```ts
import { pairToolResults } from "./messages.js";

describe("pairToolResults", () => {
  it("indexes tool results by toolCallId", () => {
    const msgs = [
      assistantWithToolCall("confirmSend", "x1"),
      toolResult("x1"),
    ];
    const map = pairToolResults(msgs);
    expect(map.get("x1")?.role).toBe("tool");
    expect(map.size).toBe(1);
  });

  it("has no entry for an unanswered tool call", () => {
    const map = pairToolResults([assistantWithToolCall("confirmSend", "x1")]);
    expect(map.get("x1")).toBeUndefined();
    expect(map.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- core/messages.test.ts`
Expected: FAIL — `pairToolResults` is not exported.

- [ ] **Step 3: Implement `pairToolResults`**

Append to `apps/inbox/core/messages.ts`:

```ts
// Index tool result messages by toolCallId so each assistant tool call can be
// paired with its matching role:"tool" result (used by the modal thread render).
export function pairToolResults(
  messages: readonly Message[],
): Map<string, ToolMessage> {
  const byCallId = new Map<string, ToolMessage>();
  for (const m of messages) {
    if (isToolMessage(m) && typeof m.toolCallId === "string") {
      byCallId.set(m.toolCallId, m);
    }
  }
  return byCallId;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- core/messages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/core/messages.ts apps/inbox/core/messages.test.ts
git commit -m "feat(core): pairToolResults toolCallId index"
```

---

## Task 5: Provider interface + registry

**Files:**
- Create: `apps/inbox/core/providers.ts`
- Test: `apps/inbox/core/providers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/inbox/core/providers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { defineProviders, type Provider } from "./providers.js";

const stub: Provider = {
  // eslint-disable-next-line require-yield
  async *run() {
    return;
  },
};

describe("defineProviders", () => {
  it("resolves a provider by name", () => {
    const registry = defineProviders({ mock: stub });
    expect(registry.resolve("mock")).toBe(stub);
  });

  it("throws on an unknown provider name", () => {
    const registry = defineProviders({ mock: stub });
    expect(() => registry.resolve("nope")).toThrow(/unknown provider/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- core/providers.test.ts`
Expected: FAIL — cannot resolve `./providers.js`.

- [ ] **Step 3: Implement the interface and registry**

Create `apps/inbox/core/providers.ts`:

```ts
import type { RunAgentInput, BaseEvent } from "@ag-ui/client";

// A provider is the model/runtime seam: given the run input it yields a stream of
// AG-UI events. CLI and API providers will implement this later; for now there is
// one fake provider (see mock-provider.ts).
export interface Provider {
  run(input: RunAgentInput): AsyncIterable<BaseEvent>;
}

export interface ProviderRegistry {
  resolve(name: string): Provider;
}

// Providers are defined once; agents reference one by name. resolve throws on an
// unknown name so a bad `provider` reference fails loudly at wiring time.
export function defineProviders(
  map: Record<string, Provider>,
): ProviderRegistry {
  return {
    resolve(name: string): Provider {
      const provider = map[name];
      if (!provider) throw new Error(`Unknown provider: ${name}`);
      return provider;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- core/providers.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/core/providers.ts apps/inbox/core/providers.test.ts
git commit -m "feat(core): Provider interface and name-based registry"
```

---

## Task 6: Mock inbox provider

**Files:**
- Create: `apps/inbox/core/mock-provider.ts`
- Test: `apps/inbox/core/mock-provider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/inbox/core/mock-provider.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/client";
import { createMockInboxProvider } from "./mock-provider.js";

async function collect(stream: AsyncIterable<BaseEvent>): Promise<BaseEvent[]> {
  const out: BaseEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

// Minimal RunAgentInput; only `messages` matters to the mock.
function input(messages: unknown[]): RunAgentInput {
  return { messages } as unknown as RunAgentInput;
}

describe("mockInboxProvider", () => {
  const provider = createMockInboxProvider(["confirmSend"]);

  it("turn 1: streams text, renderLead, then confirmSend", async () => {
    const events = await collect(provider.run(input([])));
    const types = events.map((e) => e.type);
    expect(types).toContain(EventType.TEXT_MESSAGE_CHUNK);
    const toolNames = events
      .filter((e) => e.type === EventType.TOOL_CALL_START)
      .map((e) => (e as { toolCallName: string }).toolCallName);
    expect(toolNames).toEqual(["renderLead", "confirmSend"]);
  });

  it("resume: emits only the done text once the approval is answered", async () => {
    const resumed = [
      {
        role: "assistant",
        id: "a1",
        toolCalls: [
          { id: "x1", type: "function", function: { name: "confirmSend", arguments: "{}" } },
        ],
      },
      { role: "tool", id: "t1", content: "approved", toolCallId: "x1" },
    ];
    const events = await collect(provider.run(input(resumed)));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(EventType.TEXT_MESSAGE_CHUNK);
    expect((events[0] as { delta: string }).delta).toMatch(/done/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- core/mock-provider.test.ts`
Expected: FAIL — cannot resolve `./mock-provider.js`.

- [ ] **Step 3: Implement the mock provider**

Create `apps/inbox/core/mock-provider.ts` (the scripted-event logic moved out of `server/mock-agent.ts`, now behind the `Provider` interface):

```ts
import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/client";
import type { Provider } from "./providers.js";
import { approvalResolved, type Message } from "./messages.js";

const LEAD = { id: 42, from: "ivan@acme.ru", subject: "Order: 10 units", intent: "order" };

function textChunk(delta: string): BaseEvent {
  return {
    type: EventType.TEXT_MESSAGE_CHUNK,
    role: "assistant",
    messageId: crypto.randomUUID(),
    delta,
  } as BaseEvent;
}

async function* toolCall(name: string, args: unknown): AsyncGenerator<BaseEvent> {
  const toolCallId = crypto.randomUUID();
  yield {
    type: EventType.TOOL_CALL_START,
    parentMessageId: crypto.randomUUID(),
    toolCallId,
    toolCallName: name,
  } as BaseEvent;
  yield {
    type: EventType.TOOL_CALL_ARGS,
    toolCallId,
    delta: JSON.stringify(args),
  } as BaseEvent;
  yield { type: EventType.TOOL_CALL_END, toolCallId } as BaseEvent;
}

// The fake "model": on turn 1 it streams text → a renderLead tool call → a
// confirmSend approval; on resume (the approval has been answered) it emits the
// done text. `approvalNames` comes from the agent definition, not a hardcode.
export function createMockInboxProvider(approvalNames: readonly string[]): Provider {
  return {
    async *run(runInput: RunAgentInput): AsyncIterable<BaseEvent> {
      const messages = (runInput?.messages ?? []) as Message[];

      if (approvalResolved(messages, approvalNames)) {
        yield textChunk("Done — reply sent.");
        return;
      }

      yield textChunk("Checking inbox… found a lead.");
      yield* toolCall("renderLead", LEAD);
      yield* toolCall("confirmSend", { leadId: LEAD.id, message: "Send a reply to this lead?" });
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- core/mock-provider.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/core/mock-provider.ts apps/inbox/core/mock-provider.test.ts
git commit -m "feat(core): mock inbox provider behind Provider interface"
```

---

## Task 7: `defineAgent` contract + Zod validation

**Files:**
- Modify: `apps/inbox/package.json` (add `zod`)
- Create: `apps/inbox/core/defineAgent.ts`
- Test: `apps/inbox/core/defineAgent.test.ts`

> **Note (clarifies spec §6):** `defineAgent` validates *structure* only —
> `approvals ⊆ tools` and `renders` keys `⊆ tools`. The "provider exists" check
> is **not** here (a passport doesn't know the registry); it is enforced by
> `registry.resolve(def.provider)` at wiring time (Task 5 / Task 9).

- [ ] **Step 1: Add `zod` as an explicit dependency**

Run: `npm install zod@3.25.76`
Expected: `zod` appears under `dependencies` in `apps/inbox/package.json`.

- [ ] **Step 2: Write the failing test**

Create `apps/inbox/core/defineAgent.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { defineAgent } from "./defineAgent.js";

const valid = {
  id: "inbox",
  name: "EMAIL AGENT",
  provider: "mock",
  instructions: "Process inbound leads.",
  tools: ["renderLead", "confirmSend"],
  approvals: ["confirmSend"],
  renders: { renderLead: "LeadCard", confirmSend: "ApprovalDialog" },
};

describe("defineAgent", () => {
  it("returns the parsed definition for a valid passport", () => {
    const def = defineAgent(valid);
    expect(def.name).toBe("EMAIL AGENT");
    expect(def.approvals).toEqual(["confirmSend"]);
  });

  it("rejects an approval that is not in tools", () => {
    expect(() => defineAgent({ ...valid, approvals: ["sendNow"] })).toThrow();
  });

  it("rejects a render key that is not in tools", () => {
    expect(() =>
      defineAgent({ ...valid, renders: { ghostTool: "LeadCard" } }),
    ).toThrow();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- core/defineAgent.test.ts`
Expected: FAIL — cannot resolve `./defineAgent.js`.

- [ ] **Step 4: Implement `defineAgent`**

Create `apps/inbox/core/defineAgent.ts`:

```ts
import { z } from "zod";

// One object describes an agent; the server adapter and client glue both derive
// from it. Pure data — no React, no runtime code. `fields` is intentionally
// omitted this phase (no form/DB consumer yet).
export const AgentDefinitionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    provider: z.string(),
    instructions: z.string(),
    tools: z.array(z.string()),
    approvals: z.array(z.string()),
    renders: z.record(z.string()),
  })
  .superRefine((def, ctx) => {
    for (const name of def.approvals) {
      if (!def.tools.includes(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `approval "${name}" is not declared in tools`,
        });
      }
    }
    for (const key of Object.keys(def.renders)) {
      if (!def.tools.includes(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `render key "${key}" is not declared in tools`,
        });
      }
    }
  });

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

export function defineAgent(def: AgentDefinition): AgentDefinition {
  return AgentDefinitionSchema.parse(def);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- core/defineAgent.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/inbox/package.json apps/inbox/package-lock.json apps/inbox/core/defineAgent.ts apps/inbox/core/defineAgent.test.ts
git commit -m "feat(core): defineAgent contract with Zod structural validation"
```

---

## Task 8: Concrete inbox passport + provider registry instance

**Files:**
- Create: `apps/inbox/core/inbox.agent.ts`
- Test: `apps/inbox/core/inbox.agent.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/inbox/core/inbox.agent.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { inboxAgent, providerRegistry } from "./inbox.agent.js";

describe("inbox.agent wiring", () => {
  it("the passport validates and references the mock provider", () => {
    expect(inboxAgent.id).toBe("inbox");
    expect(inboxAgent.provider).toBe("mock");
    expect(inboxAgent.approvals).toEqual(["confirmSend"]);
  });

  it("the registry resolves the agent's provider", () => {
    const provider = providerRegistry.resolve(inboxAgent.provider);
    expect(typeof provider.run).toBe("function");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- core/inbox.agent.test.ts`
Expected: FAIL — cannot resolve `./inbox.agent.js`.

- [ ] **Step 3: Implement the concrete wiring**

Create `apps/inbox/core/inbox.agent.ts`:

```ts
import { defineAgent } from "./defineAgent.js";
import { defineProviders } from "./providers.js";
import { createMockInboxProvider } from "./mock-provider.js";

// The inbox agent passport — the single source of truth read by both the server
// adapter and the client glue.
export const inboxAgent = defineAgent({
  id: "inbox",
  name: "EMAIL AGENT",
  provider: "mock",
  instructions: "Check the inbox, surface a lead, and ask before replying.",
  tools: ["renderLead", "confirmSend"],
  approvals: ["confirmSend"],
  renders: { renderLead: "LeadCard", confirmSend: "ApprovalDialog" },
});

// Providers defined once; the agent references one by name. The mock reads the
// agent's approval names so its resume detection stays contract-driven.
export const providerRegistry = defineProviders({
  mock: createMockInboxProvider(inboxAgent.approvals),
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- core/inbox.agent.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/core/inbox.agent.ts apps/inbox/core/inbox.agent.test.ts
git commit -m "feat(core): concrete inbox passport and provider registry"
```

---

## Task 9: Server adapter — build the agent from the passport

**Files:**
- Create: `apps/inbox/server/build-agent.ts`
- Modify: `apps/inbox/server/index.ts`
- Delete: `apps/inbox/server/mock-agent.ts`

> This task wires real CopilotKit runtime, so it is verified by `typecheck` + the
> manual browser click-through, not a unit test (the slice was verified the same
> way).

- [ ] **Step 1: Write the server adapter**

Create `apps/inbox/server/build-agent.ts`:

```ts
import { BuiltInAgent } from "@copilotkit/runtime/v2";
import type { AgentDefinition } from "../core/defineAgent.js";
import type { ProviderRegistry } from "../core/providers.js";

// Builds the CopilotKit BuiltInAgent for an agent passport: resolves the
// provider from the registry by `def.provider` and delegates the event stream to
// `provider.run(input)`. All approval/turn logic lives in the provider (which
// reads `def.approvals`), so there is no hardcoded tool name here.
export function buildAgent(
  def: AgentDefinition,
  registry: ProviderRegistry,
): BuiltInAgent {
  const provider = registry.resolve(def.provider);
  return new BuiltInAgent({
    type: "custom",
    factory: ({ input }) => provider.run(input),
  });
}
```

- [ ] **Step 2: Rewrite `server/index.ts` to use the adapter**

Replace the contents of `apps/inbox/server/index.ts`:

```ts
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { inboxAgent, providerRegistry } from "../core/inbox.agent.js";
import { buildAgent } from "./build-agent.js";

const runtime = new CopilotRuntime({
  agents: { default: buildAgent(inboxAgent, providerRegistry) },
  runner: new InMemoryAgentRunner(),
});

// single-route: ONE POST endpoint at the bare basePath, matching the v2 client's
// default single-endpoint transport (see CLAUDE.md → CopilotKit v2 API notes).
const copilot = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
  mode: "single-route",
});

const app = new Hono();
app.route("/", copilot);

serve({ fetch: app.fetch, port: 4000 });
console.log("server on http://localhost:4000");
```

- [ ] **Step 3: Delete the old mock agent**

Run: `git rm apps/inbox/server/mock-agent.ts`
Expected: file removed (its logic now lives in `core/mock-provider.ts` + `build-agent.ts`).

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/server/build-agent.ts apps/inbox/server/index.ts
git commit -m "refactor(server): build agent from passport + provider registry"
```

---

## Task 10: Client glue — drive registrations from the passport

**Files:**
- Create: `apps/inbox/client/src/renderRegistry.tsx`
- Modify: `apps/inbox/client/src/actions.tsx`
- Modify: `apps/inbox/client/src/useAgentStatus.ts`
- Modify: `apps/inbox/client/src/components/AgentModal.tsx`
- Modify: `apps/inbox/client/src/App.tsx`
- Test: `apps/inbox/client/src/useAgentStatus.test.ts`, `apps/inbox/client/src/renderLead.test.tsx`

> Behavior is unchanged; this rewires the existing pieces to read the passport and
> the `core` helpers. Verified by the existing client tests + manual click-through.

- [ ] **Step 1: Create the name→component registry**

Create `apps/inbox/client/src/renderRegistry.tsx`:

```tsx
import type { ComponentType } from "react";
import { LeadCard } from "./components/LeadCard";
import { ApprovalDialog } from "./components/ApprovalDialog";

// Maps the component *names* referenced by `def.renders` to real React
// components. Keeps the shared passport (core/) free of React imports.
export const renderRegistry: Record<string, ComponentType<any>> = {
  LeadCard,
  ApprovalDialog,
};
```

- [ ] **Step 2: Point `useAgentStatus` at the core helper**

Replace the body logic in `apps/inbox/client/src/useAgentStatus.ts` so the local `AgentMessage` type and the local `hasPendingApproval` are removed, importing from `core` instead and taking `approvalNames`:

```ts
import { useEffect, useState } from "react";
import type { Status } from "./components/AgentCard";
import { hasPendingApproval, type Message } from "../../core/messages";

// Derives the AgentCard status from the agent's run lifecycle plus message state.
// `awaiting_approval` (from hasPendingApproval over agent.messages) wins over
// "done"/"running" but never over a terminal "error" — see CLAUDE.md.
export function useAgentStatus(
  agent: {
    messages: Message[];
    subscribe: (s: any) => { unsubscribe: () => void };
  },
  approvalNames: readonly string[],
): Status {
  const [lifecycle, setLifecycle] = useState<
    "idle" | "running" | "done" | "error"
  >("idle");
  const [messages, setMessages] = useState<Message[]>(agent.messages);

  useEffect(() => {
    setMessages(agent.messages);
    const { unsubscribe } = agent.subscribe({
      onRunStartedEvent: () => setLifecycle("running"),
      onRunFinalized: () => setLifecycle("done"),
      onRunFailed: () => setLifecycle("error"),
      onMessagesChanged: () => setMessages([...agent.messages]),
    });
    return () => unsubscribe();
  }, [agent]);

  if (lifecycle === "error") return "error";
  if (hasPendingApproval(messages, approvalNames)) return "awaiting_approval";
  return lifecycle;
}
```

- [ ] **Step 3: Update `useAgentStatus.test.ts`**

Open `apps/inbox/client/src/useAgentStatus.test.ts`. Wherever `useAgentStatus(agent)` is called, pass approval names: `useAgentStatus(agent, ["confirmSend"])`. If the test imported `hasPendingApproval` from `./useAgentStatus`, change that import to `../../core/messages` (the function moved). Leave the assertions unchanged.

- [ ] **Step 4: Run the client status test**

Run: `npm test -- client/src/useAgentStatus.test.ts`
Expected: PASS (behavior unchanged; now sourced from `core`).

- [ ] **Step 5: Drive `actions.tsx` from the passport**

Rewrite `apps/inbox/client/src/actions.tsx` so registrations are derived from the agent definition instead of hardcoded names. `renderLead` (non-approval) registers via `useRenderTool`; `confirmSend` (in `approvals`) registers via `useHumanInTheLoop`. Keep the existing field-presence gating and the `respond` wiring verbatim:

```tsx
import { useHumanInTheLoop, useRenderTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { inboxAgent } from "../../core/inbox.agent";
import { renderRegistry } from "./renderRegistry";
import { LeadCard } from "./components/LeadCard";
import { ApprovalDialog } from "./components/ApprovalDialog";

// Generative-UI registration for the inbox agent, derived from the passport:
// `renders` maps tool name → component name; `approvals` decides which tool pauses
// the run (useHumanInTheLoop) vs. pure render (useRenderTool).
export function useInboxActions() {
  // renderLead -> <LeadCard /> (pure generative UI).
  useRenderTool(
    {
      name: "renderLead",
      parameters: z.object({
        id: z.number(),
        from: z.string(),
        subject: z.string(),
        intent: z.string(),
      }),
      render: ({ parameters }) => {
        const { id, from, subject, intent } = parameters;
        if (
          id === undefined ||
          from === undefined ||
          subject === undefined ||
          intent === undefined
        ) {
          return <></>;
        }
        const Lead = renderRegistry[inboxAgent.renders.renderLead] ?? LeadCard;
        return <Lead lead={{ id, from, subject, intent }} />;
      },
    },
    [],
  );

  // confirmSend -> <ApprovalDialog /> (human-in-the-loop pause).
  useHumanInTheLoop<{ leadId: number; message: string }>(
    {
      name: "confirmSend",
      parameters: z.object({ leadId: z.number(), message: z.string() }),
      render: ({ args, status, respond }) => {
        if (args.leadId === undefined || args.message === undefined) {
          return <></>;
        }
        const data = { leadId: args.leadId, message: args.message };
        const Approval = renderRegistry[inboxAgent.renders.confirmSend] ?? ApprovalDialog;
        return (
          <Approval
            data={data}
            onApprove={() => {
              if (status === "executing" && respond) void respond("approved");
            }}
          />
        );
      },
    },
    [],
  );
}
```

- [ ] **Step 6: Use `pairToolResults` + `Message` in `AgentModal`**

In `apps/inbox/client/src/components/AgentModal.tsx`, replace the inline `toolMessageByCallId` map and the `any[]` typing with the core helper. Change the import block and the map construction:

```tsx
import type { ReactNode } from "react";
import { pairToolResults, type Message } from "../../../core/messages";
```

Change the prop type `agent: { messages: any[] }` to `agent: { messages: Message[] }`, and replace the manual map with:

```tsx
  const toolMessageByCallId = pairToolResults(agent.messages);
```

Leave the rest of the component (the `flatMap` thread render and the JSX) unchanged.

- [ ] **Step 7: Pass passport values down in `App.tsx`**

In `apps/inbox/client/src/App.tsx`, import the passport and use it for the card name and status approvals:

```tsx
import { inboxAgent } from "../../core/inbox.agent";
```

Change the status call to `const status = useAgentStatus(agent, inboxAgent.approvals);` and the card to `<AgentCard name={inboxAgent.name} ... />`.

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: PASS (core tests + `useAgentStatus.test.ts` + `renderLead.test.tsx`). If `renderLead.test.tsx` fails only because it imported a now-changed symbol, update its imports to match; do not change its assertions.

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add apps/inbox/client/src
git commit -m "refactor(client): drive renders/status from the agent passport"
```

---

## Task 11: Final verification, build, and docs

**Files:**
- Modify: `apps/inbox/docs`/repo docs as noted below.

- [ ] **Step 1: Full test + typecheck + build**

Run: `npm test && npm run typecheck && npm run build`
Expected: tests PASS, no type errors, build succeeds.

- [ ] **Step 2: Manual browser click-through (regression)**

Run: `npm run dev`, open `http://localhost:5173`.
Verify, exactly as in the slice:
1. Closed card shows "EMAIL AGENT" and "Idle".
2. START → status goes "Working…" → "Awaiting approval".
3. Open the card → thread shows assistant text + `LeadCard` + `ApprovalDialog`.
4. Approve → status goes "Done"; thread shows "Done — reply sent."
Expected: identical behavior to the pre-refactor slice.

- [ ] **Step 3: Update `docs/ARCHITECTURE.md`**

In `docs/ARCHITECTURE.md` §4, note that `renders` is keyed by tool name (not an abstract key) and mark the core layer items (`defineAgent`, providers, message layer) as ✅ BUILT. In §9 roadmap, mark "extract the reusable core" as done.

- [ ] **Step 4: Update `CLAUDE.md`**

In `CLAUDE.md`, move the "Next Phase — extract the reusable core" content to reflect completion: update "Current State" to mention `apps/inbox/core/` (message layer, provider registry, `defineAgent`), and record the decisions (AG-UI types reused in full via `Extract`; `renders` keyed by tool name; `fields`/package-split still deferred) under "Decisions".

- [ ] **Step 5: Commit**

```bash
git add docs/ARCHITECTURE.md CLAUDE.md
git commit -m "docs: mark core layer built; record core-layer decisions"
```

---

## Self-Review notes (addressed)

- **Spec coverage:** message layer (§4 → Tasks 1–4), provider registry + mock (§5 → Tasks 5–6), `defineAgent` (§6 → Task 7), concrete wiring (§6 → Task 8), server threading (§7 → Task 9), client threading (§7 → Task 10), testing (§9 → per-task tests + Task 11), risks/docs (§10 → Task 11).
- **Spec §6 clarification:** the "provider in registry" validation is enforced by `registry.resolve` (Task 5/9), not inside `defineAgent` — a passport cannot know the registry. Noted in Task 7.
- **Type consistency:** `Message`/`ToolCall`/`AssistantMessage`/`ToolMessage` defined in Task 1 and reused everywhere; `Provider`/`ProviderRegistry` from Task 5 used in Tasks 6/8/9; `AgentDefinition` from Task 7 used in Tasks 8/9; `createMockInboxProvider(approvalNames)`, `defineProviders`, `defineAgent`, `buildAgent`, `pairToolResults`, `hasPendingApproval`, `approvalResolved` names are consistent across tasks.
