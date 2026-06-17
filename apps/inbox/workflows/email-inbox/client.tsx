import { z } from 'zod'
import type { RenderSpec, HitlSpec, AgentMeta } from '@atizar/react'
import { SortSummaryCard } from '../../client/src/components/SortSummaryCard/SortSummaryCard'
import { EmailBatchCard } from '../../client/src/components/EmailBatchCard/EmailBatchCard'
import { LeadCard } from '../../client/src/components/LeadCard/LeadCard'
import { ApprovalDialog } from '../../client/src/components/ApprovalDialog/ApprovalDialog'
import { sorterAgent, replyAgent, readerAgent, spamAgent, importantAgent } from './descriptor'
import { EMAIL_INBOX_TOOLS as t } from './tools'

export const emailInboxMeta: Record<string, AgentMeta> = {
  [sorterAgent.id]: {
    subtitle: 'Reads unread mail, sorts and dispatches',
    iconName: 'inbox',
    intro: 'Reading your unread inbox and sorting the last 24 hours…',
  },
  [replyAgent.id]: {
    subtitle: 'Drafts a reply for your approval',
    iconName: 'pen',
    intro: 'Reading the email and drafting a reply for your approval…',
  },
  [readerAgent.id]: {
    subtitle: 'Proposes mark-as-read for informational mail',
    iconName: 'envelope',
    intro: 'Proposing actions for the informational batch…',
  },
  [spamAgent.id]: {
    subtitle: 'Proposes trashing suspected spam',
    iconName: 'alert',
    intro: 'Proposing actions for the suspected-spam batch…',
  },
  [importantAgent.id]: {
    subtitle: 'Proposes starring important mail',
    iconName: 'sparkle',
    intro: 'Proposing actions for the important batch…',
  },
}

// Render/HITL resolution is scoped per workflow (WS2), so email-inbox declares EVERY tool it
// surfaces — including renderLead + saveDraft for the reply agent. The reply contract (one email
// → a drafted reply for approval) is generic and reusable, but each workflow owns its own copy
// of the render/HITL specs (scoping is per workflow, never global).
export const emailInboxRenders: Omit<RenderSpec, 'workflowId'>[] = [
  {
    toolName: t.renderSort,
    parameters: z.object({ summary: z.string() }),
    render: ({ parameters }) => {
      const { summary } = parameters
      if (summary === undefined) return <></>
      return <SortSummaryCard summary={summary} />
    },
  },
  {
    toolName: t.renderLead,
    parameters: z.object({ from: z.string(), subject: z.string(), summary: z.string() }),
    render: ({ parameters }) => {
      const { from, subject, summary } = parameters
      if (from === undefined || subject === undefined || summary === undefined) return <></>
      return <LeadCard lead={{ from, subject, summary }} />
    },
  },
]

const BatchActionSchema = z.enum(['read', 'trash', 'star', 'keep'])
const BatchItemSchema = z.object({
  messageId: z.string(),
  from: z.string().optional(),
  subject: z.string().optional(),
  action: BatchActionSchema,
})

export const emailInboxHitl: Omit<HitlSpec, 'workflowId'>[] = [
  {
    toolName: t.saveDraft,
    parameters: z.object({ threadId: z.string(), body: z.string() }),
    render: ({ form, source, approve, reject }) => {
      const threadId = typeof form.threadId === 'string' ? form.threadId : ''
      const body = typeof form.body === 'string' ? form.body : ''
      return (
        <ApprovalDialog
          data={{ threadId, body }}
          source={source}
          onApprove={(editedBody: string) => approve({ ...form, body: editedBody })}
          onReject={() => reject('no thanks')}
        />
      )
    },
  },
  {
    toolName: t.applyActions,
    parameters: z.object({ items: z.array(BatchItemSchema) }),
    render: ({ form, approve, reject }) => {
      const parsed = z.array(BatchItemSchema).safeParse(form.items)
      const items = parsed.success ? parsed.data : []
      return (
        <EmailBatchCard
          data={{ items }}
          onApprove={(editedForm) => approve({ ...form, items: editedForm.items })}
          onReject={() => reject('no thanks')}
        />
      )
    },
  },
]
