import { CopilotKit, useAgent, UseAgentUpdate } from "@copilotkit/react-core/v2";

function Spike() {
  // v2: useAgent({ agentId }) returns { agent }. The agent (an AG-UI
  // AbstractAgent) carries `messages` and the `runAgent()` method. Subscribe to
  // OnMessagesChanged so React re-renders as the stream mutates agent.messages.
  const { agent } = useAgent({
    agentId: "default",
    updates: [UseAgentUpdate.OnMessagesChanged],
  });
  return (
    <div>
      <button onClick={() => agent.runAgent()}>START</button>
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
