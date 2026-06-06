import { useState } from 'react'
import {
  CopilotKit,
  useAgent,
  useCopilotKit,
  UseAgentUpdate,
  useRenderToolCall,
} from '@copilotkit/react-core/v2'
import { useInboxActions } from './actions'
import { AgentCard } from './components/AgentCard'
import { AgentModal } from './components/AgentModal'
import { useAgentStatus } from './useAgentStatus'
import { inboxAgent } from '../../core/inbox.agent'

function Spike() {
  // Modal open state.
  const [open, setOpen] = useState(false)

  // Register the generative-UI renderers (renderLead -> LeadCard,
  // confirmSend -> ApprovalDialog). Must run inside <CopilotKit>. The
  // "awaiting_approval" status is no longer sourced from here — it is derived
  // from agent.messages in useAgentStatus, so it is reported even when the
  // ApprovalDialog (and modal) are not mounted.
  useInboxActions()

  // The CopilotKitCore singleton. Runs MUST be driven through
  // `copilotkit.runAgent({ agent })` — NOT the bare `agent.runAgent()`.
  //
  // `agent.runAgent()` (the AG-UI AbstractAgent method) only streams one turn
  // and accumulates messages on the agent; it does NOT run CopilotKit's
  // frontend-tool pipeline. The human-in-the-loop resume lives in
  // `CopilotKitCore.runAgent` -> `processAgentResult`: that is what invokes the
  // `useHumanInTheLoop` tool handler (whose Promise `respond` resolves), splices
  // the resulting `role:"tool"` message into `agent.messages`, and — because
  // `followUp` defaults on — fires the follow-up `runAgent({ agent })`. Since
  // that follow-up re-runs the SAME agent, `prepareRunAgentInput` reads the now
  // populated `agent.messages` (history + the confirmSend tool call + the tool
  // result), so the resume POST carries the full conversation instead of `[]`.
  // Calling the bare `agent.runAgent()` bypasses all of that, which is why the
  // resume run previously sent `messages: []` and the agent re-emitted turn 1.
  const { copilotkit } = useCopilotKit()

  // v2: useAgent({ agentId }) returns { agent }. The agent (an AG-UI
  // AbstractAgent) carries `messages` and the `runAgent()` method. Subscribe to
  // OnMessagesChanged so React re-renders as the stream mutates agent.messages.
  const { agent } = useAgent({
    agentId: 'default',
    updates: [UseAgentUpdate.OnMessagesChanged],
  })

  // useRenderToolCall() returns a function that renders a single AG-UI tool call
  // using the renderers registered via useRenderTool() (see actions.tsx). The
  // mapping over `agent.messages[].toolCalls[]` (pairing each with its matching
  // `role:"tool"` message by toolCallId) now lives in <AgentModal>; the live
  // `respond` for the ApprovalDialog comes from the executing-tool-call state,
  // not from `toolMessage`, so it keeps working inside the modal.
  const renderToolCall = useRenderToolCall()

  // Status comes from the agent's real run lifecycle (onRunStartedEvent ->
  // running, onRunFinalized -> done, onRunFailed -> error) with a pending
  // confirmSend tool call (derived from agent.messages) overriding to
  // "awaiting_approval" — render-independent, so the CLOSED card shows it.
  const status = useAgentStatus(agent, inboxAgent.approvals)

  return (
    <div>
      <AgentCard
        name={inboxAgent.name}
        status={status}
        onStart={() => void copilotkit.runAgent({ agent })}
        onOpen={() => setOpen(true)}
      />
      {open && (
        <AgentModal agent={agent} renderToolCall={renderToolCall} onClose={() => setOpen(false)} />
      )}
    </div>
  )
}

export default function App() {
  return (
    <CopilotKit runtimeUrl='/api/copilotkit'>
      <Spike />
    </CopilotKit>
  )
}
