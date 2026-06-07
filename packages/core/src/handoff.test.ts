import { describe, it, expect } from 'vitest'
import {
  encodeHandoff,
  decodeHandoff,
  HandoffPayloadSchema,
  type HandoffPayload,
  TicketHandoffPayloadSchema,
  type TicketHandoffPayload,
} from './handoff.js'

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
    expect(decodeHandoff(input([seed]), HandoffPayloadSchema)).toEqual(payload)
  })

  it('returns null when there is no handoff seed', () => {
    expect(
      decodeHandoff(input([{ role: 'user', content: 'hello' }]), HandoffPayloadSchema)
    ).toBeNull()
  })

  it('returns null for a malformed handoff payload', () => {
    expect(
      decodeHandoff(input([{ role: 'user', content: '[handoff] not json' }]), HandoffPayloadSchema)
    ).toBeNull()
  })

  it('decodes the most recent seed when several are present', () => {
    const older = encodeHandoff({ ...payload, threadId: 'old' })
    const newer = encodeHandoff({ ...payload, threadId: 'new' })
    expect(decodeHandoff(input([older, newer]), HandoffPayloadSchema)?.threadId).toBe('new')
  })
})

const ticket: TicketHandoffPayload = {
  repo: 'matteappen/teachers-web',
  number: 5381,
  title: 'Instructions Tab 2.0 --> Launch tab',
  status: 'In progress',
  priority: 'High',
  body: 'Some description',
  lastComment: { author: 'someone', body: 'any update?' },
  recommendation: 'feature',
  url: 'https://github.com/matteappen/teachers-web/issues/5381',
}

describe('ticket handoff', () => {
  it('round-trips a ticket payload using its schema', () => {
    const seed = encodeHandoff(ticket)
    expect(decodeHandoff(input([seed]), TicketHandoffPayloadSchema)).toEqual(ticket)
  })

  it('allows a null lastComment', () => {
    const t = { ...ticket, lastComment: null }
    const seed = encodeHandoff(t)
    expect(decodeHandoff(input([seed]), TicketHandoffPayloadSchema)).toEqual(t)
  })

  it('returns null when a ticket seed is validated against the lead schema', () => {
    const seed = encodeHandoff(ticket)
    expect(decodeHandoff(input([seed]), HandoffPayloadSchema)).toBeNull()
  })
})
