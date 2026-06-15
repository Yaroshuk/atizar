import type { z } from 'zod'
import type { RunAgentInput } from '@ag-ui/client'
import { decodeHandoff } from './handoff.js'
import type { PromptStrategy } from './providers.js'

// Declarative prompt for one agent. Returns TURN-ONLY prose — the agent's identity
// (defineAgent.instructions, composed with the workflow prompt) is prepended by the provider,
// never repeated here. Owns the decode/branch/resume boilerplate so userland writes only the words.
export interface PromptSpec<T> {
  // The handoff payload schema this agent expects (omit for an input agent with no upstream).
  input?: z.ZodType<T>
  // Turn 1 when a matching handoff payload decodes from the run input.
  onInput?: (payload: T) => string
  // Turn 1 with no (or no matching) handoff payload — the standalone/entry prompt. Required.
  onStart: () => string
  // Resume after a human approval. `result` is the server's executed-effect result (e.g. { draftId }).
  // Omit when the agent never proposes a gated effect → buildResume is undefined.
  onResume?: (result: Record<string, unknown>) => string
}

export function definePrompt<T>(spec: PromptSpec<T>): PromptStrategy {
  return {
    buildFirst(input: RunAgentInput): string {
      if (spec.input && spec.onInput) {
        const payload = decodeHandoff(input, spec.input)
        if (payload) return spec.onInput(payload)
      }
      return spec.onStart()
    },
    buildResume: spec.onResume
      ? (_args: Record<string, unknown>, executedResult?: Record<string, unknown>): string | null =>
          spec.onResume!(executedResult ?? {})
      : undefined,
  }
}
