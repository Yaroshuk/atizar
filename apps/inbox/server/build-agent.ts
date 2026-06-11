import type { AgentDefinition, ProviderRegistry, PromptStrategy, Provider } from '@platform/core'
import { withRecordReplay, recordReplayMode, cassettesDir } from './record-replay.js'

// Resolves the provider FACTORY for an agent passport and constructs the provider from
// the passport (approvals/tools) + this agent's prompt strategy, then wraps it in the
// dev record/replay decorator when DEV_RECORD_REPLAY is set (unset ⇒ byte-identical
// production path). `instanceKey` (wf__agent) is the cassette key. The RunObserver spine
// is the sole consumer (the CopilotKit transport was dropped at step 6).
// `instructionsOverride` lets the caller pass a composed string (workflow prompt +
// agent instructions) without mutating the definition — falls back to def.instructions
// when absent so existing callers are unaffected.
export function buildProvider(
  def: AgentDefinition,
  prompts: PromptStrategy,
  registry: ProviderRegistry,
  allowedTools: readonly string[],
  instanceKey: string,
  instructionsOverride?: string
): Provider {
  const makeProvider = registry.resolve(def.provider)
  let provider = makeProvider({
    approvalNames: def.approvals,
    surfaceTools: def.tools,
    allowedTools,
    prompts,
    instructions: instructionsOverride ?? def.instructions,
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
