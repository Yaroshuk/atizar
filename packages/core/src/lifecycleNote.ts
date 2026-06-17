import { EventType, type BaseEvent } from '@ag-ui/client'
import type { Outcome } from './lifecycle.js'

// A typed server-authored trace note (I14: the trace is an explicitly mixed log — provider output
// PLUS server notes). It rides the SAME AG-UI vocabulary as the existing synthetic CUSTOM events
// (dispatch_rejected, status markers): a CUSTOM event named 'lifecycle'. settle() appends one
// BEFORE the terminal status publish (killing the SSE backlog race), and fold.ts renders it as a
// short note message in the thread.
export interface LifecycleNoteValue {
  kind: 'lifecycle'
  outcome: Outcome
  actor: string | null
  at: number
}

export function lifecycleNote(value: LifecycleNoteValue): BaseEvent {
  return { type: EventType.CUSTOM, name: 'lifecycle', value } as unknown as BaseEvent
}

// Human-facing one-liner per terminal outcome (the note text the thread shows at the tail).
export const LIFECYCLE_NOTE_TEXT: Record<Outcome, string> = {
  running: '',
  done: 'Done',
  stopped: 'Stopped — cancelled',
  rejected: 'Rejected',
  error: 'Error',
  superseded: 'Superseded by a re-run',
  reset: 'Cleared from board',
  dismissed: 'Error acknowledged — dismissed',
}
