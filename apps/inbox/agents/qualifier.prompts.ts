import type { PromptStrategy } from '@platform/core'

function qualifierFirst(instructions: string): string {
  return [
    instructions,
    '',
    'Call get_latest_email to read the single most recent email in the inbox',
    '(it returns { threadId, from, subject, body }). Classify the lead, then call',
    'renderVerdict with { threadId, from, subject, summary, category, priority, reason }:',
    '- category: one of "sales", "support", "spam", "other"',
    '- priority: one of "hot", "warm", "cold"',
    '- summary: one sentence on what the email asks for',
    '- reason: one sentence on why you classified it this way.',
    'threadId, from and subject come from get_latest_email. Do NOT draft a reply and',
    'do NOT save anything. Do not narrate your tool usage or mention tools/schemas —',
    'keep any text brief and user-facing.',
  ].join('\n')
}

export function createQualifierPrompts(instructions: string): PromptStrategy {
  return {
    buildFirst(): string {
      return qualifierFirst(instructions)
    },
    // No buildResume: the qualifier has no approvals, so it never resumes.
  }
}
