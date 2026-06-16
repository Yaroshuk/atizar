import { useState } from 'react'
import { useBoard } from './useBoard'
import { useDispatch } from './useDispatch'

// Reset is a FULL wipe of a scope: it stops every active item AND clears every kept/finished one,
// moving them all to history (hidden, never deleted — I12). It is a destructive action, so it does
// NOTHING on its own — the button only opens a confirm. Until the human presses confirm, the board
// is untouched; Cancel leaves everything exactly as it was. (The old controller cleared terminal
// items on the first click, before any confirm — that surprise is gone.)
type ResetConfirm = { kind: 'workflow' | 'all'; count: number } | null

export type ResetController = ReturnType<typeof useResetController>

export function useResetController(activeWorkflowId: string) {
  const board = useBoard()
  const { resetWorkflow, resetAll } = useDispatch()
  const [confirm, setConfirm] = useState<ResetConfirm>(null)
  const [resettingWorkflow, setResettingWorkflow] = useState(false)
  const [resettingAll, setResettingAll] = useState(false)

  // Items a wipe will stop + clear: every row in scope. The board carries only NON-RETIRED rows
  // (the server drops superseded/reset — U7c), so a plain in-scope count is the right number; no
  // 'closed'/retired predicate is needed. This includes queued rows, which is correct — a wipe
  // cancels them too.
  const affected = (kind: 'workflow' | 'all'): number =>
    board.items.filter((w) => kind === 'all' || w.workflowId === activeWorkflowId).length

  // A click only OPENS the confirm — it never touches the board. An empty scope is a no-op.
  const request = (kind: 'workflow' | 'all'): void => {
    const count = affected(kind)
    if (count === 0) return
    setConfirm({ kind, count })
  }

  const requestResetWorkflow = () => request('workflow')
  const requestResetAll = () => request('all')
  // Cancel: close the confirm, change NOTHING.
  const cancelConfirm = () => setConfirm(null)

  // Confirmed: one server wipe op (cancel + clear, atomically server-side) — no client-side
  // cancel-then-reset composition.
  const confirmReset = async (): Promise<void> => {
    if (!confirm) return
    const { kind } = confirm
    setConfirm(null)
    const setResetting = kind === 'workflow' ? setResettingWorkflow : setResettingAll
    setResetting(true)
    try {
      if (kind === 'workflow') await resetWorkflow(activeWorkflowId)
      else await resetAll()
    } finally {
      setResetting(false)
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
