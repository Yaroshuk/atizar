import { BuiltInAgent } from '@copilotkit/runtime/v2'
import type { AgentDefinition, ProviderRegistry, PromptStrategy, Provider } from '@platform/core'
import { withRecordReplay, recordReplayMode, cassettesDir } from './record-replay.js'

// Resolves the provider FACTORY for an agent passport and constructs the provider from
// the passport (approvals/tools) + this agent's prompt strategy, then wraps it in the
// dev record/replay decorator when DEV_RECORD_REPLAY is set (unset ⇒ byte-identical
// production path). `instanceKey` (wf__agent) is the cassette key.
//
// Returns the raw Provider so both buildAgent (CopilotKit transport) and the step-2
// RunObserver spike consume the SAME wrapped provider through one code path.
export function buildProvider(
  def: AgentDefinition,
  prompts: PromptStrategy,
  registry: ProviderRegistry,
  allowedTools: readonly string[],
  instanceKey: string
): Provider {
  const makeProvider = registry.resolve(def.provider)
  let provider = makeProvider({
    approvalNames: def.approvals,
    surfaceTools: def.tools,
    allowedTools,
    prompts,
    instructions: def.instructions,
    agentId: instanceKey,
  })

  const mode = recordReplayMode()
  if (mode) {
    provider = withRecordReplay(provider, {
      key: instanceKey,
      approvalNames: def.approvals,
      dir: cassettesDir(),
      mode,
    })
  }

  return provider
}

// Builds the CopilotKit BuiltInAgent for an agent passport, driving the provider built
// by buildProvider.
export function buildAgent(
  def: AgentDefinition,
  prompts: PromptStrategy,
  registry: ProviderRegistry,
  allowedTools: readonly string[],
  instanceKey: string
): BuiltInAgent {
  const provider = buildProvider(def, prompts, registry, allowedTools, instanceKey)
  return new BuiltInAgent({
    type: 'custom',
    factory: ({ input }) => provider.run(input),
  })
}
