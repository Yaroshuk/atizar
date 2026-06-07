import { useHumanInTheLoop, useRenderTool } from '@copilotkit/react-core/v2'
import { z } from 'zod'
import { qualifierAgent, replyAgent } from '../../core/inbox.agent'
import type { HandoffPayload } from '../../core/handoff'
import { renderRegistry } from './renderRegistry'

// Generative-UI registration for the desktop, derived from the passports:
// `renders` maps tool name → component name; `approvals` decides which tool pauses
// the run (useHumanInTheLoop) vs. pure render (useRenderTool). Tool names are
// globally unique, so all three are registered once here.
//
// `onHandoff` is the human-trigger seam: the qualifier's VerdictCard calls it to
// hand the verdict to the reply agent. The mechanism (encode/launch) lives in the
// desktop + core; this only forwards the click.
export const useInboxActions = (
  onHandoff?: (targetId: string, payload: HandoffPayload) => void
) => {
  // renderLead -> <LeadCard /> (pure generative UI).
  useRenderTool(
    {
      name: 'renderLead',
      parameters: z.object({ from: z.string(), subject: z.string(), summary: z.string() }),
      render: ({ parameters }) => {
        const { from, subject, summary } = parameters
        if (from === undefined || subject === undefined || summary === undefined) return <></>
        const Lead = renderRegistry[replyAgent.renders.renderLead]
        return <Lead lead={{ from, subject, summary }} />
      },
    },
    []
  )

  // renderVerdict -> <VerdictCard /> (pure generative UI + manual handoff trigger).
  useRenderTool(
    {
      name: 'renderVerdict',
      parameters: z.object({
        threadId: z.string(),
        from: z.string(),
        subject: z.string(),
        summary: z.string(),
        category: z.string(),
        priority: z.string(),
        reason: z.string(),
      }),
      render: ({ parameters }) => {
        const { threadId, from, subject, summary, category, priority, reason } = parameters
        if (
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
        const Verdict = renderRegistry[qualifierAgent.renders.renderVerdict]
        const target = qualifierAgent.handoffs?.[0] ?? 'reply'
        return (
          <Verdict
            data={data}
            onDraftReply={() =>
              onHandoff?.(target, { threadId, from, subject, summary, category, priority })
            }
          />
        )
      },
    },
    [onHandoff]
  )

  // saveDraft -> <ApprovalDialog /> (human-in-the-loop pause).
  useHumanInTheLoop<{ threadId: string; body: string }>(
    {
      name: 'saveDraft',
      parameters: z.object({ threadId: z.string(), body: z.string() }),
      render: ({ args, status, respond }) => {
        if (args.threadId === undefined || args.body === undefined) return <></>
        const data = { threadId: args.threadId, body: args.body }
        const Approval = renderRegistry[replyAgent.renders.saveDraft]
        return (
          <Approval
            data={data}
            onApprove={() => {
              if (status === 'executing' && respond) void respond('approved')
            }}
          />
        )
      },
    },
    []
  )
}
