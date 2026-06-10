import { EventType, type BaseEvent, type CustomEvent } from '@ag-ui/client'
import { z } from 'zod'

// A provider-agnostic "a human gate just opened" signal, carried as an AG-UI CUSTOM
// event so it stays inside the AG-UI vocabulary, survives record/replay as an ordinary
// BaseEvent, and is ignored by consumers that don't know it. The provider emits it at
// the suspend point; the server (later) turns it into a Gate record.
export const GATE_OPENED = 'GATE_OPENED' as const

// CUSTOM.value is `any` on the wire; we own and validate this shape. It carries only
// what the consumer does NOT otherwise have — NOT the resume handle (the orchestrator
// builds that from the { runId, input } it already holds).
export const GateOpenedValueSchema = z.object({
  gateKind: z.literal('approval'), // only 'approval' in the beta; the field reserves the axis
  toolName: z.string(), // the approval tool that opened the gate
  toolCallId: z.string(), // correlates with the TOOL_CALL_* events of the same call
  proposedArtifact: z.record(z.unknown()), // the approval tool's args = the agent's proposal
})
export type GateOpenedValue = z.infer<typeof GateOpenedValueSchema>

// Build the CUSTOM event so providers don't hand-roll the envelope. CustomEvent.value is
// `any` on the wire, so the typed GateOpenedValue assigns without a cast; the precise return
// type lets callers see exactly what they get (it's still a BaseEvent for stream purposes).
export function gateOpened(value: GateOpenedValue): CustomEvent {
  return { type: EventType.CUSTOM, name: GATE_OPENED, value }
}

// Recognize + parse a gate signal from any BaseEvent. Returns null for non-gate events
// AND for a malformed payload (so a bad value never reaches a consumer as a "valid" gate).
export function readGateOpened(event: BaseEvent): GateOpenedValue | null {
  const e = event as { type: EventType; name?: string; value?: unknown }
  if (e.type !== EventType.CUSTOM || e.name !== GATE_OPENED) return null
  const parsed = GateOpenedValueSchema.safeParse(e.value)
  return parsed.success ? parsed.data : null
}
