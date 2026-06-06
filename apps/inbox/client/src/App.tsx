import {
  CopilotKit,
  useAgent,
  UseAgentUpdate,
  useRenderToolCall,
} from "@copilotkit/react-core/v2";
import { useInboxActions } from "./actions";

function Spike() {
  // Register the generative-UI renderers (renderLead -> LeadCard, etc.).
  // Must run inside <CopilotKit>.
  useInboxActions();

  // v2: useAgent({ agentId }) returns { agent }. The agent (an AG-UI
  // AbstractAgent) carries `messages` and the `runAgent()` method. Subscribe to
  // OnMessagesChanged so React re-renders as the stream mutates agent.messages.
  const { agent } = useAgent({
    agentId: "default",
    updates: [UseAgentUpdate.OnMessagesChanged],
  });

  // useRenderToolCall() returns a function that renders a single AG-UI tool call
  // using the renderers registered via useRenderTool() (see actions.tsx).
  const renderToolCall = useRenderToolCall();

  // Map over assistant messages and render any tool calls they carry. The mock
  // agent's first turn emits a text message, then a `renderLead` tool call, then
  // a `confirmSend` tool call — so this surface shows the LeadCard on START.
  //
  // For each tool call we also look up the matching `role:"tool"` message (by
  // `toolCallId`) and pass it as `toolMessage`. This matters for the
  // human-in-the-loop `confirmSend` call: while the run is paused awaiting the
  // human, the framework marks the tool call "executing" (via
  // `executingToolCallIds`) so `useRenderToolCall` renders it with a live
  // `respond` callback. Once the human approves, a tool message exists and the
  // same render surfaces it as "complete". `useHumanInTheLoop` only exposes
  // `respond` in the executing state, so this executing-tool-call path — not a
  // raw render — is what makes the dialog button able to resume the agent.
  const toolMessageByCallId = new Map<string, any>();
  for (const msg of agent.messages as any[]) {
    if (msg.role === "tool" && msg.toolCallId) {
      toolMessageByCallId.set(msg.toolCallId, msg);
    }
  }

  const toolCallEls = agent.messages.flatMap((msg: any) =>
    msg.role === "assistant" && Array.isArray(msg.toolCalls)
      ? msg.toolCalls.map((toolCall: any) => (
          <div key={toolCall.id}>
            {renderToolCall({
              toolCall,
              toolMessage: toolMessageByCallId.get(toolCall.id),
            })}
          </div>
        ))
      : [],
  );

  return (
    <div>
      <button onClick={() => agent.runAgent()}>START</button>
      <div>{toolCallEls}</div>
      <pre>{JSON.stringify(agent.messages, null, 2)}</pre>
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
