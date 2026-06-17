import { Fragment } from 'react'
import clsx from 'clsx'
import type { Destination, Outcome } from '@atizar/core'
import { STATUS_LABEL, type Status } from '../../status'
import { OUTCOME_LABEL } from '../../lifecycleDisplay'
import { useDismiss } from '../../hooks/useDismiss'
import { Icon, type IconName } from '../Icon/Icon'
import { IntroBubble } from '../AgentModal/IntroBubble'
import { RunView } from '../RunView/RunView'
import type { HandoffNote } from '../../hooks/useBoardNavigation'
import { testIds } from '../../testIds'
import s from './InstanceView.module.scss'

// One run of the instance: its work item id and that run's origin notes. A run has NO name/status/
// Stop of its own — it contributes only its messages to the instance thread.
export type InstanceRun = {
  id: string
  notes: HandoffNote[]
}

// InstanceView = the view of ONE Instance (one correspondent) as ONE conversation thread (one
// scroll). The Agent's identity (icon + name + status) and Stop are shown ONCE here; the intro is
// one assistant bubble at the top. Each run contributes its MESSAGES inline (RunView) into this
// single thread — a run is not a box. Several drafts from one sender read as a continuous thread,
// separated by a thin rule, never as nested modals. A single-run instance is the same shape.
export type InstanceViewProps = {
  title: string
  iconName: IconName
  // The instance head status/outcome (worst-meaningful across its runs — pickHead).
  status: Status
  outcome?: Outcome
  // AGENT-static opening line, shown once as the first assistant bubble.
  description: string
  workflowId: string
  renderableToolNames: ReadonlySet<string>
  runs: InstanceRun[]
  deliver: (origin: string, dest: Destination, payload: unknown, parentId: string) => void
  // Stop the instance's live work (cancels its active runs). Instance-level, not per run.
  onStop: () => void
  onClose: () => void
  onOpenWorkflow?: (id: string) => void
  onOpenInstance?: (localId: string) => void
}

export const InstanceView = (p: InstanceViewProps) => {
  const { closing, dismiss } = useDismiss(p.onClose)
  const active = p.status === 'running' || p.status === 'awaiting_approval'
  return (
    <div className={clsx('backdrop', closing && 'closing')} onClick={dismiss}>
      <div
        className='modal'
        data-testid={testIds.instanceModal}
        onClick={(e) => e.stopPropagation()}
      >
        <div className='modal-head'>
          <span className='modal-mark'>
            <Icon name={p.iconName} size={17} />
          </span>
          <div className='modal-titles'>
            <span className='modal-title'>{p.title}</span>
            <span className={`modal-status status s-${p.status}`}>
              <span className={`dot ${p.status}`} />
              {p.status === 'done' && p.outcome ? OUTCOME_LABEL[p.outcome] : STATUS_LABEL[p.status]}
            </span>
            {p.runs.length > 1 && <span className={s.runCount}>{p.runs.length} runs</span>}
          </div>
          <button
            className='modal-x'
            data-testid={testIds.instanceClose}
            onClick={dismiss}
            aria-label='Close'
          >
            <Icon name='close' size={17} />
          </button>
        </div>

        <div className={s.thread}>
          {p.description && <IntroBubble text={p.description} />}
          {p.runs.map((run, i) => (
            <Fragment key={run.id}>
              {i > 0 && <div className={s.runSep} />}
              <RunView
                id={run.id}
                workflowId={p.workflowId}
                renderableToolNames={p.renderableToolNames}
                notes={run.notes}
                deliver={p.deliver}
                onOpenWorkflow={p.onOpenWorkflow}
                onOpenInstance={p.onOpenInstance}
              />
            </Fragment>
          ))}
        </div>

        {active && (
          <div className='modal-foot'>
            <button className='btn btn-ghost' data-testid={testIds.instanceStop} onClick={p.onStop}>
              Stop
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
