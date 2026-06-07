import { useRenderTool } from '@copilotkit/react-core/v2'
import { z } from 'zod'
import type { TicketHandoffPayload } from '@platform/core'
import { renderRegistry } from './renderRegistry'
import type { TriageTicket } from './buckets'

const lastCommentSchema = z.object({ author: z.string(), body: z.string() }).nullable()
const ticketSchema = z.object({
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
  body: z.string(),
  url: z.string(),
  lastComment: lastCommentSchema,
  needsReply: z.boolean(),
  recommendation: z.string(),
})

// Build the self-contained handoff payload a routed ticket carries downstream.
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

// Generative-UI registration for the GitHub workflow. All three are pure renders
// (no approvals — read-only flow). render_triage forwards a route click to onHandoff.
export const useGithubActions = (
  onHandoff?: (targetId: string, payload: TicketHandoffPayload) => void
) => {
  useRenderTool(
    {
      name: 'render_triage',
      parameters: z.object({ tickets: z.array(ticketSchema) }),
      render: ({ parameters }) => {
        const tickets = parameters.tickets
        if (tickets === undefined) return <></>
        const Triage = renderRegistry['TriageCard']
        return (
          <Triage
            tickets={tickets}
            onRoute={(target: string, ticket: TriageTicket) => onHandoff?.(target, toPayload(ticket))}
          />
        )
      },
    },
    [onHandoff]
  )

  useRenderTool(
    {
      name: 'render_ticket_result',
      parameters: z.object({ title: z.string(), kind: z.string(), analysis: z.string() }),
      render: ({ parameters }) => {
        const { title, kind, analysis } = parameters
        if (title === undefined || kind === undefined || analysis === undefined) return <></>
        const Result = renderRegistry['TicketResultCard']
        return <Result data={{ title, kind, analysis }} />
      },
    },
    []
  )

  useRenderTool(
    {
      name: 'render_reply_draft',
      parameters: z.object({ title: z.string(), draft: z.string() }),
      render: ({ parameters }) => {
        const { title, draft } = parameters
        if (title === undefined || draft === undefined) return <></>
        const Reply = renderRegistry['ReplyDraftCard']
        return <Reply data={{ title, draft }} />
      },
    },
    []
  )
}
