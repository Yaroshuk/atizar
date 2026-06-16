// The SINGLE place the work-item lifecycle alphabet is defined. Pure & isomorphic (no React, no
// Node) — same nature as messages/fold/gate. Every consumer (server cancel-cascade, START guard,
// dedup, board, pipeline, aggregate, display) imports lifecycle() / hasLiveDescendant so the
// views cannot physically disagree (spec 2026-06-16: the unified model).

// phase: was the 8-value DB status, collapsed to 4. awaiting_human merges the old
// awaiting_approval + awaiting_input (both pause on a human).
export type Phase = 'queued' | 'active' | 'awaiting_human' | 'terminal'

// outcome: was `resolution`, now first-class. running = not-yet-terminal; the other six are the
// terminal flavours. done = a clean finish (incl. an approved gate, which is `done` + an audit
// marker, so approved is distinguishable in the thread/audit, not in the outcome value).
export type Outcome = 'running' | 'done' | 'stopped' | 'rejected' | 'error' | 'superseded' | 'reset'

export interface Lifecycle {
  phase: Phase
  outcome: Outcome
  // isLive = phase is non-terminal. error/stopped/rejected are TERMINAL (not live) — this single
  // decision resolves the error/queued boundary disagreement across every tree walk.
  isLive: boolean
  // isVisible = the I12 ladder, transcribed ONCE:
  //   queued                         -> false (admitted, not yet shown)
  //   superseded / reset (retired)   -> false (LEFT the board; lives on in Activity/history)
  //   non-terminal (active/awaiting) -> true
  //   terminal                       -> hasCard || human-terminal marker || hasLiveDescendant
  // The human-terminal markers (stopped/rejected/error) are visible even without a card so the
  // human always sees how a run ended. done is visible only if it has a card or a live child.
  isVisible: boolean
  // covers (dedup, Option A): does this item shadow a same-source re-dispatch? A live or
  // freeze-and-keep item COVERS (no phantom twin); an un-actioned terminal
  // (rejected/superseded/reset/error) does NOT cover (a re-scan re-surfaces the source).
  covers: boolean
}

const LIVE_PHASES: ReadonlySet<Phase> = new Set(['queued', 'active', 'awaiting_human'])

// Terminal outcomes that have LEFT the board (retired into Activity/history) — never visible.
const RETIRED: ReadonlySet<Outcome> = new Set(['superseded', 'reset'])

// Terminal outcomes the human must always see, even with no card.
const HUMAN_TERMINAL: ReadonlySet<Outcome> = new Set(['stopped', 'rejected', 'error'])

// Terminal outcomes that COVER a same-source re-dispatch (Option A: stopped freezes & keeps, so
// it covers; done covers too — the finished result still occupies the source).
const COVERING_TERMINAL: ReadonlySet<Outcome> = new Set(['done', 'stopped'])

export function lifecycle(
  phase: Phase,
  outcome: Outcome,
  hasCard: boolean,
  hasLiveDescendant: boolean
): Lifecycle {
  const isLive = LIVE_PHASES.has(phase)

  let isVisible: boolean
  if (phase === 'queued') isVisible = false
  else if (isLive) isVisible = true
  else if (RETIRED.has(outcome)) isVisible = false
  else isVisible = hasCard || HUMAN_TERMINAL.has(outcome) || hasLiveDescendant

  const covers = isLive || COVERING_TERMINAL.has(outcome)

  return { phase, outcome, isLive, isVisible, covers }
}

// The ONE tree walk over phase-liveness: the set of ids that have ≥1 transitively-live descendant.
// Used by board/pipeline (kept parent) AND the server START guard (a finished input root with an
// awaiting child is still a live scan — Approach B). Cycle-safe via the seen guard.
export function hasLiveDescendant<T extends { id: string; parentId: string | null; phase: Phase }>(
  rows: readonly T[]
): Set<string> {
  const childrenOf = new Map<string, T[]>()
  for (const r of rows) {
    if (!r.parentId) continue
    const arr = childrenOf.get(r.parentId) ?? []
    arr.push(r)
    childrenOf.set(r.parentId, arr)
  }
  const memo = new Map<string, boolean>()
  const compute = (id: string): boolean => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    memo.set(id, false) // guard against cycles
    let live = false
    for (const kid of childrenOf.get(id) ?? []) {
      if (LIVE_PHASES.has(kid.phase) || compute(kid.id)) live = true
    }
    memo.set(id, live)
    return live
  }
  const out = new Set<string>()
  for (const r of rows) if (compute(r.id)) out.add(r.id)
  return out
}
