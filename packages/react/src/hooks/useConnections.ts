import { useCallback, useEffect, useState } from 'react'

// The shape returned by GET /api/connections. `detail` is optional — the server may omit
// it (e.g. before a profile lookup), so the chip renders fine without it.
export interface ConnectionStatus {
  integration: string
  connection: string
  provider: string
  connected: boolean
  detail?: string
}

// Connections are server-authoritative: fetch the snapshot, refetch on window focus (the
// OAuth redirect lands back in a new tab/focus) and whenever a caller asks via `refetch`.
export const useConnections = (): { connections: ConnectionStatus[]; refetch: () => void } => {
  const [connections, setConnections] = useState<ConnectionStatus[]>([])

  const refetch = useCallback((): void => {
    void (async () => {
      const r = (await (await fetch('/api/connections')).json()) as ConnectionStatus[]
      setConnections(r)
    })()
  }, [])

  useEffect(() => {
    refetch()
    // The OAuth callback redirects back with ?connected= (or ?connect_error=). Refetch to
    // pick up the new state, then strip the params so they don't linger across reloads.
    const params = new URLSearchParams(window.location.search)
    if (params.has('connected') || params.has('connect_error')) {
      params.delete('connected')
      params.delete('connect_error')
      const url = new URL(window.location.href)
      url.search = params.toString()
      window.history.replaceState(null, '', url)
    }
    const onFocus = (): void => refetch()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refetch])

  return { connections, refetch }
}
