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
