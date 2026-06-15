import type { AgentDefinition, ProviderRegistry, PromptStrategy, Provider } from '@atizar/core'

// The dev record/replay decorator (or any provider wrapper) is INJECTED — the framework helper
// never hard-imports it, so cassette-dir knowledge stays in the app. The wrap receives the
// resolved provider plus the context it needs to key a cassette (instanceKey + approvalNames).
export type BuildAgentWrap = (
  provider: Provider,
  ctx: { instanceKey: string; approvalNames: readonly string[] }
) => Provider

export interface BuildAgentArgs {
  def: AgentDefinition
  prompts: PromptStrategy
  registry: ProviderRegistry
  allowedTools: readonly string[]
  instanceKey: string
  // The fully composed instructions (workflow prompt + agent instructions); falls back to
  // def.instructions when absent.
  composedInstructions?: string
  // Optional decorator (dev record/replay). Unset ⇒ the resolved provider is returned unchanged.
  wrap?: BuildAgentWrap
}

// Resolves the provider FACTORY for an agent passport and constructs the provider from the
// passport (approvals/tools) + this agent's prompt strategy, then applies the injected `wrap`
// when one is given (unset ⇒ byte-identical to the resolved provider). `instanceKey` (wf__agent)
// is the cassette key the wrap uses.
export function buildAgentProvider(args: BuildAgentArgs): Provider {
  const { def, prompts, registry, allowedTools, instanceKey, composedInstructions, wrap } = args
  const makeProvider = registry.resolve(def.provider)
  const provider = makeProvider({
    approvalNames: def.approvals,
    surfaceTools: def.tools,
    allowedTools,
    prompts,
    instructions: composedInstructions ?? def.instructions,
    agentId: instanceKey,
  })
  return wrap ? wrap(provider, { instanceKey, approvalNames: def.approvals }) : provider
}
