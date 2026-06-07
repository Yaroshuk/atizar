import type { ReactNode } from 'react'
import {
  pairToolResults,
  type Message,
  type ToolCall,
  type ToolMessage,
} from '../../../core/messages'

// AgentModal renders the conversation thread in an overlay panel.
//
// It receives the live `agent` (an AG-UI AbstractAgent, carrying `messages`)
// and the `renderToolCall` function returned by `useRenderToolCall()`. It walks
// `agent.messages` in order and renders:
//   - assistant text messages -> <p>
//   - assistant tool calls     -> via `renderToolCall({ toolCall, toolMessage })`
//
// This is the SAME generative-UI surface that previously lived inline in
// App.tsx, moved here verbatim so the LeadCard + ApprovalDialog render and the
// human-in-the-loop approval button keeps its live `respond` callback (sourced
// from the executing tool-call state, not from `toolMessage`).
type AgentModalProps = {
  agent: { messages: Message[] }
  title: string
  renderToolCall: (args: { toolCall: ToolCall; toolMessage?: ToolMessage }) => ReactNode
  // True while the agent run is active — shows a trailing "Working…" loader. A real
  // model run takes seconds, so the thread can sit empty for a while after START.
  loading: boolean
  onClose: () => void
}

export const AgentModal = ({ agent, title, renderToolCall, loading, onClose }: AgentModalProps) => {
  // Index tool result messages by toolCallId so each assistant tool call can be
  // paired with its matching `role:"tool"` result (used to surface a completed
  // saveDraft as done).
  const toolMessageByCallId = pairToolResults(agent.messages)

  const thread = agent.messages.flatMap((msg: Message, i: number) => {
    if (msg.role !== 'assistant') return []
    const nodes: ReactNode[] = []

    // Assistant text content -> <p>.
    if (typeof msg.content === 'string' && msg.content.length > 0) {
      nodes.push(<p key={`text-${i}`}>{msg.content}</p>)
    }

    // Assistant tool calls -> generative UI (LeadCard / ApprovalDialog).
    if (Array.isArray(msg.toolCalls)) {
      for (const toolCall of msg.toolCalls) {
        nodes.push(
          <div key={`tc-${toolCall.id}`}>
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
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.3)',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxHeight: '80vh',
          overflow: 'auto',
          background: '#fff',
          borderRadius: 12,
          padding: 20,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <strong>{title}</strong>
          <button
            onClick={onClose}
            aria-label='Close'
            style={{
              border: 0,
              background: 'transparent',
              fontSize: 20,
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <div>{thread}</div>
        {loading && (
          <div className="inbox-working">
            <span className="spinner" />
            Working…
          </div>
        )}
      </div>
    </div>
  )
}
