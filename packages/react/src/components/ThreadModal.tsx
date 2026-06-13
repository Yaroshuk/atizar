import { useMemo } from 'react'
import type { Destination } from '@atizar/core'
import { useWorkItemThread } from '../hooks/useWorkItemThread'
import { useGate } from '../hooks/useGate'
import { buildRenderToolCall } from '../buildRenderToolCall'
import { useWorkflowsConfig } from '../workflowsContext'
import { mapStatus } from '../status'
import { AgentModal, type HandoffNote } from './AgentModal'
import type { IconName } from './Icon'

// One open work item: owns the per-id thread + gate hooks and renders AgentModal. The thread
// is folded from the server trace (live SSE tail); the approval card is rendered from the
// authoritative gate (not the stream args), approve/reject POSTing via useGate. AgentModal
// already pairs tool results + provides ThreadResultsContext from `agent.messages`.
export type ThreadModalProps = {
  id: string
  title: string
  iconName: IconName
  intro: string
  canStart: boolean
  renderableToolNames: ReadonlySet<string>
  notes: HandoffNote[]
  deliver: (origin: string, dest: Destination, payload: unknown, parentId: string) => void
  onStart: () => void
  onStop: (id: string) => void
  onClose: () => void
  onOpenWorkflow?: (id: string) => void
  onOpenInstance?: (localId: string) => void
}

export const ThreadModal = (p: ThreadModalProps) => {
  const { renders, hitl } = useWorkflowsConfig()
  const { messages, status } = useWorkItemThread(p.id)
  const display = mapStatus(status)
  const awaiting = display === 'awaiting_approval'
  const { gate, approve, reject } = useGate(p.id, awaiting)

  // The handoff seam: a card's deliver call carries the open work item as the parent.
  const { deliver, id } = p
  const renderToolCall = useMemo(
    () =>
      buildRenderToolCall(renders, (origin, dest, payload) => deliver(origin, dest, payload, id)),
    [renders, deliver, id]
  )

  // Render the workflow's approval card from the authoritative gate (only while awaiting).
  const gateSlot =
    awaiting &&
    gate &&
    (() => {
      const spec = hitl.find((s) => s.toolName === gate.toolName)
      if (!spec) return null
      return spec.render({ form: gate.form, formRev: gate.formRev, status, approve, reject })
    })()

  return (
    <AgentModal
      agent={{ messages }}
      title={p.title}
      iconName={p.iconName}
      status={display}
      renderToolCall={renderToolCall}
      renderableToolNames={p.renderableToolNames}
      loading={display === 'running'}
      canStart={p.canStart}
      intro={p.intro}
      gateSlot={gateSlot || undefined}
      notes={p.notes}
      onOpenWorkflow={p.onOpenWorkflow}
      onOpenInstance={p.onOpenInstance}
      onStart={p.onStart}
      onStop={() => p.onStop(p.id)}
      onClose={p.onClose}
    />
  )
}
