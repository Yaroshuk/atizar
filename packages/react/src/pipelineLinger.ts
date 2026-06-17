// Pure presentation helper for the pipeline completion animation. Diffs the set of pipeline
// row ids rendered "present" last frame against the set buildPipeline emits this frame, and
// returns which ids are now "leaving" (a row that just dropped out of the live set). The hook
// (useLingerSet) owns the timer that finally removes a leaving id; this function is pure set
// algebra so the "which ids are leaving" decision is unit-testable without React/DOM/timers.
//
// It deliberately does NOT consult liveness — buildPipeline already applied isLive (P0,
// packages/react/src/liveness.ts) to decide membership of `currentPresent`. Here we only diff
// the already-decided rendered-id set, keeping ONE source of liveness.
import { useEffect, useRef, useState } from 'react'
export type LeavingState = {
  present: ReadonlySet<string>
  leaving: ReadonlySet<string>
}

export function diffLeaving(
  prevPresent: ReadonlySet<string>,
  prevLeaving: ReadonlySet<string>,
  currentPresent: ReadonlySet<string>
): LeavingState {
  const leaving = new Set<string>()
  // (b) ids still leaving from before that have not reappeared stay leaving.
  for (const id of prevLeaving) if (!currentPresent.has(id)) leaving.add(id)
  // (a) ids that were present last frame but are gone now newly start leaving.
  for (const id of prevPresent) if (!currentPresent.has(id)) leaving.add(id)
  // (c)/(d) present is exactly the current set; a reappearing id is present, never leaving.
  return { present: new Set(currentPresent), leaving }
}

// React hook that keeps a row mounted for `lingerMs` after it drops out of the live set, so the
// pipeline can fade it instead of yanking it. Pure decision delegated to diffLeaving; this owns
// only the timers + the re-render that finally unmounts a row. Presentation only — nothing here
// touches state, the DB, or the board transport.
export function useLingerSet(
  currentPresent: ReadonlySet<string>,
  lingerMs: number
): { isLeaving: (id: string) => boolean; lingering: ReadonlySet<string> } {
  const presentRef = useRef<ReadonlySet<string>>(new Set())
  const leavingRef = useRef<ReadonlySet<string>>(new Set())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const [, force] = useState(0)
  const rerender = () => force((n) => n + 1)

  const next = diffLeaving(presentRef.current, leavingRef.current, currentPresent)

  // Schedule a removal timer for any id that is newly leaving (no timer yet).
  for (const id of next.leaving) {
    if (timers.current.has(id)) continue
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id)
        // Drop this id from the tracked leaving set, then re-render to unmount the row.
        leavingRef.current = new Set([...leavingRef.current].filter((x) => x !== id))
        rerender()
      }, lingerMs)
    )
  }
  // If an id reappeared (present again), cancel its pending removal timer.
  for (const [id, t] of timers.current) {
    if (currentPresent.has(id)) {
      clearTimeout(t)
      timers.current.delete(id)
    }
  }

  presentRef.current = next.present
  leavingRef.current = next.leaving

  useEffect(() => {
    const ts = timers.current
    return () => {
      for (const t of ts.values()) clearTimeout(t)
      ts.clear()
    }
  }, [])

  // lingering = present ∪ leaving — the full set of row ids that must stay mounted this frame.
  const lingering: ReadonlySet<string> = new Set([...presentRef.current, ...leavingRef.current])

  return { isLeaving: (id) => leavingRef.current.has(id), lingering }
}
