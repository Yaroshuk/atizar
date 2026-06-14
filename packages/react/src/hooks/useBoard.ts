import { useSyncExternalStore } from 'react'
import type { Board } from '../serverTypes'

// The board is server-authoritative AND shared. Several consumers call useBoard() in one tree —
// useWorkflowSelection, useBoardNavigation, and the demo's board composition. A per-call
// EventSource would open ONE /api/board/stream per caller (3+) and refetch the snapshot 3× on
// every poke, needlessly burning the browser's ~6-connections-per-host budget (which, combined
// with the per-item thread stream, can starve other SSE). So the subscription is a SINGLE
// module-level singleton, ref-counted across callers: one stream, one refetch per poke, shared
// snapshot. On ANY board SSE message we refetch the snapshot (coarse model — the SSE is just a
// poke, the snapshot is the truth), so duplicate/out-of-order pokes, reconnects, and a second
// tab are all harmless.
const EMPTY: Board = { items: [], gates: [], lastEventId: 0, agentHealth: {} }

let current: Board = EMPTY
let es: EventSource | null = null
let refCount = 0
const listeners = new Set<() => void>()

const refetch = async (): Promise<void> => {
  const b = (await (await fetch('/api/board')).json()) as Board
  current = b
  for (const l of listeners) l()
}

const subscribe = (onChange: () => void): (() => void) => {
  listeners.add(onChange)
  refCount += 1
  if (refCount === 1) {
    void refetch()
    es = new EventSource('/api/board/stream')
    es.addEventListener('board', () => void refetch())
  }
  return () => {
    listeners.delete(onChange)
    refCount -= 1
    if (refCount === 0) {
      es?.close()
      es = null
    }
  }
}

export const useBoard = (): Board => useSyncExternalStore(subscribe, () => current)
