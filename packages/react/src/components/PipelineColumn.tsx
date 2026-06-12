import type { PInstance, PipelineBlock } from '../pipelineModel'
import type { Status } from '../status'
import { TINT, STATE_WORD } from '../statusDisplay'
import { Icon } from './Icon'
import { CompHeader } from '../primitives/CompHeader'
import { StopButton } from '../primitives/StopButton'

type PipelineColumnProps = {
  blocks: PipelineBlock[]
  onOpen: (localId: string) => void
  // Stop one work item (an active instance card). Absent → no per-item Stop.
  onStopItem?: (localId: string) => void
  stoppingItems?: Record<string, boolean>
  // Stop this whole workflow (header control). Disabled when nothing is active.
  onStopWorkflow?: () => void
  workflowActiveCount?: number
  stoppingWorkflow?: boolean
}

// A work item is stoppable while it is actively occupying the operator (running or
// awaiting a human). idle/done/error are terminal-ish — no Stop.
const isStoppable = (s: Status): boolean => s === 'running' || s === 'awaiting_approval'

// The down-arrow connector from a parent to its children (SVG, matches the design).
const ConnectorDown = () => (
  <div className='connector-down' aria-hidden='true'>
    <svg viewBox='0 0 14 26' width='14' height='26' style={{ overflow: 'visible' }}>
      <line x1='7' y1='0' x2='7' y2='20' stroke='currentColor' strokeWidth='1.6' />
      <path
        d='M3.5 17 7 21l3.5-4'
        fill='none'
        stroke='currentColor'
        strokeWidth='1.6'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  </div>
)

export const PipelineColumn = ({
  blocks,
  onOpen,
  onStopItem,
  stoppingItems = {},
  onStopWorkflow,
  workflowActiveCount = 0,
  stoppingWorkflow = false,
}: PipelineColumnProps) => {
  // The state pill + (when active and a stop handler exists) a per-item Stop button.
  const stateAndStop = (inst: PInstance) => {
    const stoppable = onStopItem && isStoppable(inst.status)
    return (
      <>
        <span className='m-state'>
          <span className={`dot ${inst.status}`} />
          {STATE_WORD[inst.status]}
        </span>
        {stoppable && (
          <StopButton
            scope='item'
            stopping={!!stoppingItems[inst.localId]}
            title='Stop this item'
            onClick={(e) => {
              e.stopPropagation()
              onStopItem(inst.localId)
            }}
          />
        )}
      </>
    )
  }

  const stopClasses = (inst: PInstance): string => {
    if (!(onStopItem && isStoppable(inst.status))) return ''
    return ' has-stop' + (stoppingItems[inst.localId] ? ' is-stopping' : '')
  }

  return (
    <div className='pipeline-col'>
      <CompHeader
        icon='pipeline'
        label='Pipeline'
        actions={
          onStopWorkflow && (
            <StopButton
              scope='workflow'
              label='Stop workflow'
              disabled={workflowActiveCount === 0}
              stopping={stoppingWorkflow}
              onClick={onStopWorkflow}
              title='Stop every active item in this workflow'
            />
          )
        }
      />

      <div className='pipeline-body'>
        {blocks.length === 0 ? (
          <p className='pipe-empty'>No agent is running yet. Launched agents appear here.</p>
        ) : (
          blocks.map((block) => (
            <div className='pl-block' key={block.parent.localId}>
              <div
                className={`mini ${TINT[block.parent.status]}${stopClasses(block.parent)}`}
                onClick={() => onOpen(block.parent.localId)}
              >
                <div className='m-icon'>
                  <Icon name={block.parent.iconName} size={15} />
                </div>
                <div className='m-text'>
                  <span className='m-name'>
                    {block.parent.name}
                    {block.parent.label ? ` · ${block.parent.label}` : ''}
                  </span>
                </div>
                {stateAndStop(block.parent)}
              </div>

              {block.groups.length > 0 && (
                <>
                  <ConnectorDown />
                  <div className='pl-cont'>
                    {block.groups.map((g) => {
                      const nested = g.instances.length >= 2 || g.queued > 0
                      if (!nested) {
                        const inst = g.instances[0]
                        return (
                          <div
                            key={g.agentId}
                            className={`pl-single ${TINT[inst.status]}${stopClasses(inst)}`}
                            onClick={() => onOpen(inst.localId)}
                          >
                            <div className='m-icon'>
                              <Icon name={g.iconName} size={15} />
                            </div>
                            <div className='m-text'>
                              <span className='m-name'>
                                {g.name}
                                {inst.label ? ` · ${inst.label}` : ''}
                              </span>
                            </div>
                            {stateAndStop(inst)}
                          </div>
                        )
                      }
                      return (
                        <div key={g.agentId} className='pl-group'>
                          <div className='pl-ahead'>
                            <div className='m-icon'>
                              <Icon name={g.iconName} size={14} />
                            </div>
                            <span className='pl-aname'>{g.name}</span>
                            <span className='pl-acount'>{g.instances.length} active</span>
                          </div>
                          <div className='pl-kids'>
                            {g.instances.map((inst) => (
                              <div key={inst.localId} className='pl-kid'>
                                <span className='pl-hstub' />
                                <div
                                  className={`pl-inst ${TINT[inst.status]}${stopClasses(inst)}`}
                                  onClick={() => onOpen(inst.localId)}
                                >
                                  <span className='pl-iname'>{inst.label || inst.name}</span>
                                  {stateAndStop(inst)}
                                </div>
                              </div>
                            ))}
                          </div>
                          {g.queued > 0 && <p className='pl-queued'>queued: {g.queued}</p>}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          ))
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
