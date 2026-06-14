import type { AgentDefinition } from '@atizar/core'
import { AgentCard } from './AgentCard'
import { CompHeader } from '../primitives/CompHeader'
import { aggregateLabel } from '../aggregate'
import type { AgentAggregate } from '../aggregate'
import type { AgentMeta } from '../renderSpecs'
import type { AgentHealth, ServerStatus, WorkItem } from '../serverTypes'

const ACTIVE_SERVER: ReadonlySet<ServerStatus> = new Set([
  'queued',
  'running',
  'awaiting_approval',
  'awaiting_input',
])

export const AgentGrid = ({
  agents,
  meta,
  items,
  activeWorkflowId,
  aggOf,
  healthOf,
  canStart,
  onStart,
  onOpen,
}: {
  agents: AgentDefinition[]
  meta: Record<string, AgentMeta>
  items: WorkItem[]
  activeWorkflowId: string
  aggOf: (agentId: string) => AgentAggregate
  healthOf: (agentId: string) => AgentHealth | undefined
  canStart: (agentId: string) => boolean
  onStart: (agent: AgentDefinition) => void
  onOpen: (agentId: string) => void
}) => (
  <div className="main">
    <CompHeader
      icon="layers"
      label="Your agents"
      actions={
        <span className="legend">
          <span className="legend-item">
            <span className="dot idle" />
            Idle
          </span>
          <span className="legend-item">
            <span className="dot done" />
            Running / done
          </span>
          <span className="legend-item">
            <span className="dot awaiting_approval" />
            Awaiting approval
          </span>
        </span>
      }
    />
    <div className="main-scroll">
      <div className="agent-grid">
        {agents.map((agent) => {
          const agg = aggOf(agent.id)
          const singletonBusy =
            agent.maxInstances === 1 &&
            items.some(
              (w) =>
                w.workflowId === activeWorkflowId &&
                w.agentId.slice(w.workflowId.length + 2) === agent.id &&
                ACTIVE_SERVER.has(w.status)
            )
          return (
            <AgentCard
              key={agent.id}
              name={agent.name}
              subtitle={meta[agent.id].subtitle}
              iconName={meta[agent.id].iconName}
              status={agg.status}
              aggregateLabel={aggregateLabel(agg)}
              canStart={canStart(agent.id)}
              health={healthOf(agent.id)}
              startDisabled={singletonBusy}
              startDisabledReason={singletonBusy ? 'Already running' : undefined}
              onStart={() => onStart(agent)}
              onOpen={() => onOpen(agent.id)}
            />
          )
        })}
      </div>
    </div>
  </div>
)
