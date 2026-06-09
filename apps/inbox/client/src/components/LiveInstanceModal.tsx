import { useRenderToolCall } from '@copilotkit/react-core/v2'
import { AgentModal, type AgentModalProps } from './AgentModal'

type LiveInstanceModalProps = Omit<AgentModalProps, 'renderToolCall'>

// A live agent instance's thread. Mounted UNDER a
// <CopilotChatConfigurationProvider agentId={localId}> (see InboxView), so the
// renderToolCall it creates resolves each tool call to THIS instance's registration.
// That is what makes a per-instance HITL approval route to the right `respond`: with a
// single shared registration, two instances awaiting approval at once collide and the
// second instance's approve button is dead. Creating renderToolCall here (inside the
// provider) is the whole point — created in InboxView it would capture the default
// agent id and resolve to the wrong copy.
export const LiveInstanceModal = (props: LiveInstanceModalProps) => {
  const renderToolCall = useRenderToolCall()
  return <AgentModal {...props} renderToolCall={renderToolCall} />
}
