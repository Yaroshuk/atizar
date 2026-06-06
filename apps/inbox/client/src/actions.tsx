import { useHumanInTheLoop, useRenderTool } from '@copilotkit/react-core/v2'
import { z } from 'zod'
import { inboxAgent } from '../../core/inbox.agent'
import { renderRegistry } from './renderRegistry'

// Generative-UI registration for the inbox agent, derived from the passport:
// `renders` maps tool name → component name; `approvals` decides which tool pauses
// the run (useHumanInTheLoop) vs. pure render (useRenderTool).
//
// The literal tool names below ("renderLead", "saveDraft") and their arg schemas
// must match `inboxAgent.tools` — the CopilotKit hooks need a static name + Zod
// shape, so this is the one place tool identity is restated. The component, though,
// is resolved via the passport (`renders`) through `renderRegistry`; a missing
// registry entry surfaces (renders undefined) rather than silently falling back.
export const useInboxActions = () => {
  // renderLead -> <LeadCard /> (pure generative UI).
  useRenderTool(
    {
      name: 'renderLead',
      parameters: z.object({ from: z.string(), subject: z.string(), summary: z.string() }),
      render: ({ parameters }) => {
        const { from, subject, summary } = parameters
        if (from === undefined || subject === undefined || summary === undefined) return <></>
        const Lead = renderRegistry[inboxAgent.renders.renderLead]
        return <Lead lead={{ from, subject, summary }} />
      },
    },
    []
  )

  // saveDraft -> <ApprovalDialog /> (human-in-the-loop pause).
  useHumanInTheLoop<{ threadId: string; body: string }>(
    {
      name: 'saveDraft',
      parameters: z.object({ threadId: z.string(), body: z.string() }),
      render: ({ args, status, respond }) => {
        if (args.threadId === undefined || args.body === undefined) return <></>
        const data = { threadId: args.threadId, body: args.body }
        const Approval = renderRegistry[inboxAgent.renders.saveDraft]
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
