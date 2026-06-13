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
  {
    name: 'qualifier: surfaces a verdict card and finishes with no gate',
    workflow: 'lead-inbox',
    entryAgent: 'qualifier',
    payload: { lead: { from: 'sam@harborfreight.example', subject: 'pricing' } },
    expect: {
      gates: [],
      effects: [],
      finalStatuses: { 'lead-inbox__qualifier': 'finished' },
    },
  },
  {
    name: 'reply: reject leaves the item finished/rejected and fires no effect',
    workflow: 'lead-inbox',
    entryAgent: 'reply',
    payload: { lead: { from: 'sam@harborfreight.example', subject: 'pricing' } },
    gateScript: () => ({ decision: 'rejected', comment: 'not now' }),
    expect: {
      gates: [{ toolName: 'saveDraft', kind: 'approval', formKeys: ['threadId', 'body'] }],
      effects: [],
      finalStatuses: { 'lead-inbox__reply': 'finished' },
      resolutions: { 'lead-inbox__reply': 'rejected' },
    },
  },
]
