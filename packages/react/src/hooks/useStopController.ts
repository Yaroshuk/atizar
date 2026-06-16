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

  // Resolve a Run's localId to its instance and stop the WHOLE instance (server cascades to
  // children); fall back to a per-Run cancel if the item isn't on the board (raced eviction).
  const stopInstanceById = async (id: string): Promise<void> => {
    const w = board.items.find((x) => x.id === id)
    if (w) await cancelInstance(w.workflowId, w.agentId, w.key)
    else await cancel(id)
  }

  // --- Stop (all three scopes confirm first via the modal) ---
  // Matches WorkflowBoard.tsx:156-181 exactly.
  const confirmStop = async (): Promise<void> => {
    if (!confirm) return
    if (confirm.kind === 'item') {
      const { id } = confirm
      setStoppingItems((m) => ({ ...m, [id]: true }))
      setConfirm(null)
      await stopInstanceById(id)
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

  // Asymmetry: pipeline/grid item-Stop is confirm-gated (requestStopItem → confirm → confirmStop);
  // the open-thread Stop fires immediately via stopInstance (an already-open thread needs no second confirm).
  const stopInstance = (id: string): Promise<void> => stopInstanceById(id)

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
    stopInstance,
  }
}
