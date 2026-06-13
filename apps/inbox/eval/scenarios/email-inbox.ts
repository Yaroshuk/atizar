import type { GoldenScenario } from '../runner.js'

export const emailInboxScenarios: GoldenScenario[] = [
  {
    name: 'sorter: machine-dispatches a child per route and a batch agent opens an applyActions gate',
    workflow: 'email-inbox',
    entryAgent: 'sorter',
    payload: {},
    expect: {
      // The reader/spam/important batch agents each open an `applyActions` gate (form has
      // `items`); the reply batch agent opens a `saveDraft` gate instead. The fan-out opens
      // MORE than one gate, so the email-inbox eval file asserts CONTAINS, not exact length.
      gates: [{ toolName: 'applyActions', kind: 'approval', formKeys: ['items'] }],
      effects: [{ toolName: 'applyActions' }],
      finalStatuses: { 'email-inbox__sorter': 'finished' },
    },
  },
]
