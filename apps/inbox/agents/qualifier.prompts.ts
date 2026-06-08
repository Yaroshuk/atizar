import type { RunAgentInput } from '@ag-ui/client'
import { decodeHandoff, HandoffPayloadSchema, type PromptStrategy } from '@platform/core'

function fromInbox(instructions: string, origin: string): string {
  return [
    instructions,
    '',
    'Call get_latest_email to read the single most recent email in the inbox',
    '(it returns { threadId, from, subject, body }). Classify the lead, then call',
    `renderVerdict with { origin: "${origin}", threadId, from, subject, summary, category, priority, reason }:`,
    `- origin: EXACTLY "${origin}"`,
    '- category: one of "sales", "support", "spam", "other"',
    '- priority: one of "hot", "warm", "cold"',
    '- summary: one sentence on what the email asks for',
    '- reason: one sentence on why you classified it this way.',
    'threadId, from and subject come from get_latest_email. Do NOT draft a reply and',
    'do NOT save anything. Do not narrate your tool usage or mention tools/schemas —',
    'keep any text brief and user-facing.',
  ].join('\n')
}

function fromHandedLead(
  instructions: string,
  origin: string,
  lead: {
    threadId: string
    from: string
    subject: string
    summary: string
    category: string
    priority: string
  }
): string {
  return [
    instructions,
    '',
    'A lead was routed to you from another workflow — do NOT read the inbox.',
    `Lead: from ${lead.from}, subject "${lead.subject}". Context: ${lead.summary}.`,
    'Re-qualify it, then call renderVerdict with',
    `{ origin: "${origin}", threadId: "${lead.threadId}", from, subject, summary, category, priority, reason }:`,
    `- origin: EXACTLY "${origin}"`,
    '- category: one of "sales", "support", "spam", "other"',
    '- priority: one of "hot", "warm", "cold"',
    '- summary: one sentence on what the lead asks for',
    '- reason: one sentence on why you classified it this way.',
    'Keep any text brief and user-facing; do not narrate tools.',
  ].join('\n')
}

export function createQualifierPrompts(instructions: string, origin: string): PromptStrategy {
  return {
    buildFirst(input: RunAgentInput): string {
      const lead = decodeHandoff(input, HandoffPayloadSchema)
      return lead ? fromHandedLead(instructions, origin, lead) : fromInbox(instructions, origin)
    },
    // No buildResume: the qualifier has no approvals, so it never resumes.
  }
}
