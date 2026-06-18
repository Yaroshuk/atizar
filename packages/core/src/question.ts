import { EventType, type BaseEvent, type CustomEvent } from '@ag-ui/client'
import { z } from 'zod'

// A provider-agnostic "an agent just asked another agent a question" signal, carried as an AG-UI
// CUSTOM event (mirrors gate.ts GATE_OPENED): it stays inside the AG-UI vocabulary, survives
// record/replay as an ordinary BaseEvent, and is ignored by consumers that don't know it. The
// provider emits it at the suspend point; the server turns it into questions row(s) and suspends
// the asker into the `awaiting_agent` phase.
export const AGENT_QUESTION = 'AGENT_QUESTION' as const

// Shaped for fan-out from day one: an asker may emit several questions in one signal (the server
// joins on all answers before waking). Pass 1 always has length 1. `target` is OPAQUE — the core
// never knows which agent it is; a workflow-provided router resolves it (I5). The runId/transcript
// are NOT carried here — the orchestrator builds the resume handle from the { runId, input } it holds.
export const AgentQuestionValueSchema = z.object({
  questions: z
    .array(
      z.object({
        toolCallId: z.string(), // correlates with the TOOL_CALL_* events of the ask tool call
        target: z.unknown(), // opaque destination descriptor; the workflow router resolves it
        payload: z.record(z.unknown()), // the question body the answerer is seeded with
      })
    )
    .min(1),
})
export type AgentQuestionValue = z.infer<typeof AgentQuestionValueSchema>

export function agentQuestion(value: AgentQuestionValue): CustomEvent {
  return { type: EventType.CUSTOM, name: AGENT_QUESTION, value }
}

// Recognize + parse a question signal from any BaseEvent. Returns null for non-question events AND
// for a malformed payload (so a bad value never reaches a consumer as a "valid" question).
export function readAgentQuestion(event: BaseEvent): AgentQuestionValue | null {
  const e = event as { type: EventType; name?: string; value?: unknown }
  if (e.type !== EventType.CUSTOM || e.name !== AGENT_QUESTION) return null
  const parsed = AgentQuestionValueSchema.safeParse(e.value)
  return parsed.success ? parsed.data : null
}
