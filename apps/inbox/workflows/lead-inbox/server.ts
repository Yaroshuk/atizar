import type { ServerBinding } from '../server-binding.js'
import { createQualifierPrompts } from '../../agents/qualifier.prompts.js'
import { createReplyPrompts } from '../../agents/reply.prompts.js'
import { qualifierAgent, replyAgent } from './descriptor.js'
import { createDraft } from '@atizar/integrations/gmail/create-draft'
import { resolveCredential, atizarEnv } from '@atizar/server'
import { auth as gmailAuth } from '@atizar/integrations/gmail/auth'

// Resolve the live Gmail credential for the single beta connection ('default'). A null result =
// not connected (the effect returns a clear "Connect" message).
const resolveGmail = () =>
  resolveCredential({ integration: 'gmail', connectionId: atizarEnv.connection(), auth: gmailAuth })

export const leadInboxServer = (origin: string): ServerBinding[] => [
  {
    agentId: qualifierAgent.id,
    prompts: createQualifierPrompts(qualifierAgent.instructions, origin),
    allowedTools: ['mcp__inbox__renderVerdict', 'mcp__gmail__get_latest_email'],
  },
  {
    agentId: replyAgent.id,
    prompts: createReplyPrompts(replyAgent.instructions),
    // create_draft is GONE from the model's allow-list — it is now a server effect.
    allowedTools: ['mcp__inbox__renderLead', 'mcp__inbox__saveDraft'],
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
  },
]
