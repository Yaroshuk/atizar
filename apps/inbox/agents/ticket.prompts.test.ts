import { describe, it, expect } from 'vitest'
import { encodeHandoff, type TicketHandoffPayload } from '@atizar/core'
import { createTicketPrompts } from './ticket.prompts.js'

const ticket: TicketHandoffPayload = {
  repo: 'm/r',
  number: 7,
  title: 'Crash on save',
  status: 'Todo',
  priority: 'High',
  body: 'It crashes',
  lastComment: null,
  recommendation: 'bugfix',
  url: 'https://github.com/m/r/issues/7',
}

describe('ticket prompts', () => {
  it('builds from the handoff payload and targets render_ticket_result', () => {
    const p = createTicketPrompts('BUGFIX.', { renderTool: 'render_ticket_result', kind: 'bug' })
    const out = p.buildFirst({ messages: [encodeHandoff(ticket)] } as never)
    expect(out).toContain('Crash on save')
    expect(out).toContain('It crashes')
    expect(out).toContain('render_ticket_result')
    expect(out).toContain('bug')
  })

  it('tells the user to start from triage when there is no handoff', () => {
    const p = createTicketPrompts('FEATURE.', {
      renderTool: 'render_ticket_result',
      kind: 'feature',
    })
    const out = p.buildFirst({ messages: [] } as never)
    expect(out).toMatch(/triage/i)
  })
})
