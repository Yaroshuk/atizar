import { defineAgent, defineWorkflow, HandoffPayloadSchema } from '@atizar/core'
import { PROVIDERS } from '@atizar/providers'
import { LEAD_INBOX_TOOLS as t } from './tools'
import { LEAD_INBOX_CARDS as c } from './cards'

export const replyAgent = defineAgent({
  id: 'reply',
  name: 'REPLY AGENT',
  provider: PROVIDERS.claudeCli,
  instructions:
    'Read the latest email in the inbox, draft a reply, and ask the human before saving it as a draft.',
  tools: [t.renderLead, t.saveDraft],
  approvals: [t.saveDraft],
  effects: [t.saveDraft],
  renders: { [t.renderLead]: c.LeadCard, [t.saveDraft]: c.ApprovalDialog },
})

export const qualifierAgent = defineAgent({
  id: 'qualifier',
  name: 'LEAD QUALIFIER',
  provider: PROVIDERS.claudeCli,
  instructions:
    'Read the latest email in the inbox and qualify the lead: category, priority, and a one-line reason.',
  tools: [t.renderVerdict],
  approvals: [],
  readonly: ['get_latest_email'],
  renders: { [t.renderVerdict]: c.VerdictCard },
  handoffs: ['reply'],
  maxInstances: 1,
})

export const leadInbox = defineWorkflow({
  id: 'lead-inbox',
  label: 'Lead inbox',
  iconName: 'inbox',
  rerun: 'refresh', // human re-START re-reads the latest email; the prior scan moves to history
  agents: [
    { agent: qualifierAgent, role: 'input' },
    { agent: replyAgent, role: 'worker' },
  ],
  entryAgentId: qualifierAgent.id,
  // Published contract: another workflow may deliver a lead here; the qualifier
  // (re-)qualifies it. Shape = the existing lead handoff payload.
  inputs: [{ name: 'lead', schema: HandoffPayloadSchema, agentId: qualifierAgent.id }],
  connections: [{ integration: 'gmail', provider: 'google' }],
})

export const leadInboxAgents = [qualifierAgent, replyAgent]
