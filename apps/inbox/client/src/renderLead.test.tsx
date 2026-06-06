import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CopilotKit, useRenderToolCall } from "@copilotkit/react-core/v2";
import { useInboxActions } from "./actions";

// Sample `agent.messages` array, shaped exactly like what the mock agent streams
// into `agent.messages` (per the bug report): an assistant message carrying a
// `renderLead` tool call in AG-UI form `{ id, type, function: { name, arguments } }`,
// where `arguments` is a JSON *string*.
const messages = [
  {
    role: "assistant",
    content: "Проверяю входящие… нашёл заявку.",
  },
  {
    role: "assistant",
    toolCalls: [
      {
        id: "tc_1",
        type: "function",
        function: {
          name: "renderLead",
          arguments: JSON.stringify({
            id: 42,
            from: "ivan@acme.ru",
            subject: "Заказ 10 шт",
            intent: "order",
          }),
        },
      },
    ],
  },
];

// Mirror of the exact render surface in App.tsx: register the renderers, then map
// over assistant messages and call `renderToolCall({ toolCall })` per tool call.
function ToolCallSurface() {
  useInboxActions();
  const renderToolCall = useRenderToolCall();
  const els = messages.flatMap((msg: any) =>
    msg.role === "assistant" && Array.isArray(msg.toolCalls)
      ? msg.toolCalls.map((toolCall: any) => (
          <div key={toolCall.id}>{renderToolCall({ toolCall })}</div>
        ))
      : [],
  );
  return <div>{els}</div>;
}

describe("renderLead generative-UI mapping", () => {
  it("renders the LeadCard from a streamed renderLead tool call in agent.messages", () => {
    render(
      <CopilotKit runtimeUrl="/api/copilotkit">
        <ToolCallSurface />
      </CopilotKit>,
    );

    // The LeadCard must visibly paint: subject, the envelope + sender, and intent.
    expect(screen.getByText("Заказ 10 шт")).toBeInTheDocument();
    expect(screen.getByText(/ivan@acme\.ru/)).toBeInTheDocument();
    expect(screen.getByText(/✉️/)).toBeInTheDocument();
    expect(screen.getByText("order")).toBeInTheDocument();
  });
});
