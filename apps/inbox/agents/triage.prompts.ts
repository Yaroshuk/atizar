import type { PromptStrategy } from '@platform/core'

function triageFirst(instructions: string): string {
  return [
    instructions,
    '',
    'Call list_my_tickets to read the user’s open board tickets. Each ticket has',
    '{ repo, number, title, status, priority, body, url, lastComment, needsReply }.',
    'For EACH ticket, decide a routing recommendation — one of:',
    '- "feature": a feature/enhancement request to analyze,',
    '- "bugfix": a bug to investigate,',
    '- "reply": needsReply is true / the last comment asks the user something.',
    'Then call render_triage with { tickets } — pass every ticket through UNCHANGED',
    'and add a "recommendation" field to each. Do not drop or invent tickets.',
    'Do not narrate your tool usage or mention tools/schemas — keep any text brief.',
  ].join('\n')
}

export function createTriagePrompts(instructions: string): PromptStrategy {
  return {
    buildFirst(): string {
      return triageFirst(instructions)
    },
    // No buildResume: triage has no approvals.
  }
}
