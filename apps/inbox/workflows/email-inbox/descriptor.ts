import { z } from 'zod'
import { defineAgent, defineWorkflow } from '@platform/core'

// The dispatch payload shapes (= the route_emails tool args minus `to`). EmailRef mirrors the
// gmail-viewer EmailRef; defined here as the workflow's own contract (userland), not imported
// from the integration's .d.ts (that is a type, not a runtime zod schema).
export const EmailRefSchema = z.object({
  messageId: z.string(),
  threadId: z.string(),
  from: z.string(),
  subject: z.string(),
  date: z.string(),
  snippet: z.string(),
})
export type EmailRef = z.infer<typeof EmailRefSchema>

// A batch worker (reader/spam/important) receives a list of emails.
export const EmailBatchSchema = z.object({ emails: z.array(EmailRefSchema) })

// A reply worker receives ONE email (it fetches the body itself via get_email).
export const ReplyPayloadSchema = z.object({ email: EmailRefSchema })

export const sorterAgent = defineAgent({
  id: 'sorter',
  name: 'EMAIL SORTER',
  provider: 'claude-cli',
  instructions:
    'Read the unread inbox emails of the last 24 hours and sort each one. For an email that needs a personal reply, dispatch it to the reply agent. Group the rest into: informational (reader), suspected spam (spam), and important-but-no-reply (important). Then surface a short summary.',
  // CONVENTION (matches lead-inbox qualifier): read tools go in `readonly` ONLY, never in `tools`.
  // `tools` holds the surface/render/propose/approval/dispatch tools. The Mastra factory derives
  // render-vs-read from membership in `tools`, so a read tool in `tools` would be misclassified.
  tools: ['route_emails', 'renderSort'],
  approvals: [],
  readonly: ['list_unread'],
  dispatches: ['route_emails'],
  renders: { renderSort: 'SortSummaryCard' },
  handoffs: ['reply', 'reader', 'spam', 'important'],
  maxInstances: 1,
})

export const replyAgent = defineAgent({
  id: 'reply',
  name: 'REPLY AGENT',
  provider: 'claude-cli',
  instructions:
    'You were handed one email that needs a reply. Read its full body, draft a short reply, and ask the human before saving it as a Gmail draft.',
  tools: ['renderLead', 'saveDraft'],
  readonly: ['get_email'],
  approvals: ['saveDraft'],
  effects: ['saveDraft'],
  renders: { renderLead: 'LeadCard', saveDraft: 'ApprovalDialog' },
})

// reader / spam / important share the SAME shape (one batch gate proposing per-row actions),
// differing only in the proposed default action — that is the prompt's job, not the passport's.
function batchAgent(id: string, name: string): ReturnType<typeof defineAgent> {
  return defineAgent({
    id,
    name,
    provider: 'claude-cli',
    instructions:
      'You were handed a batch of emails. Propose a per-row action for each (read / trash / star / keep) and ask the human to apply them. The human may change any row before approving.',
    tools: ['applyActions'],
    approvals: ['applyActions'],
    effects: ['applyActions'],
    renders: { applyActions: 'EmailBatchCard' },
    handoffs: ['reply'], // a row can be re-routed to a reply
  })
}

export const readerAgent = batchAgent('reader', 'READER')
export const spamAgent = batchAgent('spam', 'SPAM')
export const importantAgent = batchAgent('important', 'IMPORTANT')

export const emailInbox = defineWorkflow({
  id: 'email-inbox',
  label: 'Email inbox',
  iconName: 'inbox',
  prompt:
    'You are part of an email-inbox automation. Be concise and businesslike. NEVER narrate tool plumbing (no "let me load the tools", no schema talk). The human approves every Gmail action — you only propose. Never send email; drafts only.',
  agents: [
    { agent: sorterAgent, role: 'input' },
    { agent: replyAgent, role: 'worker' },
    { agent: readerAgent, role: 'worker' },
    { agent: spamAgent, role: 'worker' },
    { agent: importantAgent, role: 'worker' },
  ],
  entryAgentId: sorterAgent.id,
  inputs: [], // no cross-workflow input contract for the beta (the sorter is human-started)
})

export const emailInboxAgents = [sorterAgent, replyAgent, readerAgent, spamAgent, importantAgent]
