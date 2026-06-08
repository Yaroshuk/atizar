import { describe, it, expect } from 'vitest'
import { createTriagePrompts } from './triage.prompts.js'

describe('triage prompts', () => {
  it('first turn instructs to list then render, and names the route options', () => {
    const p = createTriagePrompts('TRIAGE.', 'github-triage')
    const first = p.buildFirst({ messages: [] } as never)
    expect(first).toContain('list_my_tickets')
    expect(first).toContain('render_triage')
    expect(first).toMatch(/feature.*bugfix.*reply/s)
  })

  it('embeds origin in the render_triage instruction', () => {
    const p = createTriagePrompts('TRIAGE.', 'github-triage')
    const first = p.buildFirst({ messages: [] } as never)
    expect(first).toContain('origin: "github-triage"')
  })
})
