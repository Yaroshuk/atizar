import { z } from 'zod'
import type { RenderSpec, HitlSpec, AgentMeta } from '@atizar/react'
import { LeadCard } from '../../client/src/components/LeadCard/LeadCard'
import { VerdictCard } from '../../client/src/components/VerdictCard/VerdictCard'
import { ApprovalDialog } from '../../client/src/components/ApprovalDialog/ApprovalDialog'
import { qualifierAgent, replyAgent } from './descriptor'

export const leadInboxMeta: Record<string, AgentMeta> = {
  [qualifierAgent.id]: {
    subtitle: 'Reads inbox, qualifies the lead',
    iconName: 'inbox',
    intro: 'Reading your inbox and qualifying the latest lead…',
  },
  [replyAgent.id]: {
    subtitle: 'Drafts a reply for your approval',
    iconName: 'pen',
    intro: 'Drafting a reply to the qualified lead for your approval…',
  },
}

export const leadInboxRenders: Omit<RenderSpec, 'workflowId'>[] = [
  {
    toolName: 'renderLead',
    parameters: z.object({ from: z.string(), subject: z.string(), summary: z.string() }),
    render: ({ parameters }) => {
      const { from, subject, summary } = parameters
      if (from === undefined || subject === undefined || summary === undefined) return <></>
      return <LeadCard lead={{ from, subject, summary }} />
    },
  },
  {
    toolName: 'renderVerdict',
    parameters: z.object({
      origin: z.string(),
      threadId: z.string(),
      from: z.string(),
      subject: z.string(),
      summary: z.string(),
      category: z.string(),
      priority: z.string(),
      reason: z.string(),
    }),
    render: ({ parameters }, deliver) => {
      const { origin, threadId, from, subject, summary, category, priority, reason } = parameters
      if (
        origin === undefined ||
        threadId === undefined ||
        from === undefined ||
        subject === undefined ||
        summary === undefined ||
        category === undefined ||
        priority === undefined ||
        reason === undefined
      )
        return <></>
      const data = { threadId, from, subject, summary, category, priority, reason }
      return (
        <VerdictCard
          data={data}
          onDraftReply={() =>
            deliver(
              origin,
              { kind: 'agent', agentId: 'reply' },
              { threadId, from, subject, summary, category, priority }
            )
          }
        />
      )
    },
  },
]

export const leadInboxHitl: Omit<HitlSpec, 'workflowId'>[] = [
  {
    toolName: 'saveDraft',
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
]
