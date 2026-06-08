import { z } from 'zod'
import type { RenderSpec, AgentMeta } from '../../client/src/renderSpecs'
import type { TriageTicket } from '../../client/src/buckets'
import type { TicketHandoffPayload } from '@platform/core'
import { triageAgent, featureAgent, bugfixAgent, replyDraftAgent } from './descriptor'

export const githubTriageMeta: Record<string, AgentMeta> = {
  [triageAgent.id]: { subtitle: 'Reads your board, recommends routing', iconName: 'git', intro: 'Reading your board and triaging your open tickets…' },
  [featureAgent.id]: { subtitle: 'Plans a routed feature ticket', iconName: 'wrench', intro: 'Analyzing the routed ticket as a feature and drafting a plan…' },
  [bugfixAgent.id]: { subtitle: 'Analyzes a routed bug ticket', iconName: 'bug', intro: 'Investigating the routed ticket as a bug…' },
  [replyDraftAgent.id]: { subtitle: 'Drafts a suggested reply (never posts)', iconName: 'pen', intro: 'Drafting a suggested reply to the routed ticket…' },
}

const lastCommentSchema = z.object({ author: z.string(), body: z.string() }).nullable()
const ticketSchema = z.object({
  repo: z.string(), number: z.number(), title: z.string(), status: z.string(),
  priority: z.string(), body: z.string(), url: z.string(), lastComment: lastCommentSchema,
  needsReply: z.boolean(), recommendation: z.string(),
})

const toPayload = (t: TriageTicket): TicketHandoffPayload => ({
  repo: t.repo, number: t.number, title: t.title, status: t.status, priority: t.priority,
  body: t.body, lastComment: t.lastComment, recommendation: t.recommendation, url: t.url,
})

// A GitHub ticket reframed as a customer lead for the Lead-inbox `lead` contract.
// Shape MUST satisfy HandoffPayloadSchema { threadId, from, subject, summary, category, priority }.
const toLead = (t: TriageTicket) => ({
  threadId: t.url,
  from: t.lastComment?.author ?? 'github',
  subject: t.title,
  summary: t.recommendation,
  category: 'support',
  priority: t.priority,
})

export const githubTriageRenders: RenderSpec[] = [
  {
    toolName: 'render_triage',
    parameters: z.object({ origin: z.string(), tickets: z.array(ticketSchema) }),
    render: ({ parameters }, deliver, registry) => {
      const { origin, tickets } = parameters
      if (origin === undefined || tickets === undefined) return <></>
      const Triage = registry['TriageCard']
      return (
        <Triage
          tickets={tickets}
          onRoute={(target: string, ticket: TriageTicket) =>
            deliver(origin, { kind: 'agent', agentId: target }, toPayload(ticket))
          }
          onTreatAsLead={(ticket: TriageTicket) =>
            deliver(origin, { kind: 'contract', workflow: 'lead-inbox', input: 'lead' }, toLead(ticket))
          }
        />
      )
    },
  },
  {
    toolName: 'render_ticket_result',
    parameters: z.object({ title: z.string(), kind: z.string(), analysis: z.string() }),
    render: ({ parameters }, _deliver, registry) => {
      const { title, kind, analysis } = parameters
      if (title === undefined || kind === undefined || analysis === undefined) return <></>
      const Result = registry['TicketResultCard']
      return <Result data={{ title, kind, analysis }} />
    },
  },
  {
    toolName: 'render_reply_draft',
    parameters: z.object({ title: z.string(), draft: z.string() }),
    render: ({ parameters }, _deliver, registry) => {
      const { title, draft } = parameters
      if (title === undefined || draft === undefined) return <></>
      const Reply = registry['ReplyDraftCard']
      return <Reply data={{ title, draft }} />
    },
  },
]
