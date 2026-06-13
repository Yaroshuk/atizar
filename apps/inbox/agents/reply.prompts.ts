import type { RunAgentInput } from '@ag-ui/client'
import {
  decodeHandoff,
  HandoffPayloadSchema,
  type PromptStrategy,
  type HandoffPayload,
} from '@atizar/core'

// Launched manually with no handoff. The reply agent is a WRITER only — it cannot
// read the inbox (no get_latest_email in its allow-list). There is one entry point
// for collecting mail: the Lead Qualifier. So a standalone run just tells the user
// to start there. No tools, no inbox access.
function noLeadFirst(instructions: string): string {
  return [
    instructions,
    '',
    'No lead has been handed off to you. You do not read the inbox — the Lead',
    'Qualifier does that. Reply with ONE short sentence telling the user to start',
    'from the Lead Qualifier and click "Draft reply" on a verdict. Do not call any',
    'tool and do not narrate tool usage.',
  ].join('\n')
}

// Handoff turn 1: the qualifier already read & classified the email — use its payload.
function handoffFirst(instructions: string, h: HandoffPayload): string {
  return [
    instructions,
    '',
    `A colleague already qualified this lead — category "${h.category}", priority "${h.priority}".`,
    `The email is from ${h.from}, subject "${h.subject}". Summary: ${h.summary}`,
    'Do NOT fetch the email again — use the context above.',
    'Call renderLead with { from, subject, summary } to surface it, then draft a',
    'short reply tailored to the qualification. Then call saveDraft with { threadId,',
    `body } — threadId is "${h.threadId}", body is your drafted reply — to ask the`,
    'human before saving.',
    'Do NOT create the draft yet and do NOT send anything. Do not narrate your',
    'tool usage or mention tools/schemas — keep any text brief and user-facing.',
  ].join('\n')
}

function resume(instructions: string, draftId: string): string {
  return [
    instructions,
    '',
    'The human APPROVED the reply and the SERVER has ALREADY created the Gmail draft',
    `(draft id "${draftId}"). You do NOT create or send anything — it is done.`,
    'Reply with ONE short sentence confirming the draft was saved. Do not call any tool',
    'and do not narrate tool usage.',
  ].join('\n')
}

export function createReplyPrompts(instructions: string): PromptStrategy {
  return {
    buildFirst(input: RunAgentInput): string {
      const h = decodeHandoff(input, HandoffPayloadSchema)
      return h ? handoffFirst(instructions, h) : noLeadFirst(instructions)
    },
    buildResume(
      _args: Record<string, unknown>,
      executedResult?: Record<string, unknown>
    ): string | null {
      const draftId = typeof executedResult?.draftId === 'string' ? executedResult.draftId : 'saved'
      return resume(instructions, draftId)
    },
  }
}
