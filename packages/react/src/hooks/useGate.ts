import { useCallback, useEffect, useState } from 'react'
import type { Gate } from '../serverTypes'
import { useWorkflowsConfig } from '../workflowsContext'
import { authHeaders } from '../authHeaders'

// The gate is authoritative (its form + formRev, not the stream args). Fetch it when the
// thread is awaiting approval; approve/reject POST /api/gates/:id/resolve with the gate's
// formRev. A 409 (rev moved) refetches the gate so the card re-renders against the current
// rev — never a silent failure.
export const useGate = (workItemId: string | null, awaiting: boolean) => {
  const [gate, setGate] = useState<Gate | null>(null)
  const { authToken } = useWorkflowsConfig()

  const refetch = useCallback(async (): Promise<void> => {
    if (!workItemId) return
    const res = await fetch(`/api/workitems/${workItemId}/gate`)
    setGate(res.ok ? ((await res.json()) as Gate) : null)
  }, [workItemId])

  // Fetch the gate when the run reaches approval. The setState lives after an `await` (not a
  // synchronous in-effect set); the consumer guards rendering on `awaiting`, and a fresh work
  // item remounts this hook (gate starts null).
  useEffect(() => {
    if (!awaiting || !workItemId) return
    let cancelled = false
    void (async () => {
      const res = await fetch(`/api/workitems/${workItemId}/gate`)
      if (cancelled) return
      setGate(res.ok ? ((await res.json()) as Gate) : null)
    })()
    return () => {
      cancelled = true
    }
  }, [awaiting, workItemId])

  const resolve = useCallback(
    async (
      decision: 'approved' | 'rejected',
      form?: Record<string, unknown>,
      comment?: string
    ): Promise<void> => {
      if (!gate) return
      const res = await fetch(`/api/gates/${gate.id}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders(authToken) },
        body: JSON.stringify({ decision, formRev: gate.formRev, form, comment }),
      })
      if (res.status === 409) await refetch() // rev moved — re-render against the live gate
    },
    [gate, refetch, authToken]
  )

  return {
    gate,
    approve: (form: Record<string, unknown>) => resolve('approved', form),
    reject: (comment?: string) => resolve('rejected', undefined, comment),
  }
}
