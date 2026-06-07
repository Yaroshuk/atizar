import { defineAgent } from '@platform/core'

// TRIAGE — the ONLY board reader (single entry point). Reads the user's open tickets,
// buckets them, surfaces a routing recommendation per ticket. Read-only.
export const triageAgent = defineAgent({
  id: 'triage',
  name: 'TRIAGE',
  provider: 'claude-cli',
  instructions:
    'Read the user’s open tickets on the project board and recommend how to route each.',
  tools: ['list_my_tickets', 'get_ticket', 'render_triage'],
  approvals: [],
  renders: { render_triage: 'TriageCard' },
  handoffs: ['feature', 'bugfix', 'reply-draft'],
})

// FEATURE — analyzes a routed feature ticket from the handoff payload (no GitHub access).
export const featureAgent = defineAgent({
  id: 'feature',
  name: 'FEATURE AGENT',
  provider: 'claude-cli',
  instructions: 'Analyze a feature-request ticket routed to you and produce a short plan.',
  tools: ['render_ticket_result'],
  approvals: [],
  renders: { render_ticket_result: 'TicketResultCard' },
})

// BUG-FIX — same shape, bug-oriented.
export const bugfixAgent = defineAgent({
  id: 'bugfix',
  name: 'BUG-FIX AGENT',
  provider: 'claude-cli',
  instructions: 'Investigate a bug ticket routed to you and produce a short analysis.',
  tools: ['render_ticket_result'],
  approvals: [],
  renders: { render_ticket_result: 'TicketResultCard' },
})

// REPLY-DRAFT — drafts a SUGGESTED reply comment (never posted; read-only flow).
export const replyDraftAgent = defineAgent({
  id: 'reply-draft',
  name: 'REPLY DRAFT',
  provider: 'claude-cli',
  instructions: 'Draft a suggested reply to the last comment on a routed ticket. Never post.',
  tools: ['render_reply_draft'],
  approvals: [],
  renders: { render_reply_draft: 'ReplyDraftCard' },
})

export const githubAgents = [triageAgent, featureAgent, bugfixAgent, replyDraftAgent]
