import type { RunAgentInput } from '@ag-ui/client'
import type { PromptStrategy } from '../providers.js'
import { decodeHandoff, type HandoffPayload } from '../handoff.js'

// Standalone turn 1: discover the latest email itself.
function standaloneFirst(instructions: string): string {
  return [
    instructions,
    '',
    'Call get_latest_email to read the single most recent email in the inbox',
    '(it returns { threadId, from, subject, body }). Then call renderLead with',
    '{ from, subject, summary } to surface it, and draft a short reply.',
    'Then call saveDraft with { threadId, body } — threadId from the email, body',
    'is your drafted reply — to ask the human before saving.',
    'Do NOT create the draft yet and do NOT send anything. Do not narrate your',
    'tool usage or mention tools/schemas — keep any text brief and user-facing.',
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

function resume(instructions: string, threadId: string, body: string): string {
  return [
    instructions,
    '',
    'The human APPROVED saving this reply. Create it as a Gmail DRAFT now by',
    `calling create_draft, replying within thread "${threadId}", with this body:`,
    '',
    body,
    '',
    'Do not send. After the draft is created, reply with one short sentence',
    'confirming the draft was saved to Gmail. Do not narrate tool usage.',
  ].join('\n')
}

export function createReplyPrompts(instructions: string): PromptStrategy {
  return {
    buildFirst(input: RunAgentInput): string {
      const h = decodeHandoff(input)
      return h ? handoffFirst(instructions, h) : standaloneFirst(instructions)
    },
    buildResume(args: Record<string, unknown>): string | null {
      const threadId = typeof args.threadId === 'string' ? args.threadId : ''
      const body = typeof args.body === 'string' ? args.body : ''
      if (!threadId || !body) return null
      return resume(instructions, threadId, body)
    },
  }
}
