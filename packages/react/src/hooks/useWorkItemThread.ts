import { useEffect, useMemo, useRef, useState } from 'react'
import type { BaseEvent } from '@ag-ui/client'
import { foldEventsToMessages, pairToolResults } from '@atizar/core'
import type { Phase } from '../serverTypes'
import type { ConnState } from './useActivity'

// Terminal statuses: the run is over and the server emits no further events. The server CLOSES
// the per-item SSE once a run reaches one of these (after replaying its backlog). The browser's
// EventSource auto-reconnects on any server close, so without this guard a finished run's stream
// gets reopened in a tight loop — a reconnect STORM that exhausts the ~6-connections-per-host
// budget and starves the other streams (the board, and any newly-opened live thread, whose tail
// events then never arrive → its render cards silently never appear). awaiting_human is NOT
// terminal — the stream stays open to deliver resume events post-gate. The SSE now publishes the
// PHASE word (U7), so the run is over only at the single terminal phase.
const TERMINAL: ReadonlySet<Phase> = new Set(['terminal'])

// Attach to a server-side run WITHOUT CopilotKit: snapshot the trace from 0 (so a reload
// loses nothing), then follow the live SSE tail from nextSeq, ordering/deduping by seq.
// `foldEventsToMessages` is the reduction CopilotKit's runtime used to do internally.
export const useWorkItemThread = (id: string | null) => {
  const [status, setStatus] = useState<Phase>('active')
  const [connection, setConnection] = useState<ConnState>('live')
  const [bySeq, setBySeq] = useState<Map<number, BaseEvent>>(new Map())
  const esRef = useRef<EventSource | null>(null)

  const setEvent = (seq: number, event: BaseEvent): void =>
    setBySeq((prev) => {
      if (prev.has(seq)) return prev
      const next = new Map(prev)
      next.set(seq, event)
      return next
    })

  // Note: this hook assumes a fresh mount per work item id (the consumer keys the thread
  // component by id), so there is no synchronous in-effect reset of accumulated events.
  useEffect(() => {
    if (!id) return
    let cancelled = false
    void (async () => {
      const snap = (await (await fetch(`/api/workitems/${id}/trace?from=0`)).json()) as {
        status: Phase
        done: boolean
        nextSeq: number
        events: { seq: number; event: BaseEvent }[]
      }
      if (cancelled) return
      setBySeq(new Map(snap.events.map((e) => [e.seq, e.event])))
      setStatus(snap.status)
      // The run is already terminal: the snapshot IS the whole trace, there is nothing to tail.
      // Opening an SSE here would hit the server's immediate close → auto-reconnect storm.
      if (snap.done) return
      const es = new EventSource(`/api/workitems/${id}/stream?from=${snap.nextSeq}`)
      esRef.current = es
      es.addEventListener('open', () => setConnection('live'))
      es.addEventListener('error', () => {
        // A dropped thread stream must NOT look frozen-but-live (the human could approve against
        // a stale view). EventSource auto-reconnects; re-prime the trace so a gap during the drop
        // heals, and flip the chip. (Mirror of useActivity's reconnect handling.)
        setConnection('reconnecting')
        void (async () => {
          const full = (await (await fetch(`/api/workitems/${id}/trace?from=0`)).json()) as {
            events: { seq: number; event: BaseEvent }[]
          }
          if (!cancelled) setBySeq(new Map(full.events.map((e) => [e.seq, e.event])))
        })()
      })
      es.onmessage = (m) => setEvent(Number(m.lastEventId), JSON.parse(m.data) as BaseEvent)
      es.addEventListener('status', (m) => {
        const next = (m as MessageEvent).data as Phase
        setStatus(next)
        if (!TERMINAL.has(next)) return
        // The run just reached a terminal state; the server closes the stream now. Two things:
        // (1) close our side so the browser does NOT auto-reconnect to a finished run — that
        //     reconnect loop is a storm that exhausts the connection pool and starves other
        //     streams; (2) the live tail can race the server's stream-close (the backlog flush
        //     and the terminal-close interleave server-side), so reconcile against the
        //     authoritative complete trace before stopping — otherwise tail events (e.g. the
        //     final renderVerdict tool call) can be silently missing.
        esRef.current?.close()
        esRef.current = null
        void (async () => {
          const full = (await (await fetch(`/api/workitems/${id}/trace?from=0`)).json()) as {
            events: { seq: number; event: BaseEvent }[]
          }
          if (!cancelled) setBySeq(new Map(full.events.map((e) => [e.seq, e.event])))
        })()
      })
    })()
    return () => {
      cancelled = true
      esRef.current?.close()
    }
  }, [id])

  const events = useMemo(
    () => [...bySeq.entries()].sort((a, b) => a[0] - b[0]).map(([, e]) => e),
    [bySeq]
  )
  const messages = useMemo(() => foldEventsToMessages(events), [events])
  const toolResults = useMemo(() => pairToolResults(messages), [messages])
  return { messages, toolResults, status, connection }
}
