import { composeInstructions } from '@platform/core'
import { createDraft } from '@platform/integrations/gmail-basic/create-draft'
import { checkCredentials } from '@platform/integrations/gmail-viewer/check-credentials'
import type { ServerBinding } from '../server-binding.js'
import { emailInbox, sorterAgent, replyAgent, readerAgent, spamAgent, importantAgent } from './descriptor.js'
import { createSorterPrompts, createReplyPrompts, createBatchPrompts } from './prompts.js'
import { applyEmailActions } from './apply-actions.js'

// F1's claude-cli path: each agent's PromptStrategy is built from the COMPOSED instructions
// (workflow-level prompt + the agent's own instructions), so the workflow tone/rules apply to
// every agent without repeating them in each one.
const compose = (instructions: string): string => composeInstructions(emailInbox.prompt, instructions)
const gmailHealth = [{ name: 'gmail', check: checkCredentials }]

// The aggregator's binding signature is `(origin) => ServerBinding[]`; email-inbox routes children
// via the route_emails dispatch tool (server-side), not via origin-tagged render handoffs, so no
// agent here needs `origin` — the param is omitted (a 0-arg fn satisfies the aggregator type).
export const emailInboxServer = (): ServerBinding[] => [
  {
    agentId: sorterAgent.id,
    prompts: createSorterPrompts(compose(sorterAgent.instructions)),
    // list_unread (gmail-viewer MCP) + renderSort/route_emails (inbox MCP). route_emails is a
    // dispatch tool — the model CALLS it; the server turns the call into a child (RunObserver F2).
    allowedTools: [
      'mcp__gmail-viewer__list_unread',
      'mcp__inbox__renderSort',
      'mcp__inbox__route_emails',
    ],
    health: gmailHealth,
  },
  {
    agentId: replyAgent.id,
    prompts: createReplyPrompts(compose(replyAgent.instructions)),
    allowedTools: ['mcp__gmail-viewer__get_email', 'mcp__inbox__renderLead', 'mcp__inbox__saveDraft'],
    effects: {
      // The approved/edited form { threadId, body } IS the createDraft args, byte-verbatim.
      saveDraft: (form) =>
        createDraft({ threadId: String(form.threadId ?? ''), body: String(form.body ?? '') }),
    },
    health: gmailHealth,
  },
  ...[
    { agent: readerAgent, def: 'read' as const },
    { agent: spamAgent, def: 'trash' as const },
    { agent: importantAgent, def: 'star' as const },
  ].map(({ agent, def }) => ({
    agentId: agent.id,
    prompts: createBatchPrompts(compose(agent.instructions), def),
    allowedTools: ['mcp__inbox__applyActions'],
    effects: {
      applyActions: (form: Record<string, unknown>) => applyEmailActions(form),
    },
    health: gmailHealth,
  })),
]
