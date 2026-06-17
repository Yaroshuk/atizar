import { useCallback } from 'react'
import { useWorkflowsConfig } from '../workflowsContext'
import { authHeaders } from '../authHeaders'

// Acknowledge an errored run ("OK / Got it"): a plain HTTP POST (no body), the error-analogue of
// a gate resolve. The server settles the run off `error` → `dismissed`, so the instance recedes
// from the live UI (displayStatus no longer yields 'error' → isLive = false). Mirrors cancel in
// useDispatch: same URL pattern, same auth header, no JSON body.
export const useAcknowledge = () => {
  const { authToken } = useWorkflowsConfig()
  const acknowledge = useCallback(
    async (id: string): Promise<void> => {
      await fetch(`/api/workitems/${id}/acknowledge`, {
        method: 'POST',
        headers: authHeaders(authToken),
      })
    },
    [authToken]
  )
  return { acknowledge }
}
