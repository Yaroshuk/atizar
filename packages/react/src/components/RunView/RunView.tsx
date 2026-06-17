import { useMemo } from 'react'
import type { Destination } from '@atizar/core'
import { useWorkItemThread } from '../../hooks/useWorkItemThread'
import { useGateNode } from '../../hooks/useGateNode'
import { useAcknowledge } from '../../hooks/useAcknowledge'
import { buildRenderToolCall } from '../../buildRenderToolCall'
import { useWorkflowsConfig } from '../../workflowsContext'
import { byWorkflow } from '../../registryScope'
import { displayStatus } from '../../lifecycleDisplay'
import { lookups } from '../../lookups'
import { useBoard } from '../../hooks/useBoard'
import { ThreadItems } from '../AgentModal/ThreadItems'
import { AcknowledgeButton } from './AcknowledgeButton'
import type { HandoffNote } from '../../hooks/useBoardNavigation'

// RunView = the MESSAGES of one run (one email → one draft), rendered INLINE into the instance's
// shared thread. A run is not a visual container: NO frame, NO agent name, NO status, NO Stop —
// those belong to the Agent/Instance (shown once by InstanceView). It owns only its per-id data
// (the thread stream + the approval gate) and emits its messages: the "← Received" origin, the
// agent's text/tool cards, and the approval gate card. Resolving the gate updates in place
// (useGateNode without onResolved) — sibling runs stay open.
export type RunViewProps = {
  id: string
  workflowId: string
  renderableToolNames: ReadonlySet<string>
  notes: HandoffNote[]
  deliver: (origin: string, dest: Destination, payload: unknown, parentId: string) => void
  onOpenWorkflow?: (id: string) => void
  onOpenInstance?: (localId: string) => void
}

export const RunView = (p: RunViewProps) => {
  const config = useWorkflowsConfig()
  const { messages } = useWorkItemThread(p.id)
  const board = useBoard()
  const wi = board.items.find((i) => i.id === p.id)
  const display = wi ? displayStatus(wi.phase, wi.outcome) : 'running'

  const gateNode = useGateNode(p.id, p.workflowId)
  const { acknowledge } = useAcknowledge()
  const ackSlot =
    display === 'error' ? (
      <AcknowledgeButton onAcknowledge={() => void acknowledge(p.id)} />
    ) : undefined

  const { deliver, id, workflowId } = p
  const renderToolCall = useMemo(
    () =>
      buildRenderToolCall(byWorkflow(config.renders, workflowId), (origin, dest, payload) =>
        deliver(origin, dest, payload, id)
      ),
    [config.renders, workflowId, deliver, id]
  )

  const { defOf, labelOf } = lookups(config, p.workflowId)
  const resolveHandoff = useMemo(
    () => (h: { targetAgentId: string; childWorkItemId: string }) => {
      const child = board.items.find((w) => w.id === h.childWorkItemId)
      const childWorkflowId = child?.workflowId ?? p.workflowId
      const bareAgentId = h.targetAgentId.includes('__')
        ? h.targetAgentId.slice(h.targetAgentId.indexOf('__') + 2)
        : h.targetAgentId
      const name = defOf(childWorkflowId, bareAgentId)?.name ?? h.targetAgentId
      const label = child ? labelOf(child) : h.childWorkItemId
      const onOpen =
        child && childWorkflowId !== p.workflowId
          ? () => p.onOpenWorkflow?.(childWorkflowId)
          : child
            ? () => p.onOpenInstance?.(child.id)
            : undefined
      return { name, label, onOpen }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board.items, defOf, labelOf, p.workflowId, p.onOpenWorkflow, p.onOpenInstance]
  )

  return (
    <ThreadItems
      messages={messages}
      renderToolCall={renderToolCall}
      renderableToolNames={p.renderableToolNames}
      loading={display === 'running'}
      gateSlot={gateNode ?? undefined}
      ackSlot={ackSlot}
      notes={p.notes}
      resolveHandoff={resolveHandoff}
    />
  )
}
