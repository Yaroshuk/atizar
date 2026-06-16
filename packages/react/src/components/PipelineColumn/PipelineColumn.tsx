import type { PInstance, PipelineBlock } from '../../pipelineModel'
import type { Status } from '../../status'
import { pillLabel, pillTint } from '../../statusDisplay'
import { Icon } from '../Icon/Icon'
import { CompHeader } from '../../primitives/CompHeader/CompHeader'
import { StopButton } from '../../primitives/StopButton/StopButton'
import { ResetButton } from '../../primitives/ResetButton/ResetButton'
import s from './PipelineColumn.module.scss'

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
  // Reset this workflow — clear its finished items from the live column. Absent → no Reset.
  onResetWorkflow?: () => void
  resettingWorkflow?: boolean
}

// A work item is stoppable while it is actively occupying the operator (running or
// awaiting a human). idle/done/error are terminal-ish — no Stop.
const isStoppable = (s: Status): boolean => s === 'running' || s === 'awaiting_approval'

// The down-arrow connector from a parent to its children (SVG, matches the design).
const ConnectorDown = () => (
  <div className={s.connectorDown} aria-hidden='true'>
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
  onResetWorkflow,
  resettingWorkflow = false,
}: PipelineColumnProps) => {
  // The state pill + (when active and a stop handler exists) a per-item Stop button.
  // `.m-state`/`.dot`/the status word stay GLOBAL (shared with AgentCard + the
  // instance picker); the StopButton renders its own (global) `.stop-btn.icon`.
  const stateAndStop = (inst: PInstance) => {
    const stoppable = onStopItem && isStoppable(inst.status)
    return (
      <>
        <span className='m-state'>
          <span className={`dot ${inst.status}`} />
          {pillLabel(inst.status, inst.outcome)}
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

  // `has-stop`/`is-stopping` are GLOBAL hover-reveal classes (their rules + the
  // `.mini.has-stop .stop-btn.icon` compounds live in styles.css); composed as
  // plain strings alongside the global `mini`/`pl-single`/`pl-inst` + tint classes.
  const stopClasses = (inst: PInstance): string => {
    if (!(onStopItem && isStoppable(inst.status))) return ''
    return ' has-stop' + (stoppingItems[inst.localId] ? ' is-stopping' : '')
  }

  return (
    <div className={s.pipelineCol}>
      <CompHeader
        icon='pipeline'
        label='Pipeline'
        actions={
          (onResetWorkflow || onStopWorkflow) && (
            <span className={s.pipeActions}>
              {/* Icon-only in the narrow 296px Pipeline header (tooltips carry the meaning);
                  the labelled affordance lives in the top bar's "Reset all" / "Stop all". */}
              {onResetWorkflow && (
                <ResetButton
                  scope='workflow'
                  resetting={resettingWorkflow}
                  onClick={onResetWorkflow}
                  title='Reset this workflow — stop and clear everything (running items included)'
                />
              )}
              {onStopWorkflow && (
                <StopButton
                  scope='workflow'
                  disabled={workflowActiveCount === 0}
                  stopping={stoppingWorkflow}
                  onClick={onStopWorkflow}
                  title='Stop every active item in this workflow'
                />
              )}
            </span>
          )
        }
      />

      <div className={s.pipelineBody}>
        {blocks.length === 0 ? (
          <p className={s.pipeEmpty}>No agent is running yet. Launched agents appear here.</p>
        ) : (
          blocks.map((block) => (
            <div className={s.plBlock} key={block.parent.localId}>
              <div
                className={`mini ${pillTint(block.parent.status, block.parent.outcome)}${stopClasses(block.parent)}`}
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
                  <div className={s.plCont}>
                    {block.groups.map((g) => {
                      const nested = g.instances.length >= 2 || g.queued > 0
                      if (!nested) {
                        const inst = g.instances[0]
                        return (
                          <div
                            key={g.agentId}
                            className={`pl-single ${pillTint(inst.status, inst.outcome)}${stopClasses(inst)}`}
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
                        <div key={g.agentId} className={s.plGroup}>
                          <div className={s.plAhead}>
                            <div className='m-icon'>
                              <Icon name={g.iconName} size={14} />
                            </div>
                            <span className={s.plAname}>{g.name}</span>
                            <span className={s.plAcount}>{g.instances.length} active</span>
                          </div>
                          <div className={s.plKids}>
                            {g.instances.map((inst) => (
                              <div key={inst.localId} className={s.plKid}>
                                <span className={s.plHstub} />
                                <div
                                  className={`pl-inst ${pillTint(inst.status, inst.outcome)}${stopClasses(inst)}`}
                                  onClick={() => onOpen(inst.localId)}
                                >
                                  <span className='pl-iname'>{inst.label || inst.name}</span>
                                  {stateAndStop(inst)}
                                </div>
                              </div>
                            ))}
                          </div>
                          {g.queued > 0 && <p className={s.plQueued}>queued: {g.queued}</p>}
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

      <div className={s.tintLegend}>
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
