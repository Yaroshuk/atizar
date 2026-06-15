import { createTool } from '@mastra/core/tools'
import type { z } from 'zod'

// Wrap a no-op "surface" tool for the Mastra provider: a tool the model CALLS to surface an
// artifact to the UI but which performs NO side effect — it just echoes its validated input back
// as the result. Render/propose/approval tools are all built this way (args = the artifact); the
// SERVER executes any real effect behind an approval gate. Generic: it carries no vertical
// knowledge — the caller supplies the tool id + the args schema.
//
// Mastra 1.41: execute receives the validated inputData as the first positional arg, and the
// optional ToolExecutionContext as the second: execute(inputData, context).
export function captureTool(id: string, schema: z.ZodTypeAny) {
  return createTool({
    id,
    description: `Surface "${id}" to the UI. Does not perform any action.`,
    inputSchema: schema,
    execute: async (inputData: unknown) => inputData,
  })
}
