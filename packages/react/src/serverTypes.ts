// Client-facing shapes of the server-authoritative state. These mirror the fields the UI
// consumes from `@atizar/server`'s db schema — kept as a hand-written copy so
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

export type Resolution = 'cancelled' | 'rejected' | 'superseded' | null

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

// Hand-written mirror of core's HealthCheck for the client — intentionally omits the
// optional `detail?` field on the ok-branch (client only needs ok/error/hint for the badge).
export type AgentHealth = { ok: true } | { ok: false; error: string; hint: string }

export type Board = {
  items: WorkItem[]
  gates: Gate[]
  lastEventId: number
  agentHealth: Record<string, AgentHealth>
}

// Client mirror of @atizar/server's ActivityEntry — the operator activity feed row.
// `kind` is an open string (server documents: queued | running | gate | resolved |
// effect | finished | error | cancelled | delivered).
export type ActivityEntry = {
  ts: number
  workflowId: string
  agentId: string
  workItemId: string
  kind: string
  summary: string
}
