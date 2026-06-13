import type { GoldenScenario } from '../runner.js'

export const leadInboxScenarios: GoldenScenario[] = [
  {
    name: 'reply: drafts a reply and opens a saveDraft approval gate; approve fires the effect',
    workflow: 'lead-inbox',
    entryAgent: 'reply',
    payload: { lead: { from: 'sam@harborfreight.example', subject: 'pricing' } },
    expect: {
      gates: [{ toolName: 'saveDraft', kind: 'approval', formKeys: ['threadId', 'body'] }],
      effects: [{ toolName: 'saveDraft' }],
      finalStatuses: { 'lead-inbox__reply': 'finished' },
    },
  },
]
