import { defineAgent, defineWorkflow } from '@atizar/core'
import { PROVIDERS } from '@atizar/providers'
import { GITHUB_TRIAGE_TOOLS as t } from './tools'
import { GITHUB_TRIAGE_CARDS as c } from './cards'

export const triageAgent = defineAgent({
  id: 'triage',
  name: 'TRIAGE',
  provider: PROVIDERS.claudeCli,
  instructions:
    "Read the user's open tickets on the project board and recommend how to route each.",
  tools: [t.list_my_tickets, t.get_ticket, t.render_triage],
  approvals: [],
  readonly: [t.list_my_tickets, t.get_ticket],
  renders: { [t.render_triage]: c.TriageCard },
  handoffs: ['feature', 'bugfix', 'reply-draft'],
  maxInstances: 1,
})
export const featureAgent = defineAgent({
  id: 'feature',
  name: 'FEATURE AGENT',
  provider: PROVIDERS.claudeCli,
  instructions: 'Analyze a feature-request ticket routed to you and produce a short plan.',
  tools: [t.render_ticket_result],
  approvals: [],
  renders: { [t.render_ticket_result]: c.TicketResultCard },
})
export const bugfixAgent = defineAgent({
  id: 'bugfix',
  name: 'BUG-FIX AGENT',
  provider: PROVIDERS.claudeCli,
  instructions: 'Investigate a bug ticket routed to you and produce a short analysis.',
  tools: [t.render_ticket_result],
  approvals: [],
  renders: { [t.render_ticket_result]: c.TicketResultCard },
})
export const replyDraftAgent = defineAgent({
  id: 'reply-draft',
  name: 'REPLY DRAFT',
  provider: PROVIDERS.claudeCli,
  instructions: 'Draft a suggested reply to the last comment on a routed ticket. Never post.',
  tools: [t.render_reply_draft],
  approvals: [],
  renders: { [t.render_reply_draft]: c.ReplyDraftCard },
})

export const githubTriage = defineWorkflow({
  id: 'github-triage',
  label: 'GitHub triage',
  iconName: 'git',
  agents: [
    { agent: triageAgent, role: 'input' },
    { agent: featureAgent, role: 'worker' },
    { agent: bugfixAgent, role: 'worker' },
    { agent: replyDraftAgent, role: 'worker' },
  ],
  entryAgentId: triageAgent.id,
  inputs: [], // triage reads the board itself; no cross-workflow inbound parcel
})

export const githubTriageAgents = [triageAgent, featureAgent, bugfixAgent, replyDraftAgent]
