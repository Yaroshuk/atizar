import { Fragment } from 'react'
import { activePipeline, type PipelineNode } from '../pipeline'
import type { Status } from '../status'
import { Icon } from './Icon'

// Live status -> mini-card tint class. Idle never reaches here (filtered out).
const TINT: Record<Status, string> = {
  idle: '',
  running: 'run',
  done: 'run',
  awaiting_approval: 'await',
  error: 'err',
}
const STATE_WORD: Record<Status, string> = {
  idle: '',
  running: 'Working',
  done: 'Done',
  awaiting_approval: 'Approve',
  error: 'Error',
}

type PipelineColumnProps = {
  nodes: PipelineNode[]
  onOpen: (id: string) => void
}

export const PipelineColumn = ({ nodes, onOpen }: PipelineColumnProps) => {
  const active = activePipeline(nodes)

  return (
    <div className='pipeline-col'>
      <div className='comp-head'>
        <span className='ch-label'>
          <Icon name='pipeline' size={14} />
          Pipeline
        </span>
      </div>

      <div className='pipeline-body'>
        {active.length === 0 ? (
          <p className='pipe-empty'>No agent is running yet. Launched agents appear here.</p>
        ) : (
          <div className='graph'>
            {active.map((node, i) => (
              <Fragment key={node.id}>
                {i > 0 && <div className='connector-down'>↓</div>}
                <div className={`mini ${TINT[node.status]}`} onClick={() => onOpen(node.id)}>
                  <div className='m-icon'>
                    <Icon name={node.iconName} size={15} />
                  </div>
                  <div className='m-text'>
                    <span className='m-name'>{node.name}</span>
                    <span className='m-sub'>{node.subtitle}</span>
                  </div>
                  <span className='m-state'>
                    <span className={`dot ${node.status}`} />
                    {STATE_WORD[node.status]}
                  </span>
                </div>
              </Fragment>
            ))}
          </div>
        )}
      </div>

      <div className='tint-legend'>
        <span className='ti'>
          <span className='sw run' />
          Running
        </span>
        <span className='ti'>
          <span className='sw await' />
          Awaiting approval
        </span>
        <span className='ti'>
          <span className='sw err' />
          Needs attention
        </span>
        <span className='ti'>
          <span className='sw idle' />
          Idle
        </span>
      </div>
    </div>
  )
}
