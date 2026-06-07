import { CopilotKit } from '@copilotkit/react-core/v2'
import { InboxView } from './InboxView'
import { qualifierAgent } from '../../agents/inbox.agent'

export const App = () => {
  // `agent` sets CopilotKit's default chat-configuration agent — the one its
  // internal listeners (CopilotListeners) subscribe to. Without it the provider
  // falls back to the agent id "default", which we no longer register (we register
  // `qualifier` + `reply`), and the whole tree throws "Agent 'default' not found".
  // We drive both agents explicitly via useAgent; this just gives the listeners a
  // real agent to bind to.
  return (
    <CopilotKit runtimeUrl='/api/copilotkit' agent={qualifierAgent.id}>
      <InboxView />
    </CopilotKit>
  )
}
