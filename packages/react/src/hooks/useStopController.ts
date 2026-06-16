import { useState } from 'react'
import { useBoard } from './useBoard'
import { useDispatch } from './useDispatch'

// Every Stop scope confirms before halting in-flight work.
// Matches WorkflowBoard.tsx:41 (Confirm type).
type Confirm = { kind: 'item'; id: string } | { kind: 'workflow' } | { kind: 'all' } | null

export type StopController = ReturnType<typeof useStopController>

// Extracts WorkflowBoard.tsx:62-68 (confirm + stopping state) and :156-181 (confirmStop).
export function useStopController(activeWorkflowId: string) {
  const board = useBoard()
  const { cancel, cancelWorkflow, cancelAll, cancelInstance } = useDispatch()
  const [confirm, setConfirm] = useState<Confirm>(null)
  // In-flight Stop state (per item + the two bulk scopes), for the stopping… spinner.
  const [stoppingItems, setStoppingItems] = useState<Record<string, boolean>>({})
  const [stoppingWorkflow, setStoppingWorkflow] = useState(false)
  const [stoppingAll, setStoppingAll] = useState(false)

  const requestStopItem = (id: string) => setConfirm({ kind: 'item', id })
  const requestStopWorkflow = () => setConfirm({ kind: 'workflow' })
  const requestStopAll = () => setConfirm({ kind: 'all' })
  const cancelConfirm = () => setConfirm(null)

  // --- Stop (all three scopes confirm first via the modal) ---
  // Matches WorkflowBoard.tsx:156-181 exactly.
  const confirmStop = async (): Promise<void> => {
    if (!confirm) return
    if (confirm.kind === 'item') {
      const { id } = confirm
      setStoppingItems((m) => ({ ...m, [id]: true }))
      setConfirm(null)
      // The unit of Stop is the INSTANCE: resolve this Run's work item to its
      // (workflowId, agentId, key) and cancel every Run of that instance (the server cascades to
      // children). If the item can't be resolved, fall back to stopping just this Run.
      const item = board.items.find((w) => w.id === id)
      if (item) await cancelInstance(item.workflowId, item.agentId, item.key)
      else await cancel(id)
      setStoppingItems((m) => {
        const rest = { ...m }
        delete rest[id]
        return rest
      })
      return
    }
    if (confirm.kind === 'workflow') {
      setStoppingWorkflow(true)
      await cancelWorkflow(activeWorkflowId)
      setStoppingWorkflow(false)
    } else {
      setStoppingAll(true)
      await cancelAll()
      setStoppingAll(false)
    }
    setConfirm(null)
  }

  return {
    confirm,
    stoppingItems,
    stoppingWorkflow,
    stoppingAll,
    requestStopItem,
    requestStopWorkflow,
    requestStopAll,
    cancelConfirm,
    confirmStop,
  }
}
