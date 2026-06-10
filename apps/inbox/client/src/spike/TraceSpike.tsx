import { useEffect, useMemo, useRef, useState } from 'react'
import type { BaseEvent } from '@ag-ui/client'
import {
  foldEventsToMessages,
  pairToolResults,
  readGateOpened,
  type GateOpenedValue,
  type Message,
} from '@platform/core'

// THROWAWAY step-2 spike page. Proves: attach to a server-side run without CopilotKit,
// fold the trace, follow the live SSE tail, approve via plain POST (same tail continues).
type Status = 'running' | 'awaiting_approval' | 'done' | 'error'

const AGENT = 'lead-inbox__reply'

export const TraceSpike = () => {
  // Seed the id from the URL so a browser RELOAD re-attaches to the SAME live server-side
  // run (PASS 2: reload mid-run loses nothing). Start writes the id back into the URL.
  const [id, setId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('id')
  )
  const [status, setStatus] = useState<Status>('running')
  // Order/dedupe by seq so duplicate or out-of-order SSE delivery is harmless.
  const [bySeq, setBySeq] = useState<Map<number, BaseEvent>>(new Map())
  const esRef = useRef<EventSource | null>(null)

  const setEvent = (seq: number, event: BaseEvent) =>
    setBySeq((prev) => {
      if (prev.has(seq)) return prev
      const next = new Map(prev)
      next.set(seq, event)
      return next
    })

  const start = async () => {
    const res = await fetch('/api/dev/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: AGENT }),
    })
    const { id } = (await res.json()) as { id: string }
    window.history.replaceState(null, '', `?spike=1&id=${id}`) // survive a reload
    setId(id)
  }

  // On id: snapshot from 0 (full history → reload loses nothing), then tail from nextSeq.
  useEffect(() => {
    if (!id) return
    let cancelled = false
    void (async () => {
      const snap = (await (await fetch(`/api/workitems/${id}/trace?from=0`)).json()) as {
        status: Status
        nextSeq: number
        events: { seq: number; event: BaseEvent }[]
      }
      if (cancelled) return
      setBySeq(() => new Map(snap.events.map((e) => [e.seq, e.event])))
      setStatus(snap.status)

      const es = new EventSource(`/api/workitems/${id}/stream?from=${snap.nextSeq}`)
      esRef.current = es
      es.onmessage = (m) => setEvent(Number(m.lastEventId), JSON.parse(m.data) as BaseEvent)
      es.addEventListener('status', (m) => setStatus((m as MessageEvent).data as Status))
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
  const gate = useMemo<GateOpenedValue | null>(() => {
    for (const e of events) {
      const g = readGateOpened(e)
      if (g) return g
    }
    return null
  }, [events])

  const approve = async () => {
    if (!id) return
    await fetch(`/api/dev/workitems/${id}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approved' }),
    })
  }

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'system-ui', padding: 16 }}>
      <h1 style={{ fontSize: 18 }}>RunObserver spike — {AGENT}</h1>
      {!id ? (
        <button onClick={start}>Start reply run</button>
      ) : (
        <p>
          WorkItem <code>{id.slice(0, 8)}</code> · status: <strong>{status}</strong>
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
        {messages.map((m: Message) => (
          <ThreadRow key={m.id} message={m} toolResults={toolResults} />
        ))}
      </div>

      {status === 'awaiting_approval' && gate && (
        <div style={{ marginTop: 16, padding: 12, border: '1px solid #d97706', borderRadius: 8 }}>
          <p style={{ margin: 0 }}>
            ⏸ Awaiting approval — <strong>{gate.toolName}</strong>
          </p>
          <pre style={{ fontSize: 12, overflow: 'auto' }}>
            {JSON.stringify(gate.proposedArtifact, null, 2)}
          </pre>
          <button onClick={approve}>Approve</button>
        </div>
      )}
    </div>
  )
}

type ThreadRowProps = {
  message: Message
  toolResults: ReturnType<typeof pairToolResults>
}

const ThreadRow = ({ message, toolResults }: ThreadRowProps) => {
  if (message.role !== 'assistant') return null
  return (
    <div>
      {typeof message.content === 'string' && message.content && (
        <div style={{ background: '#f3f4f6', borderRadius: 8, padding: '8px 12px' }}>
          {message.content}
        </div>
      )}
      {Array.isArray(message.toolCalls) &&
        message.toolCalls.map((tc) => (
          <div key={tc.id} style={{ fontSize: 13, color: '#374151', marginTop: 4 }}>
            🔧 <strong>{tc.function.name}</strong> — {toolResults.has(tc.id) ? 'done' : 'running'}
          </div>
        ))}
    </div>
  )
}
