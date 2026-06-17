import type { ReactNode } from 'react'
import { useWorkflowsConfig } from '../workflowsContext'
import { byWorkflow } from '../registryScope'
import { displayStatus } from '../lifecycleDisplay'
import { useBoard } from './useBoard'
import { useGate } from './useGate'

// The ONE place that turns a work item's approval into a rendered card: fetch the authoritative
// gate (useGate), find the workflow's HITL spec, render it. Returns the app-supplied approval
// card, or null when the run is not awaiting. The card SHAPE is workflow policy (the injected
// config.hitl[].render); the framework carries no email/draft literals.
//
// onResolved fires after approve/reject settles. RunView passes nothing, so resolving one run's
// gate leaves its sibling runs (drafts) open in the same InstanceView.
export const useGateNode = (
  id: string,
  workflowId: string,
  opts?: { onResolved?: () => void }
): ReactNode | null => {
  const config = useWorkflowsConfig()
  const hitl = byWorkflow(config.hitl, workflowId)
  const board = useBoard()
  const wi = board.items.find((i) => i.id === id)
  const display = wi ? displayStatus(wi.phase, wi.outcome) : 'running'
  const awaiting = display === 'awaiting_approval'
  const { gate, approve, reject } = useGate(id, awaiting)
  const onResolved = opts?.onResolved

  if (!awaiting || !gate) return null
  const spec = hitl.find((sp) => sp.toolName === gate.toolName)
  if (!spec) return null
  // The untrusted source the human must see beside the draft = the work item's payload.
  const source = (wi?.payload ?? {}) as Record<string, unknown>
  return spec.render({
    form: gate.form,
    formRev: gate.formRev,
    status: wi?.phase ?? 'awaiting_human',
    source,
    approve: async (form: Record<string, unknown>) => {
      await approve(form)
      onResolved?.()
    },
    reject: async (comment?: string) => {
      await reject(comment)
      onResolved?.()
    },
  })
}
