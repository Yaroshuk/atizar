import { describe, it, expect } from 'vitest'
import {
  emailInbox,
  sorterAgent,
  replyAgent,
  EmailRefSchema,
  EmailBatchSchema,
} from './descriptor.js'

describe('email-inbox descriptor', () => {
  it('sorter is a singleton input agent that dispatches route_emails to the four workers', () => {
    expect(sorterAgent.dispatches).toEqual(['route_emails'])
    expect(sorterAgent.maxInstances).toBe(1)
    expect(sorterAgent.handoffs).toEqual(['reply', 'reader', 'spam', 'important'])
    expect(emailInbox.entryAgentId).toBe('sorter')
    expect(emailInbox.agents.find((a) => a.agent.id === 'sorter')?.role).toBe('input')
  })

  it('reply reads the body itself (get_email is readonly, not a handoff summary)', () => {
    expect(replyAgent.readonly).toContain('get_email')
    expect(replyAgent.approvals).toEqual(['saveDraft'])
    expect(replyAgent.effects).toEqual(['saveDraft'])
  })

  it('payload schemas parse the dispatch shapes', () => {
    const ref = {
      messageId: 'm1',
      threadId: 't1',
      from: 'a@b.c',
      subject: 's',
      date: 'd',
      snippet: 'x',
    }
    expect(EmailRefSchema.parse(ref)).toEqual(ref)
    expect(EmailBatchSchema.parse({ emails: [ref] }).emails).toHaveLength(1)
  })

  it('has a workflow-level prompt', () => {
    expect(typeof emailInbox.prompt).toBe('string')
    expect(emailInbox.prompt!.length).toBeGreaterThan(0)
  })
})
