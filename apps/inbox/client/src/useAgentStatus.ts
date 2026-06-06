import { useEffect, useRef, useState } from 'react'
import type { Status, Lifecycle } from './status'
import { hasPendingApproval, type Message } from '../../core/messages'

// The subset of AG-UI agent subscriber callbacks this hook listens to.
type AgentSubscriber = {
  onRunStartedEvent?: () => void
  onRunFinalized?: () => void
  onRunFailed?: () => void
  onMessagesChanged?: () => void
}

// Derives the AgentCard status from the agent's run lifecycle plus message state.
// `awaiting_approval` (from hasPendingApproval over agent.messages) wins over
// "done"/"running" but never over a terminal "error" — see CLAUDE.md.
export function useAgentStatus(
  agent: {
    messages: Message[]
    subscribe: (s: AgentSubscriber) => { unsubscribe: () => void }
  },
  approvalNames: readonly string[]
): Status {
  const [lifecycle, setLifecycle] = useState<Lifecycle>('idle')
  const [messages, setMessages] = useState<Message[]>(agent.messages)

  // Re-sync messages when the `agent` prop changes — done DURING render (React's
  // "adjust state on a prop change" pattern), not in an effect. An effect would
  // paint a stale frame and then re-render; the render-phase reset makes React
  // discard the in-progress render before commit. `agent` is stable in practice,
  // so this normally never fires.
  const prevAgent = useRef(agent)
  if (prevAgent.current !== agent) {
    prevAgent.current = agent
    setMessages(agent.messages)
  }

  useEffect(() => {
    const { unsubscribe } = agent.subscribe({
      onRunStartedEvent: () => setLifecycle('running'),
      onRunFinalized: () => setLifecycle('done'),
      onRunFailed: () => setLifecycle('error'),
      onMessagesChanged: () => setMessages([...agent.messages]),
    })
    return () => unsubscribe()
  }, [agent])

  if (lifecycle === 'error') return 'error'
  if (hasPendingApproval(messages, approvalNames)) return 'awaiting_approval'
  return lifecycle
}
