// Single source of truth for the AgentCard status values.
//
// A string literal union (NOT a TS enum — see CLAUDE.md Decisions): zero runtime
// cost, the value IS the wire string, plays nice with `Record<Status, …>`
// exhaustiveness. The `as const` array also gives a runtime list for iteration.
//
// Client-only: the server/provider never references status — it lives here, not
// in `core/` (which is shared and React/runtime-free).
export const STATUSES = ['idle', 'running', 'awaiting_approval', 'done', 'error'] as const

export type Status = (typeof STATUSES)[number]

// Human-facing label per status (shown on the card status pill + modal header).
export const STATUS_LABEL: Record<Status, string> = {
  idle: 'Idle',
  running: 'Working…',
  awaiting_approval: 'Awaiting approval',
  done: 'Done',
  error: 'Error',
}

// The subset that comes from the agent run lifecycle. `awaiting_approval` is
// derived from message state (hasPendingApproval), never a lifecycle event.
export type Lifecycle = Exclude<Status, 'awaiting_approval'>

// The server status union (now the single source of truth) reduced to the display Status
// the cards/pipeline render. `awaiting_input` is shown like `awaiting_approval` (a pause that
// needs the human); `result`/`finished`/`closed` all read as done; `queued` reads as running
// (work is admitted, just waiting on a slot).
export const mapStatus = (s: import('./serverTypes').ServerStatus): Status => {
  switch (s) {
    case 'queued':
    case 'running':
      return 'running'
    case 'awaiting_approval':
    case 'awaiting_input':
      return 'awaiting_approval'
    case 'result':
    case 'finished':
    case 'closed':
      return 'done'
    case 'error':
      return 'error'
  }
}
