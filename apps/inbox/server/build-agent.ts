import type { AgentDefinition, ProviderRegistry, PromptStrategy, Provider } from '@atizar/core'
import { buildAgentProvider, isDemo } from '@atizar/server'
import {
  withRecordReplay,
  recordReplayMode,
  cassettesDir,
  demoCassettesDir,
} from './record-replay.js'

// App wrapper over @atizar/server's buildAgentProvider (WS7 move 8). It injects the dev
// record/replay decorator built from the APP's cassette directories — DEV_RECORD_REPLAY unset ⇒
// no wrap ⇒ byte-identical production path. Signature unchanged so index.ts + eval/runner.ts are
// unaffected.
export function buildProvider(
  def: AgentDefinition,
  prompts: PromptStrategy,
  registry: ProviderRegistry,
  allowedTools: readonly string[],
  instanceKey: string,
  composedInstructions?: string
): Provider {
  const mode = isDemo() ? 'demo' : recordReplayMode()
  return buildAgentProvider({
    def,
    prompts,
    registry,
    allowedTools,
    instanceKey,
    composedInstructions,
    wrap: mode
      ? (provider, ctx) =>
          withRecordReplay(provider, {
            key: ctx.instanceKey,
            approvalNames: ctx.approvalNames,
            dir: mode === 'demo' ? demoCassettesDir() : cassettesDir(),
            mode,
          })
      : undefined,
  })
}
