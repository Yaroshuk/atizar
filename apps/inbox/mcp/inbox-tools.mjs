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

server.registerTool(
  'renderVerdict',
  {
    description: 'Surface a qualified lead verdict as a card in the UI.',
    inputSchema: {
      origin: z.string(),
      threadId: z.string(),
      from: z.string(),
      subject: z.string(),
      summary: z.string(),
      category: z.string(),
      priority: z.string(),
      reason: z.string(),
    },
  },
  async () => ({ content: [{ type: 'text', text: 'Verdict surfaced to the user.' }] })
)

await server.connect(new StdioServerTransport())
