// stdio MCP server launched by the `claude` CLI (--mcp-config): READ-ONLY Gmail
// inbox tools for the email-inbox sorter/reply agents.
// Writes (create_draft) and mutations (markRead/trash/star) are SERVER-EXECUTED
// effects behind approval gates and are NEVER exposed to the model (I2/I9).
//
// This is a `.mts` file run via the tsx loader (`node --import tsx`) because it imports
// `@atizar/server` (resolveCredential) which is `.ts` source with no build step —
// plain `node` cannot load `.ts`. The MCP child inherits the repo-root cwd + ATIZAR_*
// env, so `resolveCredential` reads the same encrypted credential store.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { resolveCredential, atizarEnv } from '@atizar/server'
import { auth } from '@atizar/integrations/gmail/auth'
import { listUnread } from '@atizar/integrations/gmail/list-unread'
import { getEmail } from '@atizar/integrations/gmail/get-email'

const server = new McpServer({ name: 'gmail', version: '1.0.0' })

// Resolve the live Gmail credential for the single beta connection ('default').
const resolveCred = () =>
  resolveCredential({ integration: 'gmail', connectionId: atizarEnv.connection(), auth })

const notConnected = {
  content: [
    {
      type: 'text' as const,
      text: JSON.stringify({ error: 'Gmail not connected — click Connect in the header' }),
    },
  ],
}

const asText = (res: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(res) }],
})

// Tool: list_unread — metadata + snippet only, no bodies (bounded payload).
server.registerTool(
  'list_unread',
  {
    description:
      'List unread inbox emails from the last N hours (default 24). Returns metadata + a short snippet per email — no bodies.',
    inputSchema: { sinceHours: z.number().int().positive().optional() },
  },
  async ({ sinceHours }) => {
    const cred = await resolveCred()
    if (!cred) return notConnected
    return asText(await listUnread({ sinceHours }, { credential: cred }))
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
    const cred = await resolveCred()
    if (!cred) return notConnected
    return asText(await getEmail({ messageId }, { credential: cred }))
  }
)

await server.connect(new StdioServerTransport())
