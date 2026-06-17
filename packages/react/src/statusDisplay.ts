import type { Outcome } from '@atizar/core'
import { STATUS_LABEL, type Status } from './status'
import { OUTCOME_LABEL, OUTCOME_TINT } from './lifecycleDisplay'

// Presentation maps shared by the pipeline mini-cards and the instance picker.
// TINT → the card background tint class; STATE_WORD → the short pill label.
// (idle never reaches these surfaces — the pipeline filters it out, the picker only
// lists live instances — so its entries are empty.)
export const TINT: Record<Status, string> = {
  idle: '',
  running: 'run',
  done: 'run',
  awaiting_approval: 'await',
  error: 'err',
}

export const STATE_WORD: Record<Status, string> = {
  idle: '',
  running: 'Working',
  done: 'Done',
  awaiting_approval: 'Approve',
  error: 'Error',
}

// A terminal item whose display Status collapses to the 'done' lane (stopped/rejected/superseded/
// reset/dismissed all do) must still SHOW its distinct outcome on the list surfaces — otherwise a
// Stopped run is indistinguishable from a clean Done without opening the modal. For those, prefer
// the outcome word/tint; for everything live (running/awaiting/error) keep the status-keyed maps.
export const DISTINCT_TERMINAL = new Set<Outcome>([
  'stopped',
  'rejected',
  'superseded',
  'reset',
  'dismissed',
])

export const pillLabel = (status: Status, outcome: Outcome): string =>
  status === 'done' && DISTINCT_TERMINAL.has(outcome) ? OUTCOME_LABEL[outcome] : STATE_WORD[status]

export const pillTint = (status: Status, outcome: Outcome): string =>
  status === 'done' && DISTINCT_TERMINAL.has(outcome) ? OUTCOME_TINT[outcome] : TINT[status]

// The agent TYPE card's badge. Same one OUTCOME_LABEL source as the pills for the distinct-
// terminal word ("Stopped"/"Rejected"), but the card keeps its own STATUS_LABEL for live/idle
// (the longer "Working…"/"Awaiting approval" wording) — so it differs from pillLabel only there.
// `outcome === null` (a live/idle/error aggregate) → the status label, exactly as before.
export const cardLabel = (status: Status, outcome: Outcome | null): string =>
  status === 'done' && outcome !== null && DISTINCT_TERMINAL.has(outcome)
    ? OUTCOME_LABEL[outcome]
    : STATUS_LABEL[status]
