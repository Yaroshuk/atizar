// Pure presentation helper for the pipeline completion animation. Diffs the set of pipeline
// row ids rendered "present" last frame against the set buildPipeline emits this frame, and
// returns which ids are now "leaving" (a row that just dropped out of the live set). The hook
// (useLingerSet) owns the timer that finally removes a leaving id; this function is pure set
// algebra so the "which ids are leaving" decision is unit-testable without React/DOM/timers.
//
// It deliberately does NOT consult liveness — buildPipeline already applied isLive (P0,
// packages/react/src/liveness.ts) to decide membership of `currentPresent`. Here we only diff
// the already-decided rendered-id set, keeping ONE source of liveness.
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
