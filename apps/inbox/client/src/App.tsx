import { CopilotKit } from '@copilotkit/react-core/v2'
import { instanceId } from '@platform/core'
import { InboxView } from './InboxView'
import { workflows } from './workflows'

export const App = () => {
  // CopilotKit binds its internal listeners to this default agent id; it must be one
  // we actually register. Use the first workflow's entry agent INSTANCE id.
  const defaultAgent = instanceId(workflows[0].id, workflows[0].entryAgentId)
  return (
    <CopilotKit runtimeUrl='/api/copilotkit' agent={defaultAgent}>
      <InboxView />
    </CopilotKit>
  )
}
