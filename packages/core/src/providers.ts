import type { RunAgentInput, BaseEvent } from '@ag-ui/client'

// A provider is the model/runtime seam: given the run input it yields AG-UI events.
export interface Provider {
  run(input: RunAgentInput): AsyncIterable<BaseEvent>
  // Optional v2 capability: resume a run that suspended at a gate. The provider OWNS the
  // resume mechanics (the orchestrator never hard-codes re-prime): claude-cli implements it
  // as kill-and-re-prime from the transcript + the verbatim approved artifact; Mastra (later)
  // resumes natively by runId against its own snapshot store. Absent ⇒ no resume capability.
  resume?(handle: ResumeHandle, payload: ResumePayload): AsyncIterable<BaseEvent>
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
  // Optional discriminant: absent ⇒ a gate resolution (the default arm). Plan 2's callers set
  // it explicitly; existing callers that omit it still typecheck and behave as a gate.
  kind?: 'gate'
  gateId: string
  decision: 'approved' | 'rejected'
  form?: Record<string, unknown>
  comment?: string
  // Filled at step 4 once the SERVER has executed the approved effect: the integration
  // result (e.g. { draftId }). The resume prompt narrates "the action was executed with
  // this result"; the model never re-performs the effect.
  executedResult?: Record<string, unknown>
}

// An agent answer delivered back to a suspended asker (the return channel). Carries one entry per
// outstanding question (Pass 1: exactly one). `ok` is per-answer; `allOk` is the join verdict the
// asker's prompt branches on. NOT a GateResolution — an answer has no gateId/decision (the patch
// the design rejected); its own honest type instead.
export interface AnswerResolution {
  kind: 'answer'
  answers: { target: unknown; answer: Record<string, unknown>; ok: boolean }[]
  allOk: boolean
}

// What the orchestrator hands a provider to resume a suspended run. The provider branches on `kind`
// and REUSES one resume mechanism for both (no second path): gate-resume and answer-resume differ
// only in the prompt the strategy builds.
export type ResumePayload = GateResolution | AnswerResolution

// The resume result of a gated agent — a discriminated union (I14 provider/core contract). The
// SERVER decides what to do from `kind`; the provider only ever runs `prompt`. `message` lets an
// approval resolve with a canned confirmation (no LLM round-trip); `null` is a clean silent finish.
export type ResumeOutcome =
  | { kind: 'prompt'; text: string } // spawn the model with `text` as the resume prompt
  | { kind: 'message'; text: string } // server appends `text` verbatim, NO model spawn
  | null // clean silent settle, no turn

// A per-agent prompt strategy: how this agent turns a run into CLI prompts.
// buildFirst handles turn 1 (standalone OR handoff-seeded). buildResume handles a
// resumed run after a human approval (null = no usable resume → the provider errors).
// Lives at the seam so claude-cli stays generic; a Mastra provider would ignore it.
export interface PromptStrategy {
  buildFirst(input: RunAgentInput): string
  // Returns a ResumeOutcome: prompt → spawn the model; message → server appends text; null → silent.
  buildResume?(
    args: Record<string, unknown>,
    executedResult?: Record<string, unknown>
  ): ResumeOutcome
  // Resume after an AGENT ANSWER (the return channel), parallel to buildResume (human gate). Builds
  // the resume prompt from the delivered answers. Omit for an agent that never asks.
  buildResumeFromAnswer?(answers: AnswerResolution['answers']): ResumeOutcome
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
