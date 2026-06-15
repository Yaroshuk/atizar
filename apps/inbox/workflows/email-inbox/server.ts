import { createDraft } from '@atizar/integrations/gmail/create-draft'
import { checkCredentials } from '@atizar/integrations/gmail/check-credentials'
import { resolveCredential, atizarEnv, isDemo } from '@atizar/server'
import { auth as gmailAuth } from '@atizar/integrations/gmail/auth'
import type { ServerBinding } from '../server-binding.js'
import { sorterAgent, replyAgent, readerAgent, spamAgent, importantAgent } from './descriptor.js'
import { sorterPrompt, replyPrompt, readerPrompt, spamPrompt, importantPrompt } from './prompts.js'
import { applyEmailActions } from './apply-actions.js'

// The prompt strategies are TURN-ONLY (no identity prose). The composed identity (workflow prompt
// ⊕ each agent's instructions) is prepended by the provider at run time — see createServer.ts
// (composeInstructions → ProviderConfig.instructions), so no agent re-bakes it here.

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

// In demo mode there is no Gmail credential; effects return a believable fake-success shape so the
// full approve→executed→finished path renders without touching Gmail. The counter makes draftIds
// look distinct across approvals within a session.
let demoDraftSeq = 0
const demoSaveDraft = () => ({ ok: true as const, draftId: `demo-${++demoDraftSeq}` })
const demoApplyActions = (form: Record<string, unknown>) => {
  // The approved batch form is `{ items: Row[] }` (the EmailBatchCard emits it, applyEmailActions
  // reads it) — each row carries an `action`. Count by action so the demo result matches reality.
  const items = Array.isArray(form.items) ? form.items : []
  const byAction: Record<string, number> = {}
  for (const a of items as Array<{ action?: string }>) {
    const k = String(a?.action ?? 'unknown')
    byAction[k] = (byAction[k] ?? 0) + 1
  }
  return { applied: items.length, failed: [] as unknown[], byAction }
}

// The aggregator's binding signature is `(origin) => ServerBinding[]`; email-inbox routes children
// via the route_emails dispatch tool (server-side), not via origin-tagged render handoffs, so no
// agent here needs `origin` — the param is omitted (a 0-arg fn satisfies the aggregator type).
export const emailInboxServer = (): ServerBinding[] => [
  {
    agentId: sorterAgent.id,
    prompts: sorterPrompt,
    // list_unread (gmail MCP) + renderSort/route_emails (inbox MCP). route_emails is a
    // dispatch tool — the model CALLS it; the server turns the call into a child (RunObserver F2).
    allowedTools: ['mcp__gmail__list_unread', 'mcp__inbox__renderSort', 'mcp__inbox__route_emails'],
    health: gmailHealth,
  },
  {
    agentId: replyAgent.id,
    prompts: replyPrompt,
    allowedTools: ['mcp__gmail__get_email', 'mcp__inbox__renderLead', 'mcp__inbox__saveDraft'],
    effects: {
      // The approved/edited form { threadId, body } IS the createDraft args, byte-verbatim.
      // Resolve the live Gmail credential first; a null credential = not connected.
      saveDraft: async (form) => {
        if (isDemo()) return demoSaveDraft()
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
    { agent: readerAgent, prompts: readerPrompt },
    { agent: spamAgent, prompts: spamPrompt },
    { agent: importantAgent, prompts: importantPrompt },
  ].map(({ agent, prompts }) => ({
    agentId: agent.id,
    prompts,
    allowedTools: ['mcp__inbox__applyActions'],
    effects: {
      applyActions: async (form: Record<string, unknown>) => {
        if (isDemo()) return demoApplyActions(form)
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
