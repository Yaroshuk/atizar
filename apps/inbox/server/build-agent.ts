import { BuiltInAgent } from '@copilotkit/runtime/v2'
import type { AgentDefinition, ProviderRegistry, PromptStrategy } from '@platform/core'
import { withRecordReplay, recordReplayMode, cassettesDir } from './record-replay.js'

// Builds the CopilotKit BuiltInAgent for an agent passport: resolves the provider
// FACTORY from the registry by `def.provider`, then constructs the provider from the
// passport (approvals/tools) plus this agent's prompt strategy. All approval/turn
// logic lives in the provider, so there is no hardcoded tool name here.
//
// `instanceKey` is the runtime instance id (wf__agent) — used only as the cassette
// key when DEV_RECORD_REPLAY is set. When unset, the provider is returned unwrapped
// (byte-identical production path).
export function buildAgent(
  def: AgentDefinition,
  prompts: PromptStrategy,
  registry: ProviderRegistry,
  allowedTools: readonly string[],
  instanceKey: string
): BuiltInAgent {
  const makeProvider = registry.resolve(def.provider)
  let provider = makeProvider({
    approvalNames: def.approvals,
    surfaceTools: def.tools,
    allowedTools,
    prompts,
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

  return new BuiltInAgent({
    type: 'custom',
    factory: ({ input }) => provider.run(input),
  })
}
