import { useMemo } from 'react'
import type { Destination } from '@atizar/core'
import { useWorkItemThread } from '../../hooks/useWorkItemThread'
import { useGate } from '../../hooks/useGate'
import { buildRenderToolCall } from '../../buildRenderToolCall'
import { useWorkflowsConfig } from '../../workflowsContext'
import { byWorkflow } from '../../registryScope'
import { displayStatus } from '../../lifecycleDisplay'
import { lookups } from '../../lookups'
import { AgentModal, type HandoffNote } from '../AgentModal/AgentModal'
import type { IconName } from '../Icon/Icon'
import { useBoard } from '../../hooks/useBoard'

// One open work item: owns the per-id thread + gate hooks and renders AgentModal. The thread
// is folded from the server trace (live SSE tail); the approval card is rendered from the
// authoritative gate (not the stream args), approve/reject POSTing via useGate. AgentModal
// already pairs tool results + provides ThreadResultsContext from `agent.messages`.
export type ThreadModalProps = {
  id: string
  // The workflow this work item belongs to. Render/HITL resolution is scoped to it so two
  // workflows' same-named tools resolve to the right component (see registryScope.byWorkflow).
  workflowId: string
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
  const config = useWorkflowsConfig()
  const hitl = byWorkflow(config.hitl, p.workflowId)
  const { messages, status, connection } = useWorkItemThread(p.id)
  // The board is the shared, server-authoritative snapshot — read this item's (phase, outcome)
  // for the display Status + the terminal-flavour outcome (Stopped/Rejected on the header). The
  // thread hook's `status` is the raw phase word published over SSE (gateSlot below passes it on).
  const board = useBoard()
  const wi = board.items.find((i) => i.id === p.id)
  const display = wi ? displayStatus(wi.phase, wi.outcome) : 'running'
  const awaiting = display === 'awaiting_approval'
  const { gate, approve, reject } = useGate(p.id, awaiting)
  // The untrusted source the human must see beside the draft = the open work item's payload
  // (what the agent received).
  const source = (wi?.payload ?? {}) as Record<string, unknown>

  // The handoff seam: a card's deliver call carries the open work item as the parent.
  const { deliver, id, workflowId } = p
  const renderToolCall = useMemo(
    () =>
      buildRenderToolCall(byWorkflow(config.renders, workflowId), (origin, dest, payload) =>
        deliver(origin, dest, payload, id)
      ),
    [config.renders, workflowId, deliver, id]
  )

  // Once the human acts on the gate, the thread has served its purpose — close it (the result
  // stays on the board/history, I12). Without this the resolved card lingered and the human had
  // to close it by hand.
  const approveAndClose = async (form: Record<string, unknown>) => {
    await approve(form)
    p.onClose()
  }
  const rejectAndClose = async (comment?: string) => {
    await reject(comment)
    p.onClose()
  }

  // Render the workflow's approval card from the authoritative gate (only while awaiting).
  const gateSlot =
    awaiting &&
    gate &&
    (() => {
      const spec = hitl.find((s) => s.toolName === gate.toolName)
      if (!spec) return null
      return spec.render({
        form: gate.form,
        formRev: gate.formRev,
        status,
        source,
        approve: approveAndClose,
        reject: rejectAndClose,
      })
    })()

  // Resolve display name/label + open affordance for an inline handoff item (Task 5).
  // targetAgentId is in wf__agent format; childWorkItemId is the spawned work item's id.
  // We look up the child in the board to get its workflowId and payload (for the label),
  // then use defOf to get the agent display name (cross-workflow aware).
  const { defOf, labelOf } = lookups(config, p.workflowId)
  const resolveHandoff = useMemo(
    () => (h: { targetAgentId: string; childWorkItemId: string }) => {
      const child = board.items.find((w) => w.id === h.childWorkItemId)
      const childWorkflowId = child?.workflowId ?? p.workflowId
      // targetAgentId from runObserver is the BARE id (e.g. 'reply') — not the namespaced
      // 'wf__agent' form. Use the '__' separator to handle both bare and namespaced ids.
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
    <AgentModal
      agent={{ messages }}
      title={p.title}
      iconName={p.iconName}
      status={display}
      outcome={wi?.outcome}
      connection={connection}
      renderToolCall={renderToolCall}
      renderableToolNames={p.renderableToolNames}
      loading={display === 'running'}
      canStart={p.canStart}
      intro={p.intro}
      gateSlot={gateSlot || undefined}
      notes={p.notes}
      resolveHandoff={resolveHandoff}
      onStart={p.onStart}
      onStop={() => p.onStop(p.id)}
      onClose={p.onClose}
    />
  )
}
