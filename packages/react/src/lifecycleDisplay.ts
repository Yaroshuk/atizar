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
}

// Tint class suffix per outcome (consumed where a terminal card needs a distinct colour). done =
// the neutral "run" tint; stopped/rejected/error read as muted/warning.
export const OUTCOME_TINT: Record<Outcome, string> = {
  running: 'run',
  done: 'run',
  stopped: 'stopped',
  rejected: 'rejected',
  error: 'err',
  superseded: 'stopped',
  reset: 'stopped',
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
