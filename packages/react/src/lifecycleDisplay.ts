import type { Phase, Outcome } from '@atizar/core'
import type { Status } from './status'

// Client display vocabulary derived from the core (phase, outcome). Replaces the deleted
// mapStatus: phase carries the live/terminal distinction, outcome carries the terminal flavour.
// `Status` (the card pill union) stays the rendering vocabulary; OUTCOME_LABEL/TINT add the
// terminal flavour (Stopped/Rejected) the old single 'done' lane collapsed away.

export const OUTCOME_LABEL: Record<Outcome, string> = {
  running: '',
  done: 'Done',
  stopped: 'Stopped',
  rejected: 'Rejected',
  error: 'Error',
  superseded: 'Superseded',
  reset: 'Cleared',
  dismissed: 'Dismissed',
}

// Tint class suffix per outcome (consumed where a terminal card needs a distinct colour).
// COLOR CANON (spec 2026-06-17 §3/§7): only `error` is the danger/red tint (`err`). Every
// user-terminal outcome — done/stopped/rejected/superseded/reset — is NEUTRAL: `done` is the
// neutral "run" tint, the rest share the muted-grey `stopped` tint. (rejected keeps its distinct
// LABEL via OUTCOME_LABEL; only its COLOR is neutralised — a declined draft is not a crash.)
export const OUTCOME_TINT: Record<Outcome, string> = {
  running: 'run',
  done: 'run',
  stopped: 'stopped',
  rejected: 'stopped',
  error: 'err',
  superseded: 'stopped',
  reset: 'stopped',
  dismissed: 'stopped',
}

// Reduce (phase, outcome) to the card pill Status. awaiting_human → awaiting_approval (the pill
// vocabulary keeps the old name); a terminal stopped/done/superseded/reset all render in the
// 'done' lane (OUTCOME_LABEL supplies the distinct word); error → error.
export function displayStatus(phase: Phase, outcome: Outcome): Status {
  if (phase === 'queued' || phase === 'active') return 'running'
  if (phase === 'awaiting_human') return 'awaiting_approval'
  // terminal
  if (outcome === 'error') return 'error'
  return 'done'
}
