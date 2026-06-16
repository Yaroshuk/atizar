import { useCallback } from 'react'
import type { Destination } from '@atizar/core'
import { useWorkflowsConfig } from '../workflowsContext'
import { authHeaders } from '../authHeaders'

// The act surface: every mutation is a plain HTTP POST (no CopilotKit transport).
//   start  — the human-initiated START gesture on an input agent card
//   deliver — a human-gated handoff from a rendered card (server resolves the Destination)
//   cancel / cancelWorkflow — Stop a work item / a whole workflow
// Each mutation carries the shared bearer token (if configured) so a deployed instance with
// ATIZAR_AUTH_TOKEN set accepts it; unset ⇒ no header (server is fail-open / demo-disabled).
export const useDispatch = () => {
  const { authToken } = useWorkflowsConfig()

  const start = useCallback(
    async (agentKey: string): Promise<string> => {
      const res = await fetch('/api/dispatch', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders(authToken) },
        body: JSON.stringify({ agent: agentKey }),
      })
      if (!res.ok) throw new Error(`dispatch failed: ${res.status}`)
      const { id } = (await res.json()) as { id: string }
      return id
    },
    [authToken]
  )

  const deliver = useCallback(
    async (
      origin: string,
      dest: Destination,
      payload: unknown,
      parentId: string
    ): Promise<void> => {
      await fetch('/api/deliver', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders(authToken) },
        body: JSON.stringify({ origin, dest, payload, parentId }),
      })
    },
    [authToken]
  )

  const cancel = useCallback(
    async (id: string): Promise<void> => {
      await fetch(`/api/workitems/${id}/cancel`, {
        method: 'POST',
        headers: authHeaders(authToken),
      })
    },
    [authToken]
  )

  const cancelWorkflow = useCallback(
    async (id: string): Promise<void> => {
      await fetch(`/api/workflows/${id}/cancel`, {
        method: 'POST',
        headers: authHeaders(authToken),
      })
    },
    [authToken]
  )

  // Emergency brake: halt every active item across ALL workflows.
  const cancelAll = useCallback(async (): Promise<void> => {
    await fetch('/api/cancel-all', { method: 'POST', headers: authHeaders(authToken) })
  }, [authToken])

  // WIPE a workflow: a single server op that cancels every active item AND clears every kept/
  // terminal one, moving them all to history (hidden, never deleted — I12). Returns how many rows
  // were wiped. (The old two-step cancel+reset composition is gone — the server does it atomically.)
  const resetWorkflow = useCallback(
    async (id: string): Promise<{ reset: number }> => {
      const res = await fetch(`/api/workflows/${id}/reset`, {
        method: 'POST',
        headers: authHeaders(authToken),
      })
      if (!res.ok) throw new Error(`reset failed: ${res.status}`)
      const { reset } = (await res.json()) as { reset: number }
      return { reset }
    },
    [authToken]
  )

  // Wipe ALL workflows ("reset all"). Same contract as resetWorkflow.
  const resetAll = useCallback(async (): Promise<{ reset: number }> => {
    const res = await fetch('/api/reset-all', { method: 'POST', headers: authHeaders(authToken) })
    if (!res.ok) throw new Error(`reset-all failed: ${res.status}`)
    const { reset } = (await res.json()) as { reset: number }
    return { reset }
  }, [authToken])

  return { start, deliver, cancel, cancelWorkflow, cancelAll, resetWorkflow, resetAll }
}
