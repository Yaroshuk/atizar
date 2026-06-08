import type { ServerBinding } from '../server-binding.js'
import { createQualifierPrompts } from '../../agents/qualifier.prompts.js'
import { createReplyPrompts } from '../../agents/reply.prompts.js'
import { qualifierAgent, replyAgent } from './descriptor.js'

export type { ServerBinding }

export const leadInboxServer = (origin: string): ServerBinding[] => [
  {
    agentId: qualifierAgent.id,
    prompts: createQualifierPrompts(qualifierAgent.instructions, origin),
    allowedTools: ['mcp__inbox__renderVerdict', 'mcp__gmail__get_latest_email'],
  },
  {
    agentId: replyAgent.id,
    prompts: createReplyPrompts(replyAgent.instructions),
    allowedTools: ['mcp__inbox__renderLead', 'mcp__inbox__saveDraft', 'mcp__gmail__create_draft'],
  },
]
