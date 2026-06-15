// stdio MCP server launched by the `claude` CLI (--mcp-config). Exposes the two
// inbox tools so the model can CALL them. Handlers return trivial acks: the UI is
// driven by AG-UI events the provider emits from the stream, not by these results.
// saveDraft is rarely executed — the provider kills the run at the call.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'inbox', version: '1.0.0' })

server.registerTool(
  'renderLead',
  {
    description: 'Surface the incoming email as a card in the UI.',
    inputSchema: { from: z.string(), subject: z.string(), summary: z.string() },
  },
  async () => ({ content: [{ type: 'text', text: 'Email surfaced to the user.' }] })
)

server.registerTool(
  'saveDraft',
  {
    description:
      'Ask the human to approve saving a draft reply. Args carry the Gmail thread id and the proposed reply body.',
    inputSchema: { threadId: z.string(), body: z.string() },
  },
  async () => ({ content: [{ type: 'text', text: 'Awaiting human approval.' }] })
)

// ── email-inbox tools ────────────────────────────────────────────────────────
// All three are pure echoes (surfaces): the SERVER does the real work from the
// observed tool call — renderSort fills the card, route_emails dispatches a child
// (RunObserver), applyActions opens the gate + runs the server effect on approval.
// NONE of them performs any Gmail action.

// Required fields MUST match the workflow's EmailRefSchema decode (descriptor.ts): a route_emails
// call missing messageId/threadId/from/subject is rejected here (the model sees the error and
// retries) rather than silently failing decodeHandoff on the receiving child. date/snippet are
// optional (passed through from list_unread, never consumed downstream).
const emailRefShape = {
  messageId: z.string(),
  threadId: z.string(),
  from: z.string(),
  subject: z.string(),
  date: z.string().optional(),
  snippet: z.string().optional(),
}

server.registerTool(
  'renderSort',
  {
    description: 'Surface a short summary of how the unread inbox was sorted.',
    inputSchema: {
      summary: z.string(),
      counts: z
        .object({
          reply: z.number(),
          reader: z.number(),
          spam: z.number(),
          important: z.number(),
        })
        .partial()
        .optional(),
    },
  },
  async () => ({ content: [{ type: 'text', text: 'Sort summary surfaced to the user.' }] })
)

server.registerTool(
  'route_emails',
  {
    description:
      'Dispatch emails to a worker. Call once per destination: { to: "reply", email } for a single reply, or { to: "reader"|"spam"|"important", emails: [...] } for a batch.',
    inputSchema: {
      to: z.string(),
      email: z.object(emailRefShape).optional(),
      emails: z.array(z.object(emailRefShape)).optional(),
    },
  },
  async () => ({ content: [{ type: 'text', text: 'Routed.' }] })
)

server.registerTool(
  'applyActions',
  {
    description:
      'Ask the human to apply a per-row action to a batch of emails. Args carry the proposed actions; the human may edit any row before approving. No action is performed here.',
    inputSchema: {
      items: z.array(
        z.object({
          messageId: z.string(),
          from: z.string().optional(),
          subject: z.string().optional(),
          action: z.enum(['read', 'trash', 'star', 'keep']),
        })
      ),
    },
  },
  async () => ({ content: [{ type: 'text', text: 'Awaiting human approval.' }] })
)

await server.connect(new StdioServerTransport())
