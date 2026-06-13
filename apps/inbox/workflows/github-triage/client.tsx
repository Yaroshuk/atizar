import { z } from 'zod'
import type { RenderSpec, AgentMeta, DeliverFn } from '@atizar/react'
import { useThreadResult } from '@atizar/react'
import type { TriageTicket } from '../../client/src/buckets'
import { TriageCard } from '../../client/src/components/TriageCard'
import { TicketResultCard } from '../../client/src/components/TicketResultCard'
import { ReplyDraftCard } from '../../client/src/components/ReplyDraftCard'
import type { TicketHandoffPayload } from '@atizar/core'
import { triageAgent, featureAgent, bugfixAgent, replyDraftAgent } from './descriptor'

export const githubTriageMeta: Record<string, AgentMeta> = {
  [triageAgent.id]: {
    subtitle: 'Reads your board, recommends routing',
    iconName: 'git',
    intro: 'Reading your board and triaging your open tickets…',
  },
  [featureAgent.id]: {
    subtitle: 'Plans a routed feature ticket',
    iconName: 'wrench',
    intro: 'Analyzing the routed ticket as a feature and drafting a plan…',
  },
  [bugfixAgent.id]: {
    subtitle: 'Analyzes a routed bug ticket',
    iconName: 'bug',
    intro: 'Investigating the routed ticket as a bug…',
  },
  [replyDraftAgent.id]: {
    subtitle: 'Drafts a suggested reply (never posts)',
    iconName: 'pen',
    intro: 'Drafting a suggested reply to the routed ticket…',
  },
}

// render_triage now carries ONLY the model's per-ticket routing (tiny + fast). The
// ticket DATA comes from the list_my_tickets result the provider surfaces into the
// thread — so the model no longer re-emits every ticket field token-by-token.
const recommendationSchema = z.object({ number: z.number(), route: z.string() })

const toPayload = (t: TriageTicket): TicketHandoffPayload => ({
  repo: t.repo,
  number: t.number,
  title: t.title,
  status: t.status,
  priority: t.priority,
  body: t.body,
  lastComment: t.lastComment,
  recommendation: t.recommendation,
  url: t.url,
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

type Recommendation = { number: number; route: string }

// Reads the ticket list from the surfaced list_my_tickets result and merges in the
// model's per-ticket route (from render_triage args), then renders the card. A hook
// component (not the inline render fn) so it can subscribe to the thread-results context.
const TriageCardConnected = ({
  origin,
  recommendations,
  deliver,
}: {
  origin: string
  recommendations: Recommendation[]
  deliver: DeliverFn
}) => {
  const result = useThreadResult<{ tickets?: Omit<TriageTicket, 'recommendation'>[] }>(
    'list_my_tickets'
  )
  const routeByNumber = new Map(recommendations.map((r) => [r.number, r.route]))
  const tickets: TriageTicket[] = (result?.tickets ?? []).map((t) => ({
    ...t,
    recommendation: routeByNumber.get(t.number) ?? (t.needsReply ? 'reply' : 'feature'),
  }))
  return (
    <TriageCard
      tickets={tickets}
      onRoute={(target: string, ticket: TriageTicket) =>
        deliver(origin, { kind: 'agent', agentId: target }, toPayload(ticket))
      }
      onTreatAsLead={(ticket: TriageTicket) =>
        deliver(origin, { kind: 'contract', workflow: 'lead-inbox', input: 'lead' }, toLead(ticket))
      }
    />
  )
}

export const githubTriageRenders: RenderSpec[] = [
  {
    toolName: 'render_triage',
    parameters: z.object({ origin: z.string(), recommendations: z.array(recommendationSchema) }),
    render: ({ parameters }, deliver) => {
      const { origin, recommendations } = parameters
      if (origin === undefined || recommendations === undefined) return <></>
      return (
        <TriageCardConnected origin={origin} recommendations={recommendations} deliver={deliver} />
      )
    },
  },
  {
    toolName: 'render_ticket_result',
    parameters: z.object({ title: z.string(), kind: z.string(), analysis: z.string() }),
    render: ({ parameters }) => {
      const { title, kind, analysis } = parameters
      if (title === undefined || kind === undefined || analysis === undefined) return <></>
      return <TicketResultCard data={{ title, kind, analysis }} />
    },
  },
  {
    toolName: 'render_reply_draft',
    parameters: z.object({ title: z.string(), draft: z.string() }),
    render: ({ parameters }) => {
      const { title, draft } = parameters
      if (title === undefined || draft === undefined) return <></>
      return <ReplyDraftCard data={{ title, draft }} />
    },
  },
]
