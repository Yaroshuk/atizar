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

const MARKER = '[handoff]'

// Encode a payload as the seed user message the target run will carry.
export function encodeHandoff(payload: HandoffPayload): Message {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: `${MARKER} ${JSON.stringify(payload)}`,
  } as Message
}

// Decode the most recent handoff payload from a run input, or null if there is no
// seed / it is unparseable. The reply prompt strategy calls this — it never sniffs
// the marker string itself.
export function decodeHandoff(input: RunAgentInput): HandoffPayload | null {
  const messages = (input?.messages ?? []) as Message[]
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'user' && typeof m.content === 'string' && m.content.startsWith(MARKER)) {
      try {
        return HandoffPayloadSchema.parse(JSON.parse(m.content.slice(MARKER.length).trim()))
      } catch {
        return null
      }
    }
  }
  return null
}
