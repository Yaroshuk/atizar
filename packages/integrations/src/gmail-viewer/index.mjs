// stdio MCP server launched by the `claude` CLI (--mcp-config): READ-ONLY Gmail
// inbox tools for the email-inbox sorter/reply agents. Mutations (markRead/trash/
// star) are SERVER-EXECUTED effects behind approval gates and are NEVER exposed
// to the model — the boot-time classification kernel enforces this.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { listUnread } from './list-unread.mjs'
import { getEmail } from './get-email.mjs'

const server = new McpServer({ name: 'gmail-viewer', version: '1.0.0' })

// Tool: list_unread — metadata + snippet only, no bodies (bounded payload).
server.registerTool(
  'list_unread',
  {
    description:
      'List unread inbox emails from the last N hours (default 24). Returns metadata + a short snippet per email — no bodies.',
    inputSchema: { sinceHours: z.number().int().positive().optional() },
  },
  async ({ sinceHours }) => {
    const res = await listUnread({ sinceHours })
    return { content: [{ type: 'text', text: JSON.stringify(res) }] }
  }
)

// Tool: get_email — the full text body of ONE email by id.
server.registerTool(
  'get_email',
  {
    description:
      'Fetch one email by messageId and return its parsed fields including the full text body.',
    inputSchema: { messageId: z.string() },
  },
  async ({ messageId }) => {
    const res = await getEmail({ messageId })
    return { content: [{ type: 'text', text: JSON.stringify(res) }] }
  }
)

await server.connect(new StdioServerTransport())
