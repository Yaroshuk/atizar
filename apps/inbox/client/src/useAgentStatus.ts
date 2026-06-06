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
