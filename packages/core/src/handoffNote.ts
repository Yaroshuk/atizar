import { EventType, type BaseEvent } from '@ag-ui/client'

// A typed server-authored trace note (I14), riding the SAME AG-UI CUSTOM vocabulary as the
// lifecycle note: a CUSTOM event named 'handoff'. The RunObserver appends one to the PARENT's
// trace when it delivers a child for a dispatch tool-call, and fold.ts renders it inline at its
// position. Generic — carries only the target reference + the dedup outcome, no workflow fields.
export interface HandoffNoteValue {
  kind: 'handoff'
  targetAgentId: string // the child's runtime agent id (wf__agent)
  childWorkItemId: string // the delivered child work item (for the "Open X" link)
  deduped: boolean // true ⇒ covered-by-source, no new child created this run
  at: number
}

export function handoffNote(value: HandoffNoteValue): BaseEvent {
  return { type: EventType.CUSTOM, name: 'handoff', value } as unknown as BaseEvent
}
