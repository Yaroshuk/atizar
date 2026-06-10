// stdio MCP server launched by the `claude` CLI (--mcp-config). Exposes two
// Gmail tools so the model can read the latest inbox email and create a draft
// reply. Uses googleapis with an OAuth2 client + token stored on disk at
// ~/.gmail-mcp/ (paths overridable via env vars). No network calls are
// unit-tested here — live verification happens in the e2e spike (Task 6e).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { getLatestEmail } from './get-latest-email.mjs'
import { createDraft } from './create-draft.mjs'

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

const server = new McpServer({ name: 'gmail', version: '1.0.0' })

// Tool: get_latest_email
// Fetches the most-recent message from the inbox and returns structured fields.
server.registerTool(
  'get_latest_email',
  {
    description: 'Fetch the most-recent email from the Gmail inbox and return its parsed fields.',
    inputSchema: {},
  },
  async () => {
    const res = await getLatestEmail()
    return { content: [{ type: 'text', text: JSON.stringify(res) }] }
  }
)

// Tool: create_draft
// Creates a Gmail draft reply to the given thread. NEVER sends. The caller
// must supply threadId (from get_latest_email) and the reply body text.
server.registerTool(
  'create_draft',
  {
    description: 'Create a Gmail draft reply for the given thread. Does NOT send — draft only.',
    inputSchema: { threadId: z.string(), body: z.string() },
  },
  async ({ threadId, body }) => {
    const res = await createDraft({ threadId, body })
    return { content: [{ type: 'text', text: JSON.stringify(res) }] }
  }
)

await server.connect(new StdioServerTransport())
