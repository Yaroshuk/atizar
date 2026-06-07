import { defineAgent } from './defineAgent.js'

// The reply agent (formerly the single inbox agent). Reads an email and drafts a
// reply for human approval. Runs standalone OR seeded by a handoff from the qualifier.
export const replyAgent = defineAgent({
  id: 'reply',
  name: 'REPLY AGENT',
  provider: 'claude-cli',
  instructions:
    'Read the latest email in the inbox, draft a reply, and ask the human before saving it as a draft.',
  tools: ['renderLead', 'saveDraft'],
  approvals: ['saveDraft'],
  renders: { renderLead: 'LeadCard', saveDraft: 'ApprovalDialog' },
})

// The lead qualifier. Reads an email, classifies it, and surfaces a verdict the
// manager can hand off to the reply agent. No approval pause of its own.
export const qualifierAgent = defineAgent({
  id: 'qualifier',
  name: 'LEAD QUALIFIER',
  provider: 'claude-cli',
  instructions:
    'Read the latest email in the inbox and qualify the lead: category, priority, and a one-line reason.',
  tools: ['renderVerdict'],
  approvals: [],
  renders: { renderVerdict: 'VerdictCard' },
  handoffs: ['reply'],
})

// The desktop's agent registry — server (runtime registration + handoff validation)
// and tests map over it. The client references the passports directly (two agents).
export const agents = [qualifierAgent, replyAgent]

