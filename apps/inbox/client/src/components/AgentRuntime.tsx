import { useEffect } from 'react'
import { useAgent, UseAgentUpdate } from '@copilotkit/react-core/v2'
import type { AgentDefinition } from '@platform/core'
import { useAgentStatus } from '../useAgentStatus'
import type { Status } from '../status'

// The live runtime object an AgentRuntime publishes upward for one agent id.
export type AgentHandle = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: any
  status: Status
}

type AgentRuntimeProps = {
  def: AgentDefinition
  onChange: (id: string, handle: AgentHandle) => void
}

// Renders nothing — it exists only to own one agent's hooks and report state up.
export const AgentRuntime = ({ def, onChange }: AgentRuntimeProps) => {
  const { agent } = useAgent({ agentId: def.id, updates: [UseAgentUpdate.OnMessagesChanged] })
  const status = useAgentStatus(agent, def.approvals)

  useEffect(() => {
    onChange(def.id, { agent, status })
  }, [def.id, agent, status, onChange])

  return null
}
