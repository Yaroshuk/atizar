import { useEffect, useState } from "react";
import type { Status } from "./components/AgentCard";

// A minimal structural view of an AG-UI message, matching what the agent
// accumulates onto `agent.messages` (and what the mock streams in). Tool calls
// carry the name at `toolCalls[].function.name` and the id at `toolCalls[].id`;
// tool results are `{ role: "tool", toolCallId }` (AG-UI's ToolMessageSchema
// strips the name, so we correlate by id — same logic as the server's
// `approvalResolved` and <AgentModal>'s toolCall↔toolMessage pairing).
export type AgentMessage = {
  role?: string;
  toolCallId?: string;
  toolCalls?: Array<{ id?: string; function?: { name?: string } }>;
};

// Render-INDEPENDENT detection of a pending human-in-the-loop approval.
//
// Returns true when there exists an assistant `confirmSend` tool call whose
// `toolCallId` has NO matching `role:"tool"` result message yet — i.e. the run
// is paused awaiting the human. Because this is computed purely from message
// state, it is true whether or not the ApprovalDialog (or the modal) is
// mounted. That is the whole point: the CLOSED card must show
// "Жду подтверждения" without the user opening the modal.
export function hasPendingApproval(messages: readonly AgentMessage[]): boolean {
  // Ids of confirmSend tool calls the human has already answered.
  const answeredCallIds = new Set<string>();
  for (const m of messages) {
    if (m?.role === "tool" && typeof m.toolCallId === "string") {
      answeredCallIds.add(m.toolCallId);
    }
  }

  for (const m of messages) {
    if (m?.role !== "assistant" || !Array.isArray(m.toolCalls)) continue;
    for (const tc of m.toolCalls) {
      if (
        tc?.function?.name === "confirmSend" &&
        typeof tc.id === "string" &&
        !answeredCallIds.has(tc.id)
      ) {
        return true;
      }
    }
  }
  return false;
}

// Derives the AgentCard status from the agent's REAL run lifecycle PLUS its
// message state.
//
// The installed `@ag-ui/client` AbstractAgent exposes:
//   agent.subscribe(subscriber) => { unsubscribe }
// with the lifecycle callbacks `onRunStartedEvent`, `onRunFinalized`,
// `onRunFailed`, and `onMessagesChanged` (verified against
// node_modules/@ag-ui/client/dist/index.d.ts).
//
// We map:
//   onRunStartedEvent -> "running"
//   onRunFinalized    -> "done"
//   onRunFailed       -> "error"
//
// `awaiting_approval` is derived from `agent.messages` (see
// `hasPendingApproval`), NOT from whether the ApprovalDialog renders. This is
// critical: `onRunFinalized` fires at the END OF EACH run — including turn 1,
// the very moment the confirmSend tool call has been emitted and the agent has
// paused for the human. So the lifecycle would read "done" while the agent is
// actually awaiting approval. We therefore let a pending confirmSend WIN over
// "done"/"running" (but never over a terminal "error"). Once the user approves,
// a matching `role:"tool"` message lands, `hasPendingApproval` flips to false,
// the resume run finalizes, and status settles to "done".
export function useAgentStatus(agent: {
  messages: AgentMessage[];
  subscribe: (s: any) => { unsubscribe: () => void };
}): Status {
  const [lifecycle, setLifecycle] = useState<
    "idle" | "running" | "done" | "error"
  >("idle");
  // Mirror of agent.messages so a pending approval re-derives on every change.
  const [messages, setMessages] = useState<AgentMessage[]>(agent.messages);

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

  // A pending confirmSend means the run is paused for the human — surface that
  // explicitly, overriding "done"/"running", but never masking a terminal error.
  if (lifecycle === "error") return "error";
  if (hasPendingApproval(messages)) return "awaiting_approval";
  return lifecycle;
}
