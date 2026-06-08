import { createTriagePrompts } from '../../agents/triage.prompts.js'
import { createTicketPrompts } from '../../agents/ticket.prompts.js'
import type { ServerBinding } from '../lead-inbox/server.js'
import { triageAgent, featureAgent, bugfixAgent, replyDraftAgent } from './descriptor.js'

export const githubTriageServer = (origin: string): ServerBinding[] => [
  {
    agentId: triageAgent.id,
    prompts: createTriagePrompts(triageAgent.instructions, origin),
    allowedTools: ['mcp__github__list_my_tickets', 'mcp__github__get_ticket', 'mcp__github__render_triage'],
  },
  {
    agentId: featureAgent.id,
    prompts: createTicketPrompts(featureAgent.instructions, { renderTool: 'render_ticket_result', kind: 'feature' }),
    allowedTools: ['mcp__github__render_ticket_result'],
  },
  {
    agentId: bugfixAgent.id,
    prompts: createTicketPrompts(bugfixAgent.instructions, { renderTool: 'render_ticket_result', kind: 'bug' }),
    allowedTools: ['mcp__github__render_ticket_result'],
  },
  {
    agentId: replyDraftAgent.id,
    prompts: createTicketPrompts(replyDraftAgent.instructions, { renderTool: 'render_reply_draft', kind: 'reply' }),
    allowedTools: ['mcp__github__render_reply_draft'],
  },
]
