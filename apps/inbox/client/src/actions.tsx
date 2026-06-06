import { useHumanInTheLoop, useRenderTool } from '@copilotkit/react-core/v2'
import { z } from 'zod'
import { inboxAgent } from '../../core/inbox.agent'
import { renderRegistry } from './renderRegistry'

// Generative-UI registration for the inbox agent, derived from the passport:
// `renders` maps tool name → component name; `approvals` decides which tool pauses
// the run (useHumanInTheLoop) vs. pure render (useRenderTool).
//
// The literal tool names below ("renderLead", "confirmSend") and their arg schemas
// must match `inboxAgent.tools` — the CopilotKit hooks need a static name + Zod
// shape, so this is the one place tool identity is restated. The component, though,
// is resolved via the passport (`renders`) through `renderRegistry`; a missing
// registry entry surfaces (renders undefined) rather than silently falling back.
export function useInboxActions() {
  // renderLead -> <LeadCard /> (pure generative UI).
  useRenderTool(
    {
      name: 'renderLead',
      parameters: z.object({
        id: z.number(),
        from: z.string(),
        subject: z.string(),
        intent: z.string(),
      }),
      render: ({ parameters }) => {
        const { id, from, subject, intent } = parameters
        if (
          id === undefined ||
          from === undefined ||
          subject === undefined ||
          intent === undefined
        ) {
          return <></>
        }
        const Lead = renderRegistry[inboxAgent.renders.renderLead]
        return <Lead lead={{ id, from, subject, intent }} />
      },
    },
    []
  )

  // confirmSend -> <ApprovalDialog /> (human-in-the-loop pause).
  useHumanInTheLoop<{ leadId: number; message: string }>(
    {
      name: 'confirmSend',
      parameters: z.object({ leadId: z.number(), message: z.string() }),
      render: ({ args, status, respond }) => {
        if (args.leadId === undefined || args.message === undefined) {
          return <></>
        }
        const data = { leadId: args.leadId, message: args.message }
        const Approval = renderRegistry[inboxAgent.renders.confirmSend]
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
