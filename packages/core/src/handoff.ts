import { z } from 'zod'
import type { RunAgentInput } from '@ag-ui/client'
import type { Message } from './messages.js'

// One agent's output becomes another's input. This module is the SINGLE place that
// knows HOW a payload rides on a run input (here: a seed user message with a marker).
// Both the human trigger (client) and any future agent/server trigger call these —
// no consumer hand-rolls the transport. Pure & isomorphic: no React, no Node.
export const HandoffPayloadSchema = z.object({
  threadId: z.string(),
  from: z.string(),
  subject: z.string(),
  summary: z.string(),
  category: z.string(),
  priority: z.string(),
})

export type HandoffPayload = z.infer<typeof HandoffPayloadSchema>

export const TicketHandoffPayloadSchema = z.object({
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
  body: z.string(),
  lastComment: z.object({ author: z.string(), body: z.string() }).nullable(),
  recommendation: z.string(),
  url: z.string(),
})

export type TicketHandoffPayload = z.infer<typeof TicketHandoffPayloadSchema>

const MARKER = '[handoff]'

// Encode any payload as the seed user message the target run will carry. The shape
// is the caller's concern; decode validates it back with the matching schema.
export function encodeHandoff(payload: unknown): Message {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: `${MARKER} ${JSON.stringify(payload)}`,
  } as Message
}

// Decode the most recent handoff payload from a run input, validated against the
// passed schema, or null if there is no seed / it does not match the schema.
export function decodeHandoff<T>(input: RunAgentInput, schema: z.ZodType<T>): T | null {
  const messages = (input?.messages ?? []) as Message[]
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'user' && typeof m.content === 'string' && m.content.startsWith(MARKER)) {
      try {
        const parsed = schema.safeParse(JSON.parse(m.content.slice(MARKER.length).trim()))
        return parsed.success ? parsed.data : null
      } catch {
        return null
      }
    }
  }
  return null
}
