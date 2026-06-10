import { useCallback, useEffect, useState } from 'react'
import type { Gate } from '../serverTypes'

// The gate is authoritative (its form + formRev, not the stream args). Fetch it when the
// thread is awaiting approval; approve/reject POST /api/gates/:id/resolve with the gate's
// formRev. A 409 (rev moved) refetches the gate so the card re-renders against the current
// rev — never a silent failure.
export const useGate = (workItemId: string | null, awaiting: boolean) => {
  const [gate, setGate] = useState<Gate | null>(null)

  const refetch = useCallback(async (): Promise<void> => {
    if (!workItemId) return
    const res = await fetch(`/api/workitems/${workItemId}/gate`)
    setGate(res.ok ? ((await res.json()) as Gate) : null)
  }, [workItemId])

  useEffect(() => {
    if (awaiting) void refetch()
    else setGate(null)
  }, [awaiting, refetch])

  const resolve = useCallback(
    async (
      decision: 'approved' | 'rejected',
      form?: Record<string, unknown>,
      comment?: string
    ): Promise<void> => {
      if (!gate) return
      const res = await fetch(`/api/gates/${gate.id}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, formRev: gate.formRev, form, comment }),
      })
      if (res.status === 409) await refetch() // rev moved — re-render against the live gate
    },
    [gate, refetch]
  )

  return {
    gate,
    approve: (form: Record<string, unknown>) => resolve('approved', form),
    reject: (comment?: string) => resolve('rejected', undefined, comment),
  }
}
