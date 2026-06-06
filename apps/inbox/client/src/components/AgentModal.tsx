import type { ReactNode } from "react";

// AgentModal renders the conversation thread in an overlay panel.
//
// It receives the live `agent` (an AG-UI AbstractAgent, carrying `messages`)
// and the `renderToolCall` function returned by `useRenderToolCall()`. It walks
// `agent.messages` in order and renders:
//   - assistant text messages -> <p>
//   - assistant tool calls     -> via `renderToolCall({ toolCall, toolMessage })`
//
// This is the SAME generative-UI surface that previously lived inline in
// App.tsx, moved here verbatim so the LeadCard + ApprovalDialog render and the
// human-in-the-loop approval button keeps its live `respond` callback (sourced
// from the executing tool-call state, not from `toolMessage`).
export function AgentModal({
  agent,
  renderToolCall,
  onClose,
}: {
  agent: { messages: any[] };
  renderToolCall: (args: { toolCall: any; toolMessage?: any }) => ReactNode;
  onClose: () => void;
}) {
  // Index tool result messages by toolCallId so each assistant tool call can be
  // paired with its matching `role:"tool"` result (used to surface a completed
  // confirmSend as done).
  const toolMessageByCallId = new Map<string, any>();
  for (const msg of agent.messages) {
    if (msg.role === "tool" && msg.toolCallId) {
      toolMessageByCallId.set(msg.toolCallId, msg);
    }
  }

  const thread = agent.messages.flatMap((msg: any, i: number) => {
    if (msg.role !== "assistant") return [];
    const nodes: ReactNode[] = [];

    // Assistant text content -> <p>.
    if (typeof msg.content === "string" && msg.content.length > 0) {
      nodes.push(<p key={`text-${i}`}>{msg.content}</p>);
    }

    // Assistant tool calls -> generative UI (LeadCard / ApprovalDialog).
    if (Array.isArray(msg.toolCalls)) {
      for (const toolCall of msg.toolCalls) {
        nodes.push(
          <div key={`tc-${toolCall.id}`}>
            {renderToolCall({
              toolCall,
              toolMessage: toolMessageByCallId.get(toolCall.id),
            })}
          </div>,
        );
      }
    }

    return nodes;
  });

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.3)",
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxHeight: "80vh",
          overflow: "auto",
          background: "#fff",
          borderRadius: 12,
          padding: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <strong>EMAIL AGENT</strong>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              border: 0,
              background: "transparent",
              fontSize: 20,
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <div>{thread}</div>
      </div>
    </div>
  );
}
