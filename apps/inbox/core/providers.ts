import type { RunAgentInput, BaseEvent } from '@ag-ui/client'

// A provider is the model/runtime seam: given the run input it yields AG-UI events.
export interface Provider {
  run(input: RunAgentInput): AsyncIterable<BaseEvent>
}

// A per-agent prompt strategy: how this agent turns a run into CLI prompts.
// buildFirst handles turn 1 (standalone OR handoff-seeded). buildResume handles a
// resumed run after a human approval (null = no usable resume → the provider errors).
// Lives at the seam so claude-cli stays generic; a Mastra provider would ignore it.
export interface PromptStrategy {
  buildFirst(input: RunAgentInput): string
  buildResume?(args: Record<string, unknown>): string | null
}

// Everything a provider needs to run ONE agent, derived from its passport.
export interface ProviderConfig {
  approvalNames: readonly string[]
  surfaceTools: readonly string[]
  // The fully-qualified MCP tool names this agent is permitted to call
  // (e.g. `mcp__inbox__renderLead`, `mcp__gmail__get_latest_email`). This is the
  // HARD per-agent boundary: the qualifier is the only reader of the inbox, the
  // reply agent is a writer with no `get_latest_email`. Enforced at the permission
  // layer, not just via prompts. The mock provider ignores it.
  allowedTools: readonly string[]
  prompts: PromptStrategy
}

// Providers are constructed PER AGENT from config (two agents → two configurations
// of one `claude-cli`). New backends (Mastra) add a factory to the registry later.
export type ProviderFactory = (config: ProviderConfig) => Provider

export interface ProviderRegistry {
  resolve(name: string): ProviderFactory
}

// Factories are defined once; agents reference one by name. resolve throws on an
// unknown name so a bad `provider` reference fails loudly at wiring time.
export function defineProviders(map: Record<string, ProviderFactory>): ProviderRegistry {
  return {
    resolve(name: string): ProviderFactory {
      const factory = map[name]
      if (!factory) throw new Error(`Unknown provider: ${name}`)
      return factory
    },
  }
}
