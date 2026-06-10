import type { ReactNode } from 'react'
import { pairToolResults, type Message, type ToolCall, type ToolMessage } from '@platform/core'
import { STATUS_LABEL, type Status } from '../status'
import { isDevMode } from '../devMode'
import { ThreadResultsContext } from '../threadResults'
import { Icon, type IconName } from './Icon'

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
// A handoff line shown at the top of an agent's thread so the flow is legible:
// the sender notes what it handed off, the receiver notes what it received.
export type HandoffNote = {
  dir: 'sent' | 'received'
  otherName: string
  label: string
  targetWorkflow?: string // present on a cross-workflow 'sent' note
  targetLocalId?: string // the spawned target instance (intra-workflow jump), if it started
}

export type AgentModalProps = {
  agent: { messages: Message[] }
  title: string
  iconName: IconName
  status: Status
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
  renderToolCall,
  renderableToolNames,
  loading,
  canStart,
  intro,
  gateSlot,
  notes,
  onOpenWorkflow,
  onOpenInstance,
  onStart,
  onStop,
  onClose,
}: AgentModalProps) => {
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

  const thread = agent.messages.flatMap((msg: Message, i: number) => {
    if (msg.role !== 'assistant') return []
    const nodes: ReactNode[] = []

    // Assistant text content -> chat bubble.
    if (typeof msg.content === 'string' && msg.content.length > 0) {
      nodes.push(
        <div className='thread-item bubble-row' key={`text-${i}`}>
          <span className='agent-glyph'>
            <Icon name='sparkle' size={15} />
          </span>
          <div className='bubble'>{msg.content}</div>
        </div>
      )
    }

    // Assistant tool calls -> generative UI (LeadCard / VerdictCard / ApprovalDialog).
    // Hide internal plumbing (unregistered data-fetch tools) unless dev mode is on.
    if (Array.isArray(msg.toolCalls)) {
      for (const toolCall of msg.toolCalls) {
        const name = toolCall.function?.name ?? ''
        if (!isDevMode && !renderableToolNames.has(name)) continue
        nodes.push(
          <div className='thread-item' key={`tc-${toolCall.id}`}>
            {renderToolCall({
              toolCall,
              toolMessage: toolMessageByCallId.get(toolCall.id),
            })}
          </div>
        )
      }
    }

    return nodes
  })

  return (
    <div className='backdrop' onClick={onClose}>
      <div className='modal' onClick={(e) => e.stopPropagation()}>
        <div className='modal-head'>
          <span className='modal-mark'>
            <Icon name={iconName} size={17} />
          </span>
          <div className='modal-titles'>
            <span className='modal-title'>{title}</span>
            <span className={`modal-status status s-${status}`}>
              <span className={`dot ${status}`} />
              {STATUS_LABEL[status]}
            </span>
          </div>
          <button className='modal-x' onClick={onClose} aria-label='Close'>
            <Icon name='close' size={17} />
          </button>
        </div>

        <ThreadResultsContext.Provider value={resultsByToolName}>
          <div className='thread'>
            {received.map((note, i) => (
              <div className='thread-note received' key={`rcv-${i}`}>
                ← Received <strong>{note.label}</strong> from {note.otherName}
              </div>
            ))}
            {/* Always show the intro — for a running instance it heads the thread; for a
                type view (idle, no instance) it's the agent's description so the card opens
                to something meaningful rather than a blank panel. */}
            <div className='thread-item bubble-row'>
              <span className='agent-glyph'>
                <Icon name='sparkle' size={15} />
              </span>
              <div className='bubble intro'>{intro}</div>
            </div>
            {thread}
            {sent.map((note, i) => (
              <div className='thread-note sent' key={`snt-${i}`}>
                → Handed <strong>{note.label}</strong> to {note.otherName}
                {note.targetWorkflow ? (
                  <button
                    className='note-link'
                    onClick={() => onOpenWorkflow?.(note.targetWorkflow!)}
                  >
                    Open in {note.targetWorkflow}
                  </button>
                ) : (
                  note.targetLocalId && (
                    <button
                      className='note-link'
                      onClick={() => onOpenInstance?.(note.targetLocalId!)}
                    >
                      Open {note.otherName}
                    </button>
                  )
                )}
              </div>
            ))}
            {gateSlot && <div className='thread-item'>{gateSlot}</div>}
            {loading && (
              <div className='thread-item bubble-row'>
                <span className='agent-glyph'>
                  <Icon name='sparkle' size={15} />
                </span>
                <div className='typing'>
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
          if (!showStop && !showStart) return null
          return (
            <div className='modal-foot'>
              {showStart && (
                <button className='btn btn-primary' onClick={onStart}>
                  START
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
