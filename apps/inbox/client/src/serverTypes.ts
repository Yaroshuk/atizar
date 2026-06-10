// Client-facing shapes of the server-authoritative state. These mirror the fields the UI
// consumes from `apps/inbox/server/pipeline/db/schema.ts` — kept as a hand-written copy so
// the client never imports server/Node code (and stays bundler-clean).

export type ServerStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'awaiting_input'
  | 'result'
  | 'finished'
  | 'error'
  | 'closed'

export type Resolution = 'cancelled' | 'rejected' | null

export type WorkItem = {
  id: string
  workflowId: string
  agentId: string // `wf__agent`
  parentId: string | null
  origin: 'human' | 'agent' | 'inbound'
  source: string | null
  payload: Record<string, unknown>
  status: ServerStatus
  resolution: Resolution
  card: { tool: string; props: Record<string, unknown> } | null
  error: string | null
}

export type Gate = {
  id: string
  workItemId: string
  toolName: string
  form: Record<string, unknown>
  formRev: number
  proposedArtifact: Record<string, unknown>
  status: 'open' | 'resolved'
}

export type Board = { items: WorkItem[]; gates: Gate[]; lastEventId: number }
