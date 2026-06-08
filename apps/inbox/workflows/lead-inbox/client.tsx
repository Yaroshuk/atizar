import { z } from 'zod'
import type { RenderSpec, HitlSpec, AgentMeta } from '../../client/src/renderSpecs'
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

export const leadInboxRenders: RenderSpec[] = [
  {
    toolName: 'renderLead',
    parameters: z.object({ from: z.string(), subject: z.string(), summary: z.string() }),
    render: ({ parameters }, _deliver, registry) => {
      const { from, subject, summary } = parameters
      if (from === undefined || subject === undefined || summary === undefined) return <></>
      const Lead = registry['LeadCard']
      return <Lead lead={{ from, subject, summary }} />
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
    render: ({ parameters }, deliver, registry) => {
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
      const Verdict = registry['VerdictCard']
      return (
        <Verdict
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

export const leadInboxHitl: HitlSpec[] = [
  {
    toolName: 'saveDraft',
    parameters: z.object({ threadId: z.string(), body: z.string() }),
    render: ({ args, status, respond }, registry) => {
      if (args.threadId === undefined || args.body === undefined) return <></>
      const Approval = registry['ApprovalDialog']
      return (
        <Approval
          data={{ threadId: args.threadId, body: args.body }}
          onApprove={() => {
            if (status === 'executing' && respond) void respond('approved')
          }}
        />
      )
    },
  },
]
