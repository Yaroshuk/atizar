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
      if (approvalNames.includes(tc.function.name) && typeof tc.id === "string") {
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
