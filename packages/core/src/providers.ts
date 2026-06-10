import type { RunAgentInput, BaseEvent } from '@ag-ui/client'

// A provider is the model/runtime seam: given the run input it yields AG-UI events.
export interface Provider {
  run(input: RunAgentInput): AsyncIterable<BaseEvent>
  // Optional v2 capability: resume a run that suspended at a gate. The provider OWNS the
  // resume mechanics (the orchestrator never hard-codes re-prime): claude-cli implements it
  // as kill-and-re-prime from the transcript + the verbatim approved artifact; Mastra (later)
  // resumes natively by runId against its own snapshot store. Absent ⇒ no resume capability.
  resume?(handle: ResumeHandle, resolution: GateResolution): AsyncIterable<BaseEvent>
}

// What the orchestrator hands back to resume a suspended run. Both fields are always present;
// each provider reads the slice it needs. claude-cli re-primes from `input` + the resolution;
// Mastra resumes by `runId` and ignores `input`. A transparent struct (not an opaque token) so
// a stateless provider, which has no live process to hold a token against, still has the
// transcript. A private token can be added as an optional field later without breaking callers.
export interface ResumeHandle {
  runId: string
  input: RunAgentInput
}

// The human's decision at a gate. `form` is the approved/edited artifact (byte-verbatim — it
// becomes the effect arguments at step 4); `comment` seeds the future revise loop.
export interface GateResolution {
  gateId: string
  decision: 'approved' | 'rejected'
  form?: Record<string, unknown>
  comment?: string
  // Filled at step 4 once the SERVER has executed the approved effect: the integration
  // result (e.g. { draftId }). The resume prompt narrates "the action was executed with
  // this result"; the model never re-performs the effect.
  executedResult?: Record<string, unknown>
}

// A per-agent prompt strategy: how this agent turns a run into CLI prompts.
// buildFirst handles turn 1 (standalone OR handoff-seeded). buildResume handles a
// resumed run after a human approval (null = no usable resume → the provider errors).
// Lives at the seam so claude-cli stays generic; a Mastra provider would ignore it.
export interface PromptStrategy {
  buildFirst(input: RunAgentInput): string
  // `args` is the approved/edited artifact; `executedResult` is the server's effect result
  // (present at step 4+). Returns null when no usable resume → the provider errors.
  buildResume?(
    args: Record<string, unknown>,
    executedResult?: Record<string, unknown>
  ): string | null
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
  // The agent's system instructions (from defineAgent). claude-cli reads them via PromptStrategy;
  // Mastra uses them as the Agent's instructions. Always present.
  instructions: string
  // A stable unique id for this agent instance (the wf__agent instanceKey). Mastra uses it to
  // namespace its workflow + storage; claude-cli/mock ignore it. Always present.
  agentId: string
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
