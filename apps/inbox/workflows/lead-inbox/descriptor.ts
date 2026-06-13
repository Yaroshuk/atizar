import { defineAgent, defineWorkflow, HandoffPayloadSchema } from '@atizar/core'

export const replyAgent = defineAgent({
  id: 'reply',
  name: 'REPLY AGENT',
  provider: 'claude-cli',
  instructions:
    'Read the latest email in the inbox, draft a reply, and ask the human before saving it as a draft.',
  tools: ['renderLead', 'saveDraft'],
  approvals: ['saveDraft'],
  effects: ['saveDraft'],
  renders: { renderLead: 'LeadCard', saveDraft: 'ApprovalDialog' },
})

export const qualifierAgent = defineAgent({
  id: 'qualifier',
  name: 'LEAD QUALIFIER',
  provider: 'claude-cli',
  instructions:
    'Read the latest email in the inbox and qualify the lead: category, priority, and a one-line reason.',
  tools: ['renderVerdict'],
  approvals: [],
  readonly: ['get_latest_email'],
  renders: { renderVerdict: 'VerdictCard' },
  handoffs: ['reply'],
  maxInstances: 1,
})

export const leadInbox = defineWorkflow({
  id: 'lead-inbox',
  label: 'Lead inbox',
  iconName: 'inbox',
  agents: [
    { agent: qualifierAgent, role: 'input' },
    { agent: replyAgent, role: 'worker' },
  ],
  entryAgentId: qualifierAgent.id,
  // Published contract: another workflow may deliver a lead here; the qualifier
  // (re-)qualifies it. Shape = the existing lead handoff payload.
  inputs: [{ name: 'lead', schema: HandoffPayloadSchema, agentId: qualifierAgent.id }],
})

export const leadInboxAgents = [qualifierAgent, replyAgent]
