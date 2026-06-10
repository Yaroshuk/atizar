import { useCallback } from 'react'
import type { Destination } from '@platform/core'

// The act surface: every mutation is a plain HTTP POST (no CopilotKit transport).
//   start  — the human-initiated START gesture on an input agent card
//   deliver — a human-gated handoff from a rendered card (server resolves the Destination)
//   cancel / cancelWorkflow — Stop a work item / a whole workflow
export const useDispatch = () => {
  const start = useCallback(async (agentKey: string): Promise<string> => {
    const res = await fetch('/api/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: agentKey }),
    })
    const { id } = (await res.json()) as { id: string }
    return id
  }, [])

  const deliver = useCallback(
    async (
      origin: string,
      dest: Destination,
      payload: unknown,
      parentId: string
    ): Promise<void> => {
      await fetch('/api/deliver', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ origin, dest, payload, parentId }),
      })
    },
    []
  )

  const cancel = useCallback(async (id: string): Promise<void> => {
    await fetch(`/api/workitems/${id}/cancel`, { method: 'POST' })
  }, [])

  const cancelWorkflow = useCallback(async (id: string): Promise<void> => {
    await fetch(`/api/workflows/${id}/cancel`, { method: 'POST' })
  }, [])

  return { start, deliver, cancel, cancelWorkflow }
}
