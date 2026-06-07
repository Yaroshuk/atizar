import { BuiltInAgent } from '@copilotkit/runtime/v2'
import type { AgentDefinition, ProviderRegistry, PromptStrategy } from '@platform/core'

// Builds the CopilotKit BuiltInAgent for an agent passport: resolves the provider
// FACTORY from the registry by `def.provider`, then constructs the provider from the
// passport (approvals/tools) plus this agent's prompt strategy. All approval/turn
// logic lives in the provider, so there is no hardcoded tool name here.
export function buildAgent(
  def: AgentDefinition,
  prompts: PromptStrategy,
  registry: ProviderRegistry,
  allowedTools: readonly string[]
): BuiltInAgent {
  const makeProvider = registry.resolve(def.provider)
  const provider = makeProvider({
    approvalNames: def.approvals,
    surfaceTools: def.tools,
    allowedTools,
    prompts,
  })
  return new BuiltInAgent({
    type: 'custom',
    factory: ({ input }) => provider.run(input),
  })
}
