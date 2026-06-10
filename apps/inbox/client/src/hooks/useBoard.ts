import { useEffect, useRef, useState } from 'react'
import type { Board } from '../serverTypes'

// The board is server-authoritative: fetch the snapshot, then on ANY board SSE message
// refetch the snapshot (coarse model — the SSE is just a poke, the snapshot is the truth).
// So duplicate/out-of-order pokes, reconnects, and a second tab are all harmless.
export const useBoard = (): Board => {
  const [board, setBoard] = useState<Board>({ items: [], gates: [], lastEventId: 0 })
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    let cancelled = false
    const refetch = async (): Promise<void> => {
      const b = (await (await fetch('/api/board')).json()) as Board
      if (!cancelled) setBoard(b)
    }
    void refetch()
    const es = new EventSource('/api/board/stream')
    esRef.current = es
    es.addEventListener('board', () => void refetch())
    return () => {
      cancelled = true
      es.close()
    }
  }, [])

  return board
}
