import { useEffect, useState } from 'react'
import type { AgentHealth } from '../serverTypes'

// Credential health, fetched fresh. The board snapshot carries a BOOT-time agentHealth
// cache that goes stale the moment a connection changes (connect/disconnect) — so the
// cards would wrongly say "not connected" after you just connected. This hook hits
// GET /api/health (which recomputes by resolving credentials live) on mount AND on window
// focus (the OAuth redirect lands back on focus), giving the cards the current truth.
export const useHealth = (): Record<string, AgentHealth> => {
  const [health, setHealth] = useState<Record<string, AgentHealth>>({})

  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      void (async () => {
        try {
          const h = (await (await fetch('/api/health')).json()) as Record<string, AgentHealth>
          if (!cancelled) setHealth(h)
        } catch {
          // Network failure — keep the last good health.
        }
      })()
    }
    load()
    const onFocus = (): void => load()
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  return health
}
