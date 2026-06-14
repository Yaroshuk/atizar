import { z } from 'zod'
import type { RenderSpec, HitlSpec, AgentMeta } from '@atizar/react'
import { SortSummaryCard } from '../../client/src/components/SortSummaryCard/SortSummaryCard'
import { EmailBatchCard } from '../../client/src/components/EmailBatchCard/EmailBatchCard'
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

// Only the NEW tools are declared here. renderLead + saveDraft (reused by the reply agent) are
// already registered by lead-inbox. Resolution is scoped per workflow now (WS2), so email-inbox
// would need its OWN copy to surface those in its threads; this workflow only renders renderSort
// + the applyActions HITL, so the reused lead tools are intentionally not re-declared here.
export const emailInboxRenders: Omit<RenderSpec, 'workflowId'>[] = [
  {
    toolName: t.renderSort,
    parameters: z.object({
      summary: z.string(),
      counts: z
        .object({
          reply: z.number(),
          reader: z.number(),
          spam: z.number(),
          important: z.number(),
        })
        .partial()
        .optional(),
    }),
    render: ({ parameters }) => {
      const { summary, counts } = parameters
      if (summary === undefined) return <></>
      return <SortSummaryCard summary={summary} counts={counts} />
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
