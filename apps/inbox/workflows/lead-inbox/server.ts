import type { PromptStrategy } from '@platform/core'
import { createQualifierPrompts } from '../../agents/qualifier.prompts.js'
import { createReplyPrompts } from '../../agents/reply.prompts.js'
import { qualifierAgent, replyAgent } from './descriptor.js'

// Per-agent server runtime bindings: the prompt strategy + the fully-qualified MCP
// allow-list (the single-entry-point boundary). `origin` is the workflow id, woven
// into handoff-emitting render prompts so reused copies route correctly.
export type ServerBinding = { agentId: string; prompts: PromptStrategy; allowedTools: string[] }

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
