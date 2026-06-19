import { z } from 'zod'
import type { RunAgentInput } from '@ag-ui/client'
import {
  decodeHandoff,
  type AgentDefinition,
  type ProviderRegistry,
  type PromptStrategy,
  type Provider,
} from '@atizar/core'
import { buildAgentProvider, isDemo } from '@atizar/server'
import {
  withRecordReplay,
  recordReplayMode,
  cassettesDir,
  demoCassettesDir,
} from './record-replay.js'

// Demo only: give each email a distinct cassette by suffixing the agent's cassette key with the
// handoff email's messageId. So two reply instances (different senders) replay DIFFERENT recordings
// instead of sharing one. A run whose handoff carries no `email.messageId` (the sorter's input scan,
// the batch reader/spam/important agents) returns undefined → falls back to the shared cassette.
const DemoEmailKey = z.object({ email: z.object({ messageId: z.string() }) })
const demoCassetteKeyOf =
  (instanceKey: string) =>
  (input: RunAgentInput): string | undefined => {
    const decoded = decodeHandoff(input, DemoEmailKey)
    return decoded ? `${instanceKey}__${decoded.email.messageId}` : undefined
  }

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
            keyOf: mode === 'demo' ? demoCassetteKeyOf(ctx.instanceKey) : undefined,
          })
      : undefined,
  })
}
