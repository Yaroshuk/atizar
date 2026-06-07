import { describe, it, expect } from 'vitest'
import { encodeHandoff, decodeHandoff, type HandoffPayload } from './handoff.js'

const payload: HandoffPayload = {
  threadId: 't_1',
  from: 'a@b.c',
  subject: 'Hi',
  summary: 'wants X',
  category: 'sales',
  priority: 'hot',
}
const input = (messages: unknown[]) => ({ messages }) as never

describe('handoff encode/decode', () => {
  it('round-trips a payload through a seed message', () => {
    const seed = encodeHandoff(payload)
    expect(decodeHandoff(input([seed]))).toEqual(payload)
  })

  it('returns null when there is no handoff seed', () => {
    expect(decodeHandoff(input([{ role: 'user', content: 'hello' }]))).toBeNull()
  })

  it('returns null for a malformed handoff payload', () => {
    expect(decodeHandoff(input([{ role: 'user', content: '[handoff] not json' }]))).toBeNull()
  })

  it('decodes the most recent seed when several are present', () => {
    const older = encodeHandoff({ ...payload, threadId: 'old' })
    const newer = encodeHandoff({ ...payload, threadId: 'new' })
    expect(decodeHandoff(input([older, newer]))?.threadId).toBe('new')
  })
})
