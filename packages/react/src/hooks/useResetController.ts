import { useState } from 'react'
import { useDispatch } from './useDispatch'

// Reset clears FINISHED items from the live board (hidden, never deleted — I12). The server
// leaves ACTIVE/awaiting items untouched and reports their count. This controller turns that
// count into an explicit human gate: if a reset would leave in-progress / awaiting-approval
// work behind, it surfaces a confirm ("This cancels N in-progress / awaiting-approval items");
// on confirm it cancels that scope FIRST, then resets again so the now-terminal items clear.
// Mirrors useStopController's shape (confirm state + per-scope resetting flags).
type Pending = { kind: 'workflow' } | { kind: 'all' } | null
type ResetConfirm = { kind: 'workflow' | 'all'; active: number } | null

export type ResetController = ReturnType<typeof useResetController>

export function useResetController(activeWorkflowId: string) {
  const { resetWorkflow, resetAll, cancelWorkflow, cancelAll } = useDispatch()
  const [confirm, setConfirm] = useState<ResetConfirm>(null)
  // The scope awaiting a confirmed cancel-then-reset (set alongside `confirm`).
  const [pending, setPending] = useState<Pending>(null)
  const [resettingWorkflow, setResettingWorkflow] = useState(false)
  const [resettingAll, setResettingAll] = useState(false)

  const runReset = (kind: 'workflow' | 'all'): Promise<{ reset: number; active: number }> =>
    kind === 'workflow' ? resetWorkflow(activeWorkflowId) : resetAll()

  const setResetting = (kind: 'workflow' | 'all', v: boolean): void =>
    kind === 'workflow' ? setResettingWorkflow(v) : setResettingAll(v)

  // First click: reset the terminal items. This first reset is UNCONDITIONAL — it clears
  // terminal (finished/result/error) items immediately, with no confirm; the ConfirmDialog gate
  // only governs whether to ALSO cancel any in-flight / awaiting work the server reports remain.
  // If the server reports active/awaiting items remain, open the confirm gate instead of touching them.
  const request = async (kind: 'workflow' | 'all'): Promise<void> => {
    setResetting(kind, true)
    try {
      const { active } = await runReset(kind)
      if (active > 0) {
        setPending({ kind })
        setConfirm({ kind, active })
      }
    } finally {
      setResetting(kind, false)
    }
  }

  const requestResetWorkflow = () => void request('workflow')
  const requestResetAll = () => void request('all')
  const cancelConfirm = () => {
    setConfirm(null)
    setPending(null)
  }

  // Confirmed: cancel the scope's in-flight work, then reset again to clear the now-terminal items.
  const confirmReset = async (): Promise<void> => {
    if (!pending) return
    const { kind } = pending
    setConfirm(null)
    setPending(null)
    setResetting(kind, true)
    try {
      if (kind === 'workflow') await cancelWorkflow(activeWorkflowId)
      else await cancelAll()
      await runReset(kind)
    } finally {
      setResetting(kind, false)
    }
  }

  return {
    confirm,
    resettingWorkflow,
    resettingAll,
    requestResetWorkflow,
    requestResetAll,
    cancelConfirm,
    confirmReset,
  }
}
