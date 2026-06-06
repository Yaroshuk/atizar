import { CopilotKit } from '@copilotkit/react-core/v2'
import { InboxView } from './InboxView'

export const App = () => {
  return (
    <CopilotKit runtimeUrl='/api/copilotkit'>
      <InboxView />
    </CopilotKit>
  )
}
