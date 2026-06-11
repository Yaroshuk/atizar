import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getLatestEmail } from '@platform/integrations/gmail-basic/get-latest-email'
import { listUnread } from '@platform/integrations/gmail-viewer/list-unread'
import { getEmail } from '@platform/integrations/gmail-viewer/get-email'

// Render/propose tools are NO-OPs whose args = the artifact. They appear as tool-calls (the
// mapper surfaces them) but perform no side effect — the SERVER executes effects (step 4) and
// fills the card from the tool-call args. saveDraft is the approval/propose tool.
// Mastra 1.41: execute receives the validated inputData as the first positional arg,
// and the optional ToolExecutionContext as the second: execute(inputData, context).
function captureTool(id: string, schema: z.ZodTypeAny) {
  return createTool({
    id,
    description: `Surface "${id}" to the UI. Does not perform any action.`,
    inputSchema: schema,
    execute: async (inputData: unknown) => inputData,
  })
}

export const renderLeadTool = captureTool(
  'renderLead',
  z.object({ from: z.string(), subject: z.string(), summary: z.string() })
)
export const renderVerdictTool = captureTool('renderVerdict', z.object({}).passthrough())
export const saveDraftTool = captureTool(
  'saveDraft',
  z.object({ threadId: z.string(), body: z.string() })
)

// The lead-inbox qualifier's inbox reader. Calls the same Gmail read as the stdio MCP
// `get_latest_email`. No write tools exist for any Mastra agent (effects are server-side).
export const getLatestEmailTool = createTool({
  id: 'get_latest_email',
  description: 'Read the most recent email in the inbox.',
  inputSchema: z.object({}),
  execute: async () => getLatestEmail(),
})

// ── email-inbox read tools ───────────────────────────────────────────────────
// Call the gmail-viewer functions (the SAME functions the stdio MCP wrapper delegates to).
// Reads only — no mutation is ever a Mastra tool (effects are server-side, behind a gate).
export const listUnreadTool = createTool({
  id: 'list_unread',
  description:
    'List unread inbox emails of the last N hours (default 24). Metadata + snippet, no bodies.',
  inputSchema: z.object({ sinceHours: z.number().int().positive().optional() }),
  execute: async (inputData: { sinceHours?: number }) => listUnread(inputData ?? {}),
})

export const getEmailTool = createTool({
  id: 'get_email',
  description: 'Fetch one email by messageId, including the full text body.',
  inputSchema: z.object({ messageId: z.string() }),
  execute: async (inputData: { messageId: string }) => getEmail(inputData),
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

// ── github-triage tools (NOT Mastra-ready — registered so PROVIDER=mastra BOOTS) ──────────────
// github-triage runs on claude-cli only (it reads the private Magma board via the gh CLI). Under
// PROVIDER=mastra EVERY workflow's agents resolve through the Mastra factory at boot, so these tool
// names must exist or the runner's fail-fast aborts the whole server. The three renders are real
// capture surfaces (identical in kind to renderSort); the two reads are HONEST stubs — a
// github-triage run on the Mastra provider is unsupported and says so, rather than silently
// returning empty data. Wiring the real gh reads as Mastra tools is a deferred follow-up.
function unsupportedOnMastra(id: string) {
  return createTool({
    id,
    description: `${id} — not available on the Mastra provider (github-triage runs on claude-cli).`,
    inputSchema: z.object({}).passthrough(),
    execute: async () => ({
      error: `"${id}" is not supported on the Mastra provider yet; run github-triage on the claude-cli provider.`,
    }),
  })
}

export const listMyTicketsTool = unsupportedOnMastra('list_my_tickets')
export const getTicketTool = unsupportedOnMastra('get_ticket')
export const renderTriageTool = captureTool('render_triage', z.object({}).passthrough())
export const renderTicketResultTool = captureTool('render_ticket_result', z.object({}).passthrough())
export const renderReplyDraftTool = captureTool('render_reply_draft', z.object({}).passthrough())
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
