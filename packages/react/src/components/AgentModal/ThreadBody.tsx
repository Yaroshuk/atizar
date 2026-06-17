import type { ReactNode } from 'react'
import type { Message, ToolCall, ToolMessage } from '@atizar/core'
import { ThreadItems } from './ThreadItems'
import type { HandoffNote } from '../../hooks/useBoardNavigation'
import s from './AgentModal.module.scss'

// ThreadBody = a scrollable thread container around a single run's ThreadItems. Used by the idle
// type-view (AgentModal). A live INSTANCE's thread owns its OWN scroll container and stacks one
// ThreadItems per run inside it (see InstanceView) — so it does not use ThreadBody.
export type ThreadBodyProps = {
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

export const ThreadBody = (p: ThreadBodyProps) => (
  <div className={s.thread}>
    <ThreadItems {...p} />
  </div>
)
