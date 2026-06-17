import type { ReactNode } from 'react'
import clsx from 'clsx'
import { pairToolResults, type Message, type ToolCall, type ToolMessage } from '@atizar/core'
import { isDevMode } from '../../devMode'
import { ThreadResultsContext } from '../../threadResults'
import { ThreadHandoffsContext, type ThreadHandoff } from '../../threadHandoffs'
import { Icon } from '../Icon/Icon'
import { Markdown } from '../../primitives/Markdown/Markdown'
import { IntroBubble } from './IntroBubble'
import { buildThreadItems } from '../../buildThreadItems.js'
import type { HandoffNote } from '../../hooks/useBoardNavigation'
import s from './AgentModal.module.scss'

// The MESSAGES of one run, rendered INLINE (no scroll container of its own). A run is just a span
// of messages in an instance's thread — its "← Received" origin, the source turn, text bubbles,
// generative-UI tool cards, the approval gate. It carries NO frame, NO agent name and NO Stop —
// those belong to the Agent/Instance, shown once by the surrounding InstanceView. The scroll
// container (.thread) is owned by the PARENT (InstanceView / ThreadBody) so several runs share ONE
// scroll. `intro` is AGENT-static text shown once (the parent passes it only at the very top).
export type ThreadItemsProps = {
  messages: Message[]
  renderToolCall: (args: { toolCall: ToolCall; toolMessage?: ToolMessage }) => ReactNode
  renderableToolNames: ReadonlySet<string>
  loading: boolean
  intro?: string
  gateSlot?: ReactNode
  notes: HandoffNote[]
  resolveHandoff?: (h: { targetAgentId: string; childWorkItemId: string }) => {
    name: string
    label: string
    onOpen?: () => void
  }
}

export const ThreadItems = ({
  messages,
  renderToolCall,
  renderableToolNames,
  loading,
  intro,
  gateSlot,
  notes,
  resolveHandoff,
}: ThreadItemsProps) => {
  const toolMessageByCallId = pairToolResults(messages)

  const resultsByToolName: Record<string, unknown> = {}
  for (const m of messages) {
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

  const handoffs: ThreadHandoff[] = messages
    .filter((m) => (m as { role?: string }).role === 'handoff')
    .map((m) => {
      const h = m as unknown as ThreadHandoff
      return { targetAgentId: h.targetAgentId, childWorkItemId: h.childWorkItemId, deduped: h.deduped }
    })

  const received = notes.filter((n) => n.dir === 'received')

  const incoming = messages.find(
    (m) => m.role === 'user' && typeof m.content === 'string' && m.content.length > 0
  )
  const incomingText = incoming && typeof incoming.content === 'string' ? incoming.content : ''

  const threadItems = buildThreadItems(messages, { renderableToolNames, devMode: isDevMode })
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
      // A tool with no registered card (a dispatch/data tool like route_emails, or a render
      // tool with partial args) returns null. Skip the wrapper entirely — an empty `threadItem`
      // div still consumes the thread's flex `gap`, leaving phantom blank space (esp. in dev
      // mode, where every internal tool call surfaces).
      const node = renderToolCall({
        toolCall: item.toolCall,
        toolMessage: toolMessageByCallId.get(item.toolCall.id),
      })
      return node ? (
        <div className={s.threadItem} key={item.id}>
          {node}
        </div>
      ) : null
    }
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
    <ThreadResultsContext.Provider value={resultsByToolName}>
      <ThreadHandoffsContext.Provider value={handoffs}>
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
        {intro && <IntroBubble text={intro} />}
        {thread}
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
      </ThreadHandoffsContext.Provider>
    </ThreadResultsContext.Provider>
  )
}
