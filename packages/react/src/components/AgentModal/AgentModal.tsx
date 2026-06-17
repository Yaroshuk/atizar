import type { ReactNode } from 'react'
import clsx from 'clsx'
import { type Message, type Outcome, type ToolCall, type ToolMessage } from '@atizar/core'
import { STATUS_LABEL, type Status } from '../../status'
import { OUTCOME_LABEL } from '../../lifecycleDisplay'
import { useDismiss } from '../../hooks/useDismiss'
import { Icon, type IconName } from '../Icon/Icon'
import { ThreadBody } from './ThreadBody'
import s from './AgentModal.module.scss'
// HandoffNote's single canonical definition lives in useBoardNavigation (so a hook consumer
// can type notes without importing a React component); re-export it here for back-compat.
import type { HandoffNote } from '../../hooks/useBoardNavigation'

export type { HandoffNote }

// AgentModal = the modal CHROME (backdrop + header + footer) around a single ThreadBody. It is
// the IDLE TYPE-VIEW surface (an agent's intro + START before any run exists). A live run's
// conversation is rendered by RunView (inside InstanceView), which reuses ThreadBody directly —
// so AgentModal no longer owns the thread rendering, only the chrome.
export type AgentModalProps = {
  agent: { messages: Message[] }
  title: string
  iconName: IconName
  status: Status
  // The terminal flavour (done/stopped/rejected/…) of the run, when known. The display `status`
  // collapses stopped/rejected/superseded/reset into the 'done' lane; `outcome` recovers the
  // distinct header word (Stopped/Rejected) so a stopped run never reads as a clean Done.
  outcome?: Outcome
  // SSE connection of the underlying thread stream. 'reconnecting' shows a chip in the header so
  // a dropped stream never reads as a live-but-frozen thread. Optional: a static type view omits it.
  connection?: 'live' | 'reconnecting'
  renderToolCall: (args: { toolCall: ToolCall; toolMessage?: ToolMessage }) => ReactNode
  renderableToolNames: ReadonlySet<string>
  loading: boolean
  // Whether this agent can be launched directly. Handoff-only agents (reply) show no START.
  canStart: boolean
  // A hardcoded one-line "what I'm doing" shown at the head of the thread.
  intro: string
  gateSlot?: ReactNode
  notes: HandoffNote[]
  resolveHandoff?: (h: { targetAgentId: string; childWorkItemId: string }) => {
    name: string
    label: string
    onOpen?: () => void
  }
  onStart: () => void
  // Stop the run (cancel the work item). Shown while running/awaiting_approval.
  onStop?: () => void
  onClose: () => void
}

export const AgentModal = ({
  agent,
  title,
  iconName,
  status,
  outcome,
  connection,
  renderToolCall,
  renderableToolNames,
  loading,
  canStart,
  intro,
  gateSlot,
  notes,
  resolveHandoff,
  onStart,
  onStop,
  onClose,
}: AgentModalProps) => {
  // Close plays a brief exit animation (mirrors the open) before the parent unmounts.
  const { closing, dismiss } = useDismiss(onClose)

  return (
    <div className={clsx('backdrop', closing && 'closing')} onClick={dismiss}>
      <div className='modal' onClick={(e) => e.stopPropagation()}>
        <div className='modal-head'>
          <span className='modal-mark'>
            <Icon name={iconName} size={17} />
          </span>
          <div className='modal-titles'>
            <span className='modal-title'>{title}</span>
            <span className={`modal-status status s-${status}`}>
              <span className={`dot ${status}`} />
              {status === 'done' && outcome ? OUTCOME_LABEL[outcome] : STATUS_LABEL[status]}
            </span>
            {connection === 'reconnecting' && (
              <span className={s.reconnectChip}>
                <span className={s.cspin} />
                Reconnecting…
              </span>
            )}
          </div>
          <button className='modal-x' onClick={dismiss} aria-label='Close'>
            <Icon name='close' size={17} />
          </button>
        </div>

        <ThreadBody
          messages={agent.messages}
          renderToolCall={renderToolCall}
          renderableToolNames={renderableToolNames}
          loading={loading}
          intro={intro}
          gateSlot={gateSlot}
          notes={notes}
          resolveHandoff={resolveHandoff}
        />

        {(() => {
          const active = status === 'running' || status === 'awaiting_approval'
          const showStop = active && onStop
          const showStart = canStart && !active
          // While live, START isn't shown — but a launchable (input) agent can still START OVER:
          // START/Start-over is a plain dispatch; the server handles safe re-scan (supersede-prior
          // + one-live gate) — no client confirm. Without this affordance the affordance is lost.
          const showStartOver = canStart && active
          if (!showStop && !showStart && !showStartOver) return null
          return (
            <div className='modal-foot'>
              {showStart && (
                <button className='btn btn-primary' onClick={onStart}>
                  START
                </button>
              )}
              {showStartOver && (
                <button className='btn btn-ghost' onClick={onStart}>
                  Start over
                </button>
              )}
              {showStop && (
                <button className='btn btn-ghost' onClick={onStop}>
                  Stop
                </button>
              )}
            </div>
          )
        })()}
      </div>
    </div>
  )
}
