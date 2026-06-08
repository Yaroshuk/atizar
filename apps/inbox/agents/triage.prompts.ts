import type { PromptStrategy } from '@platform/core'

function triageFirst(instructions: string, origin: string): string {
  return [
    instructions,
    '',
    'Call list_my_tickets to read the user’s open board tickets. Each ticket has',
    '{ repo, number, title, status, priority, body, url, lastComment, needsReply }.',
    'For EACH ticket, decide a routing recommendation — one of:',
    '- "feature": a feature/enhancement request to analyze,',
    '- "bugfix": a bug to investigate,',
    '- "reply": needsReply is true / the last comment asks the user something.',
    `Then call render_triage with { origin: "${origin}", recommendations } — set origin`,
    `to EXACTLY "${origin}", and pass recommendations as an array of`,
    '{ number, route } (route is the recommendation above) — ONE entry per ticket.',
    'Do NOT echo the ticket text — the card already has it from list_my_tickets; just',
    'send the number + route. Do not drop or invent tickets.',
    'After render_triage, STOP: reply with at most ONE short sentence. Do NOT list or',
    'summarize the tickets again (the card already shows them) and do not narrate tools —',
    'repeating them wastes time and can stall the run.',
  ].join('\n')
}

export function createTriagePrompts(instructions: string, origin: string): PromptStrategy {
  return {
    buildFirst(): string {
      return triageFirst(instructions, origin)
    },
    // No buildResume: triage has no approvals.
  }
}
