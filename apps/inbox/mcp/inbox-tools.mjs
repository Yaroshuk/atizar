// stdio MCP server launched by the `claude` CLI (--mcp-config). Exposes the two
// inbox tools so the model can CALL them. Handlers return trivial acks: the UI is
// driven by AG-UI events the provider emits from the stream, not by these results.
// confirmSend is rarely executed — the provider kills the run at the call.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'inbox', version: '1.0.0' })

server.registerTool(
  'renderLead',
  {
    description: 'Surface a lead email as a card in the UI.',
    inputSchema: { id: z.number(), from: z.string(), subject: z.string(), intent: z.string() },
  },
  async () => ({ content: [{ type: 'text', text: 'Lead surfaced to the user.' }] }),
)

server.registerTool(
  'confirmSend',
  {
    description: 'Ask the human to approve sending a reply to the lead.',
    inputSchema: { leadId: z.number(), message: z.string() },
  },
  async () => ({ content: [{ type: 'text', text: 'Awaiting human approval.' }] }),
)

await server.connect(new StdioServerTransport())
