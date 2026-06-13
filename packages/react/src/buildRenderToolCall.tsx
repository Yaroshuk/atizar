import type { ReactNode } from 'react'
import type { ToolCall, ToolMessage } from '@atizar/core'
import type { DeliverFn, RenderSpec } from './renderSpecs'

// Local replacement for CopilotKit's useRenderToolCall: given a folded assistant tool call,
// parse its args and dispatch to the matching pure render spec (the generative-UI card).
// `deliver` is the handoff seam (POST /api/deliver). A tool with no registered render spec
// (a data-fetch tool like list_my_tickets) returns null — AgentModal already filters those
// out by `renderableToolNames` unless dev mode is on. Specs are injected (from the
// WorkflowsConfig context), not statically imported — the package holds no userland cards.
export const buildRenderToolCall =
  (renderSpecs: RenderSpec[], deliver: DeliverFn) =>
  ({ toolCall }: { toolCall: ToolCall; toolMessage?: ToolMessage }): ReactNode => {
    const name = toolCall.function?.name
    const spec = renderSpecs.find((s) => s.toolName === name)
    if (!spec) return null
    let parameters: unknown
    try {
      parameters = JSON.parse(toolCall.function?.arguments || '{}')
    } catch {
      return null // partial/streaming args — skip until the call completes
    }
    return spec.render({ parameters }, deliver)
  }
