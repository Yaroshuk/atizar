import type { AgentDefinition } from '@atizar/core'
import { AgentCard } from '../AgentCard/AgentCard'
import { CompHeader } from '../../primitives/CompHeader/CompHeader'
import { aggregateLabel } from '../../aggregate'
import type { AgentAggregate } from '../../aggregate'
import type { AgentMeta } from '../../renderSpecs'
import type { AgentHealth } from '../../serverTypes'

export const AgentGrid = ({
  agents,
  meta,
  aggOf,
  healthOf,
  canStart,
  onStart,
  onOpen,
}: {
  agents: AgentDefinition[]
  meta: Record<string, AgentMeta>
  aggOf: (agentId: string) => AgentAggregate
  healthOf: (agentId: string) => AgentHealth | undefined
  canStart: (agentId: string) => boolean
  onStart: (agent: AgentDefinition) => void
  onOpen: (agentId: string) => void
}) => (
  <div className='main'>
    <CompHeader
      icon='layers'
      label='Your agents'
      actions={
        <span className='legend'>
          <span className='legend-item'>
            <span className='dot idle' />
            Idle
          </span>
          <span className='legend-item'>
            <span className='dot done' />
            Running / done
          </span>
          <span className='legend-item'>
            <span className='dot awaiting_approval' />
            Awaiting approval
          </span>
        </span>
      }
    />
    <div className='main-scroll'>
      <div className='agent-grid'>
        {agents.map((agent) => {
          const agg = aggOf(agent.id)
          // A busy singleton no longer blocks START here — tapping its card opens the live
          // thread, where START/Start-over is a plain dispatch (server handles safe re-scan,
          // no client confirm). The only remaining START block is credential health (AgentCard).
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
              onStart={() => onStart(agent)}
              onOpen={() => onOpen(agent.id)}
            />
          )
        })}
      </div>
    </div>
  </div>
)
