import { describe, it, expect } from 'vitest'
import { createReplyPrompts } from './reply.prompts.js'
import { encodeHandoff, type HandoffPayload } from '../handoff.js'

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

  it('standalone first prompt calls get_latest_email', () => {
    const p = prompts.buildFirst(input([]))
    expect(p).toContain('get_latest_email')
    expect(p).toContain('saveDraft')
  })

  it('handoff first prompt uses the payload and skips get_latest_email', () => {
    const p = prompts.buildFirst(input([encodeHandoff(payload)]))
    expect(p).toContain('t_42')
    expect(p).toContain('sales')
    expect(p).not.toContain('get_latest_email')
  })

  it('buildResume returns a create_draft prompt from approval args', () => {
    const p = prompts.buildResume?.({ threadId: 't_7', body: 'Hello Ivan' })
    expect(p).toContain('t_7')
    expect(p).toContain('Hello Ivan')
    expect(p).toContain('create_draft')
  })

  it('buildResume returns null when args lack threadId/body', () => {
    expect(prompts.buildResume?.({})).toBeNull()
  })
})
