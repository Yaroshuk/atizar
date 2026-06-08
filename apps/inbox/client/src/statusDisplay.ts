import type { Status } from './status'

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
