import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getLatestEmail } from '@platform/integrations/gmail-basic/get-latest-email'

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

// The ONLY real-effect read tool — the qualifier's inbox reader. Calls the same Gmail read as
// the stdio MCP `get_latest_email`. No write tools exist for any Mastra agent (effects are
// server-side).
export const getLatestEmailTool = createTool({
  id: 'get_latest_email',
  description: 'Read the most recent email in the inbox.',
  inputSchema: z.object({}),
  execute: async () => getLatestEmail(),
})
