import type { PromptStrategy, EffectFn } from '@platform/core'

export type { EffectFn }

// Per-agent server runtime binding for a workflow placement: the prompt strategy +
// the fully-qualified MCP allow-list (the single-entry-point boundary). `origin` (the
// workflow id) is woven into handoff-emitting render prompts by the prompts factory.
export type ServerBinding = {
  agentId: string
  prompts: PromptStrategy
  allowedTools: string[]
  effects?: Record<string, EffectFn>
}
