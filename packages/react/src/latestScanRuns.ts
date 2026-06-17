import type { PInstance } from './pipelineModel'

// An INPUT agent has a CONSTANT instance key, so every scan run collapses into one instance
// (same agentId + key). On re-START the server keeps a finished prior scan that still has live
// descendants (it would otherwise orphan the children — pipelineService.ts:295-302), so older
// scan roots survive on the board and the open thread would stack one sub-thread per scan.
//
// The board snapshot is creation-ordered (stateStore.ts: orderBy created_at ASC) and every
// transform downstream (getBoard filter, toPInstances filter/map) preserves order, so the LAST
// element of an input instance's runs IS the latest scan. Render only that one in the input
// thread; the older kept-for-children scans still host their children in the pipeline tree / the
// child agents' cards — they just stop drawing a repeated scan card in the sorter thread.
//
// A WORKER instance's several runs are a sender's several drafts — all must keep showing, so the
// worker path returns the runs unchanged. Pure + role-driven (the generic `isInput` flag), no
// workflow literals (I5).
export function latestScanRuns(runs: PInstance[], isInput: boolean): PInstance[] {
  if (!isInput) return runs
  return runs.length ? [runs[runs.length - 1]] : []
}
