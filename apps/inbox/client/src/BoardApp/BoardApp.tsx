import { WorkflowsProvider, type WorkflowsConfig } from '@atizar/react'
import { BoardInner } from './BoardInner'

type BoardAppProps = {
  config: WorkflowsConfig
  demo?: boolean
}

export const BoardApp = ({ config, demo }: BoardAppProps) => (
  <WorkflowsProvider config={config}>
    <BoardInner config={config} demo={demo} />
  </WorkflowsProvider>
)
