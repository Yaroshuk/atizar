import type { ReactNode } from 'react'
import { pairToolResults, type Message, type ToolCall, type ToolMessage } from '@platform/core'
import { STATUS_LABEL, type Status } from '../status'
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
type AgentModalProps = {
  agent: { messages: Message[] }
  title: string
  iconName: IconName
  status: Status
  renderToolCall: (args: { toolCall: ToolCall; toolMessage?: ToolMessage }) => ReactNode
  // True while the agent run is active — shows a trailing typing indicator. A real
  // model run takes seconds, so the thread can sit empty for a while after START.
  loading: boolean
  // Whether this agent can be launched directly. Handoff-only agents (reply) show no
  // START. When true, START appears in the footer too (mirrors the card) unless running.
  canStart: boolean
  onStart: () => void
  onClose: () => void
}

export const AgentModal = ({
  agent,
  title,
  iconName,
  status,
  renderToolCall,
  loading,
  canStart,
  onStart,
  onClose,
}: AgentModalProps) => {
  // Index tool result messages by toolCallId so each assistant tool call can be
  // paired with its matching `role:"tool"` result (used to surface a completed
  // saveDraft as done).
  const toolMessageByCallId = pairToolResults(agent.messages)

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
    if (Array.isArray(msg.toolCalls)) {
      for (const toolCall of msg.toolCalls) {
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

        <div className='thread'>
          {thread}
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

        {canStart && status !== 'running' && (
          <div className='modal-foot'>
            <button className='btn btn-primary' onClick={onStart}>
              START
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
