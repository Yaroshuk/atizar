import { defineAgent, defineWorkflow } from '@atizar/core'
import { PROVIDERS } from '@atizar/providers/ids'
import { EMAIL_INBOX_TOOLS as t } from './tools'
import { EMAIL_INBOX_CARDS as c } from './cards'
import { EMAIL_INBOX_ID, EMAIL_INBOX_AGENTS as a, ROLES, type EmailInboxAgentId } from './ids'

// The payload contracts live in ./contracts (so prompts.ts can decode them without importing the
// descriptor — that would close a descriptor↔prompts cycle). Re-exported here for the descriptor
// tests and any consumer that reaches for the descriptor as the workflow's single entry point.
export { EmailRefSchema, EmailBatchSchema, ReplyPayloadSchema, type EmailRef } from './contracts.js'

export const sorterAgent = defineAgent({
  id: a.sorter,
  name: 'EMAIL SORTER',
  provider: PROVIDERS.claudeCli,
  instructions:
    'Read the unread inbox emails of the last 24 hours and sort each one. For an email that needs a personal reply, dispatch it to the reply agent. Group the rest into: informational (reader), suspected spam (spam), and important-but-no-reply (important). Then surface a short summary.',
  // CONVENTION: read tools go in `readonly` ONLY, never in `tools`. `tools` holds the
  // surface/render/propose/approval/dispatch tools. The Mastra factory derives render-vs-read from
  // membership in `tools`, so a read tool in `tools` would be misclassified.
  tools: [t.route_emails, t.renderSort],
  approvals: [],
  readonly: [t.list_unread],
  dispatches: [t.route_emails],
  renders: { [t.renderSort]: c.SortSummaryCard },
  handoffs: [a.reply, a.reader, a.spam, a.important],
  maxInstances: 1,
})

export const replyAgent = defineAgent({
  id: a.reply,
  name: 'REPLY AGENT',
  provider: PROVIDERS.claudeCli,
  instructions:
    'You were handed one email that needs a reply. Read its full body, draft a short reply, and ask the human before saving it as a Gmail draft.',
  tools: [t.renderLead, t.saveDraft],
  readonly: [t.get_email],
  approvals: [t.saveDraft],
  effects: [t.saveDraft],
  renders: { [t.renderLead]: c.LeadCard, [t.saveDraft]: c.ApprovalDialog },
  maxInstances: 2, // one reply instance per sender -> allow up to 2 concurrent drafts
})

// reader / spam / important share the SAME shape (one batch gate proposing per-row actions),
// differing only in the proposed default action — that is the prompt's job, not the passport's.
function batchAgent(id: EmailInboxAgentId, name: string): ReturnType<typeof defineAgent> {
  return defineAgent({
    id,
    name,
    provider: PROVIDERS.claudeCli,
    instructions:
      'You were handed a batch of emails. Propose a per-row action for each (read / trash / star / keep) and ask the human to apply them. The human may change any row before approving.',
    tools: [t.applyActions],
    approvals: [t.applyActions],
    effects: [t.applyActions],
    renders: { [t.applyActions]: c.EmailBatchCard },
    handoffs: [a.reply], // a row can be re-routed to a reply
  })
}

export const readerAgent = batchAgent(a.reader, 'READER')
export const spamAgent = batchAgent(a.spam, 'SPAM')
export const importantAgent = batchAgent(a.important, 'IMPORTANT')

export const emailInbox = defineWorkflow({
  id: EMAIL_INBOX_ID,
  label: 'Email inbox',
  iconName: 'inbox',
  rerun: 'refresh', // human re-START supersedes the prior finished scan (live-source inbox scan)
  prompt:
    'You are part of an email-inbox automation. Be concise and businesslike. NEVER narrate tool plumbing (no "let me load the tools", no schema talk). The human approves every Gmail action — you only propose. Never send email; drafts only.',
  agents: [
    { agent: sorterAgent, role: ROLES.input },
    { agent: replyAgent, role: ROLES.worker },
    { agent: readerAgent, role: ROLES.worker },
    { agent: spamAgent, role: ROLES.worker },
    { agent: importantAgent, role: ROLES.worker },
  ],
  entryAgentId: sorterAgent.id,
  inputs: [], // no cross-workflow input contract for the beta (the sorter is human-started)
  connections: [{ integration: 'gmail', provider: 'google' }],
})

export const emailInboxAgents = [sorterAgent, replyAgent, readerAgent, spamAgent, importantAgent]
