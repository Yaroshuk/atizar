import type { PromptStrategy } from '@platform/core'

// A server-executed effect: keyed by APPROVAL tool name, called by the server on approve
// with the gate form (the edited artifact = the args) + context. Returns the result that
// becomes the ledger entry + the resume narrative. The model never sees this function.
export type EffectFn = (
  form: Record<string, unknown>,
  ctx: { workItemId: string; gateId: string }
) => Promise<Record<string, unknown>>

// Per-agent server runtime binding for a workflow placement: the prompt strategy +
// the fully-qualified MCP allow-list (the single-entry-point boundary). `origin` (the
// workflow id) is woven into handoff-emitting render prompts by the prompts factory.
export type ServerBinding = {
  agentId: string
  prompts: PromptStrategy
  allowedTools: string[]
  effects?: Record<string, EffectFn>
}
