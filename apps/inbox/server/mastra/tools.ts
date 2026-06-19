import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { listUnread } from '@atizar/integrations/gmail/list-unread'
import { getEmail } from '@atizar/integrations/gmail/get-email'
import { resolveCredential, atizarEnv } from '@atizar/server'
import { captureTool } from '@atizar/server/mastra'
import { auth as gmailAuth } from '@atizar/integrations/gmail/auth'

// Resolve the live Gmail credential for the single beta connection ('default'); null = not connected.
const resolveGmail = () =>
  resolveCredential({ integration: 'gmail', connectionId: atizarEnv.connection(), auth: gmailAuth })

// captureTool (from @atizar/server) wraps a no-op "surface" tool: the model CALLS it but it
// performs no side effect — the SERVER executes effects (step 4) and fills the card from the
// tool-call args. saveDraft is the approval/propose tool.
//
// renderLead + saveDraft are the reply agent's surfaces (a generic reply contract: one email →
// a drafted reply for approval, owned by email-inbox). renderLead is a no-op render card;
// saveDraft is the approval/propose tool whose args = the proposed draft.
export const renderLeadTool = captureTool(
  'renderLead',
  z.object({ from: z.string(), subject: z.string(), summary: z.string() })
)
export const saveDraftTool = captureTool(
  'saveDraft',
  z.object({ threadId: z.string(), body: z.string() })
)

// ── email-inbox read tools ───────────────────────────────────────────────────
// Call the gmail integration functions (the SAME functions the stdio MCP wrapper delegates to).
// Reads only — no mutation is ever a Mastra tool (effects are server-side, behind a gate).
export const listUnreadTool = createTool({
  id: 'list_unread',
  description:
    'List unread inbox emails of the last N hours (default 24). Metadata + snippet, no bodies.',
  inputSchema: z.object({ sinceHours: z.number().int().positive().optional() }),
  execute: async (inputData: { sinceHours?: number }) => {
    const cred = await resolveGmail()
    if (!cred) return { error: 'Gmail not connected — click Connect in the header' }
    return listUnread(inputData ?? {}, { credential: cred })
  },
})

export const getEmailTool = createTool({
  id: 'get_email',
  description: 'Fetch one email by messageId, including the full text body.',
  inputSchema: z.object({ messageId: z.string() }),
  execute: async (inputData: { messageId: string }) => {
    const cred = await resolveGmail()
    if (!cred) return { error: 'Gmail not connected — click Connect in the header' }
    return getEmail(inputData, { credential: cred })
  },
})

// ── email-inbox capture (no-op surface) tools ────────────────────────────────
// The model CALLS them; the SERVER acts on the observed call. route_emails is a dispatch tool —
// surfacing the call is enough (the RunObserver dispatches the child). renderSort is the sorter's
// summary card. applyActions is the batch approval/propose tool (opens the gate).
export const routeEmailsTool = captureTool(
  'route_emails',
  z.object({
    to: z.string(),
    email: z.record(z.unknown()).optional(),
    emails: z.array(z.record(z.unknown())).optional(),
  })
)
export const renderSortTool = captureTool('renderSort', z.object({}).passthrough())

export const applyActionsTool = captureTool(
  'applyActions',
  z.object({
    items: z.array(
      z.object({
        messageId: z.string(),
        from: z.string().optional(),
        subject: z.string().optional(),
        action: z.enum(['read', 'trash', 'star', 'keep']),
      })
    ),
  })
)
