import type { PromptStrategy, EffectFn } from '@platform/core'

export type { EffectFn }

// Per-agent server runtime binding for a workflow placement: the prompt strategy +
// the fully-qualified MCP allow-list (the single-entry-point boundary). `origin` (the
// workflow id) is woven into handoff-emitting render prompts by the prompts factory.
// NOTE: once a workflow declares a `prompt`, the `prompts` field here is expected to be
// built from COMPOSED instructions (workflow prompt + agent instructions). The claude-cli
// path's PromptStrategy construction lives in each workflow's server.ts and is wired in
// Stage 3; Stage 2 threads composition only through the Mastra config.instructions path.
export type ServerBinding = {
  agentId: string
  prompts: PromptStrategy
  allowedTools: string[]
  effects?: Record<string, EffectFn>
}
