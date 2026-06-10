import { describe, it, expect } from 'vitest'
import { createReplyPrompts } from './reply.prompts.js'
import { encodeHandoff, type HandoffPayload } from '@platform/core'

const input = (messages: unknown[]) => ({ messages }) as never
const payload: HandoffPayload = {
  threadId: 't_42',
  from: 'ivan@acme.ru',
  subject: 'Order',
  summary: 'wants 10 units',
  category: 'sales',
  priority: 'hot',
}

describe('reply prompt strategy', () => {
  const prompts = createReplyPrompts('Reply to leads.')

  it('no-handoff first prompt does NOT read the inbox and points to the qualifier', () => {
    const p = prompts.buildFirst(input([]))
    expect(p).not.toContain('get_latest_email')
    expect(p).toMatch(/qualifier/i)
  })

  it('handoff first prompt uses the payload and skips get_latest_email', () => {
    const p = prompts.buildFirst(input([encodeHandoff(payload)]))
    expect(p).toContain('t_42')
    expect(p).toContain('sales')
    expect(p).not.toContain('get_latest_email')
  })

  it('buildResume narrates the server-created draft when executedResult contains draftId', () => {
    const p = prompts.buildResume?.({ threadId: 't_7', body: 'Hello Ivan' }, { draftId: 'd-42' })
    expect(p).toMatch(/already (created|saved)/i)
    expect(p).toContain('d-42')
    expect(p).not.toContain('create_draft')
  })

  it('buildResume uses "saved" as fallback draftId when executedResult is absent', () => {
    const p = prompts.buildResume?.({})
    expect(p).not.toBeNull()
    expect(p).toMatch(/already (created|saved)/i)
    expect(p).not.toContain('create_draft')
  })
})

describe("reply resume prompt (propose-don't-execute)", () => {
  it('narrates the server-created draft and forbids tool calls', () => {
    const strat = createReplyPrompts('INSTR')
    const prompt = strat.buildResume!({ threadId: 't', body: 'hi' }, { draftId: 'd-9' })
    expect(prompt).toMatch(/already (created|saved)/i)
    expect(prompt).toMatch(/d-9/)
    expect(prompt).not.toMatch(/create_draft/)
  })
})
