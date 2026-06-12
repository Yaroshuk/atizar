import { composeInstructions } from '@platform/core'
import { createDraft } from '@platform/integrations/gmail/create-draft'
import { checkCredentials } from '@platform/integrations/gmail/check-credentials'
import { resolveCredential, atizarEnv } from '@platform/server'
import { auth as gmailAuth } from '@platform/integrations/gmail/auth'
import type { ServerBinding } from '../server-binding.js'
import {
  emailInbox,
  sorterAgent,
  replyAgent,
  readerAgent,
  spamAgent,
  importantAgent,
} from './descriptor.js'
import { createSorterPrompts, createReplyPrompts, createBatchPrompts } from './prompts.js'
import { applyEmailActions } from './apply-actions.js'

// F1's claude-cli path: each agent's PromptStrategy is built from the COMPOSED instructions
// (workflow-level prompt + the agent's own instructions), so the workflow tone/rules apply to
// every agent without repeating them in each one.
const compose = (instructions: string): string =>
  composeInstructions(emailInbox.prompt, instructions)

// Resolve the live Gmail credential for the single beta connection ('default'). A null result =
// not connected (the effects return a clear "Connect" message; the health check reports ok:false).
const resolveGmail = () =>
  resolveCredential({ integration: 'gmail', connectionId: atizarEnv.connection(), auth: gmailAuth })

// The health-check fn stays `() => Promise<HealthCheck>`; credential resolution happens inside, so a
// null credential makes checkCredentials return { ok:false } with the Connect hint (no crash).
const gmailHealth = [
  {
    name: 'gmail',
    check: async () => {
      const cred = await resolveGmail()
      return checkCredentials({ credential: cred ?? undefined })
    },
  },
]

// The aggregator's binding signature is `(origin) => ServerBinding[]`; email-inbox routes children
// via the route_emails dispatch tool (server-side), not via origin-tagged render handoffs, so no
// agent here needs `origin` — the param is omitted (a 0-arg fn satisfies the aggregator type).
export const emailInboxServer = (): ServerBinding[] => [
  {
    agentId: sorterAgent.id,
    prompts: createSorterPrompts(compose(sorterAgent.instructions)),
    // list_unread (gmail MCP) + renderSort/route_emails (inbox MCP). route_emails is a
    // dispatch tool — the model CALLS it; the server turns the call into a child (RunObserver F2).
    allowedTools: ['mcp__gmail__list_unread', 'mcp__inbox__renderSort', 'mcp__inbox__route_emails'],
    health: gmailHealth,
  },
  {
    agentId: replyAgent.id,
    prompts: createReplyPrompts(compose(replyAgent.instructions)),
    allowedTools: ['mcp__gmail__get_email', 'mcp__inbox__renderLead', 'mcp__inbox__saveDraft'],
    effects: {
      // The approved/edited form { threadId, body } IS the createDraft args, byte-verbatim.
      // Resolve the live Gmail credential first; a null credential = not connected.
      saveDraft: async (form) => {
        const cred = await resolveGmail()
        if (!cred) return { error: 'Gmail not connected — click Connect in the header' }
        return createDraft(
          { threadId: String(form.threadId ?? ''), body: String(form.body ?? '') },
          { credential: cred }
        )
      },
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
      applyActions: async (form: Record<string, unknown>) => {
        const cred = await resolveGmail()
        if (!cred)
          return {
            applied: 0,
            failed: [],
            byAction: {},
            error: 'Gmail not connected — click Connect in the header',
          }
        return applyEmailActions(form, { credential: cred })
      },
    },
    health: gmailHealth,
  })),
]
