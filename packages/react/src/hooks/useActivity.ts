import { useEffect, useRef, useState } from 'react'
import type { ActivityEntry } from '../serverTypes'

export type ConnState = 'live' | 'reconnecting'

export type ActivityFeed = {
  events: ActivityEntry[]
  connection: ConnState
}

// The operator activity feed: a snapshot fetch primes history, then each SSE
// 'activity' message appends a row (the server sends the full entry as data, so
// — unlike the board — we append directly rather than refetch). The connection
// flips to 'reconnecting' on an SSE error and back to 'live' on the next open;
// EventSource auto-reconnects and we re-prime the snapshot so nothing is lost.
export const useActivity = (open: boolean): ActivityFeed => {
  const [events, setEvents] = useState<ActivityEntry[]>([])
  const [connection, setConnection] = useState<ConnState>('live')
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const prime = async (): Promise<void> => {
      const snap = (await (await fetch('/api/activity')).json()) as ActivityEntry[]
      if (!cancelled) setEvents(snap)
    }
    void prime()

    const es = new EventSource('/api/activity/stream')
    esRef.current = es
    es.addEventListener('activity', (e) => {
      const entry = JSON.parse((e as MessageEvent).data) as ActivityEntry
      setEvents((prev) => [...prev, entry])
    })
    es.addEventListener('open', () => setConnection('live'))
    es.addEventListener('error', () => {
      setConnection('reconnecting')
      // EventSource reconnects on its own; re-prime so a gap during the drop heals.
      void prime()
    })
    return () => {
      cancelled = true
      es.close()
      esRef.current = null
    }
  }, [open])

  return { events, connection }
}
