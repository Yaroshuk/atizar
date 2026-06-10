import { useEffect, useMemo, useRef, useState } from 'react'
import type { BaseEvent } from '@ag-ui/client'
import { foldEventsToMessages, pairToolResults } from '@platform/core'
import type { ServerStatus } from '../serverTypes'

// Attach to a server-side run WITHOUT CopilotKit: snapshot the trace from 0 (so a reload
// loses nothing), then follow the live SSE tail from nextSeq, ordering/deduping by seq.
// `foldEventsToMessages` is the reduction CopilotKit's runtime used to do internally.
export const useWorkItemThread = (id: string | null) => {
  const [status, setStatus] = useState<ServerStatus>('running')
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
        status: ServerStatus
        nextSeq: number
        events: { seq: number; event: BaseEvent }[]
      }
      if (cancelled) return
      setBySeq(new Map(snap.events.map((e) => [e.seq, e.event])))
      setStatus(snap.status)
      const es = new EventSource(`/api/workitems/${id}/stream?from=${snap.nextSeq}`)
      esRef.current = es
      es.onmessage = (m) => setEvent(Number(m.lastEventId), JSON.parse(m.data) as BaseEvent)
      es.addEventListener('status', (m) => setStatus((m as MessageEvent).data as ServerStatus))
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
  return { messages, toolResults, status }
}
