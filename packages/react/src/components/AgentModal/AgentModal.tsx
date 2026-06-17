import type { ReactNode } from 'react'
import clsx from 'clsx'
import {
  pairToolResults,
  type Message,
  type Outcome,
  type ToolCall,
  type ToolMessage,
} from '@atizar/core'
import { STATUS_LABEL, type Status } from '../../status'
import { OUTCOME_LABEL } from '../../lifecycleDisplay'
import { isDevMode } from '../../devMode'
import { useDismiss } from '../../hooks/useDismiss'
import { ThreadResultsContext } from '../../threadResults'
import { Icon, type IconName } from '../Icon/Icon'
import { Markdown } from '../../primitives/Markdown/Markdown'
import { buildThreadItems } from '../../buildThreadItems.js'
import s from './AgentModal.module.scss'
// HandoffNote's single canonical definition lives in useBoardNavigation (so a hook consumer
// can type notes without importing a React component); re-export it here for back-compat.
import type { HandoffNote } from '../../hooks/useBoardNavigation'

export type { HandoffNote }

// AgentModal renders the conversation thread in an overlay panel.
//
// It receives the live `agent` (an AG-UI AbstractAgent, carrying `messages`)
// and the `renderToolCall` function returned by `useRenderToolCall()`. It walks
// `agent.messages` in order and renders:
//   - assistant text messages -> a chat bubble
//   - assistant tool calls     -> via `renderToolCall({ toolCall, toolMessage })`
//
// This is the SAME generative-UI surface as before; only the markup/classes
// changed (Smedja design). The human-in-the-loop approval button keeps its live
// `respond` callback (sourced from the executing tool-call state, not toolMessage).

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
  // Tool names that render as generative-UI cards (the consumer-facing surface). In
  // normal mode only these are shown; internal data-fetch tools (list_my_tickets,
  // get_latest_email, …) are hidden. Dev mode (?dev=1) reveals every tool-call chip.
  renderableToolNames: ReadonlySet<string>
  // True while the agent run is active — shows a trailing typing indicator. A real
  // model run takes seconds, so the thread can sit empty for a while after START.
  loading: boolean
  // Whether this agent can be launched directly. Handoff-only agents (reply) show no
  // START. When true, START appears in the footer too (mirrors the card) unless running.
  canStart: boolean
  // A hardcoded one-line "what I'm doing" shown once the agent has started.
  intro: string
  // The gate-sourced approval card, rendered below the thread when awaiting_approval. The
  // GATE (its form + formRev) is authoritative, not the folded stream args — so this is fed
  // from useGate, not from a tool call in `agent.messages`.
  gateSlot?: ReactNode
  // Handoff lines (sent and/or received) to show above the thread.
  notes: HandoffNote[]
  // Resolve display name/label + open affordance for an inline handoff item.
  // Supplied by the app (ThreadModal/board) so the framework carries no workflow literals.
  // When absent, a generic fallback is shown.
  resolveHandoff?: (h: { targetAgentId: string; childWorkItemId: string }) => {
    name: string
    label: string
    onOpen?: () => void
  }
  // Switch to the target workflow when a cross-workflow 'sent' note is clicked.
  onOpenWorkflow?: (id: string) => void
  // Jump to a live target instance (intra-workflow 'sent' note) by its localId.
  onOpenInstance?: (localId: string) => void
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
  onOpenWorkflow,
  onOpenInstance,
  onStart,
  onStop,
  onClose,
}: AgentModalProps) => {
  // Close plays a brief exit animation (mirrors the open) before the parent unmounts.
  const { closing, dismiss } = useDismiss(onClose)
  // Index tool result messages by toolCallId so each assistant tool call can be
  // paired with its matching `role:"tool"` result (used to surface a completed
  // saveDraft as done).
  const toolMessageByCallId = pairToolResults(agent.messages)

  // Parsed tool RESULTS of this thread, keyed by tool name — exposed via context so a
  // generative-UI card can read its data tool's output (e.g. TriageCard reading
  // list_my_tickets) instead of the model re-emitting it into the render tool.
  const resultsByToolName: Record<string, unknown> = {}
  for (const m of agent.messages) {
    if (m.role !== 'assistant' || !Array.isArray(m.toolCalls)) continue
    for (const tc of m.toolCalls) {
      const tm = toolMessageByCallId.get(tc.id)
      const name = tc.function?.name
      if (!tm || !name) continue
      try {
        resultsByToolName[name] = JSON.parse(String(tm.content))
      } catch {
        resultsByToolName[name] = tm.content
      }
    }
  }

  // Chronology: a receiver shows "← Received …" at the TOP (its first event); a sender
  // shows "→ Handed …" at the BOTTOM (the last thing it did), so the thread reads as history.
  const received = notes.filter((n) => n.dir === 'received')
  const sent = notes.filter((n) => n.dir === 'sent')

  // The incoming user-turn: the seed/source message the agent reacted to. AgentModal otherwise
  // renders only assistant turns; surfacing the first user message gives the human the input
  // beside the agent's output (reinforces the SourcePanel oversight surface).
  const incoming = agent.messages.find(
    (m) => m.role === 'user' && typeof m.content === 'string' && m.content.length > 0
  )
  const incomingText = incoming && typeof incoming.content === 'string' ? incoming.content : ''

  // Project messages → ordered ThreadItem[] (pure, no React), then map to JSX.
  const threadItems = buildThreadItems(agent.messages, {
    renderableToolNames,
    devMode: isDevMode,
  })
  const thread = threadItems.map((item) => {
    if (item.kind === 'lifecycle') {
      return (
        <div className={clsx(s.threadNote, s.lifecycle)} key={item.id}>
          {item.text}
        </div>
      )
    }
    if (item.kind === 'text') {
      return (
        <div className={clsx(s.threadItem, s.bubbleRow)} key={item.id}>
          <span className={s.agentGlyph}>
            <Icon name='sparkle' size={15} />
          </span>
          <div className={s.bubble}>
            <Markdown>{item.text}</Markdown>
          </div>
        </div>
      )
    }
    if (item.kind === 'toolCall') {
      return (
        <div className={s.threadItem} key={item.id}>
          {renderToolCall({
            toolCall: item.toolCall,
            toolMessage: toolMessageByCallId.get(item.toolCall.id),
          })}
        </div>
      )
    }
    // kind === 'handoff' — inline timeline note for a delivery to another agent.
    if (item.kind === 'handoff') {
      const resolved = resolveHandoff
        ? resolveHandoff({
            targetAgentId: item.targetAgentId,
            childWorkItemId: item.childWorkItemId ?? '',
          })
        : { name: item.targetAgentId, label: 'a work item', onOpen: undefined }
      return (
        <div className={clsx(s.threadNote, s.sent)} key={item.id}>
          → Handed <strong>{resolved.label}</strong> to {resolved.name}
          {resolved.onOpen && (
            <button className={s.noteLink} onClick={resolved.onOpen}>
              Open {resolved.name}
            </button>
          )}
        </div>
      )
    }
    return null
  })

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

        <ThreadResultsContext.Provider value={resultsByToolName}>
          <div className={s.thread}>
            {received.map((note, i) => (
              <div className={clsx(s.threadNote, s.received)} key={`rcv-${i}`}>
                ← Received <strong>{note.label}</strong> from {note.otherName}
              </div>
            ))}
            {incomingText && (
              <div className={clsx(s.threadItem, s.userTurn)} key='incoming'>
                {incomingText}
              </div>
            )}
            {/* Always show the intro — for a running instance it heads the thread; for a
                type view (idle, no instance) it's the agent's description so the card opens
                to something meaningful rather than a blank panel. */}
            <div className={clsx(s.threadItem, s.bubbleRow)}>
              <span className={s.agentGlyph}>
                <Icon name='sparkle' size={15} />
              </span>
              <div className={clsx(s.bubble, s.intro)}>{intro}</div>
            </div>
            {thread}
            {sent.map((note, i) => (
              <div className={clsx(s.threadNote, s.sent)} key={`snt-${i}`}>
                → Handed <strong>{note.label}</strong> to {note.otherName}
                {note.targetWorkflow ? (
                  <button
                    className={s.noteLink}
                    onClick={() => onOpenWorkflow?.(note.targetWorkflow!)}
                  >
                    Open in {note.targetWorkflow}
                  </button>
                ) : (
                  note.targetLocalId && (
                    <button
                      className={s.noteLink}
                      onClick={() => onOpenInstance?.(note.targetLocalId!)}
                    >
                      Open {note.otherName}
                    </button>
                  )
                )}
              </div>
            ))}
            {gateSlot && <div className={s.threadItem}>{gateSlot}</div>}
            {loading && (
              <div className={clsx(s.threadItem, s.bubbleRow)}>
                <span className={s.agentGlyph}>
                  <Icon name='sparkle' size={15} />
                </span>
                <div className={s.typing}>
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>
        </ThreadResultsContext.Provider>

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
