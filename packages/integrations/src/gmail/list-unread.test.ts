// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { listUnread } from './list-unread.mjs'

function fakeGmail(messages: { id: string }[]) {
  const calls: { listQ: string[]; gotIds: string[] } = { listQ: [], gotIds: [] }
  const gmail = {
    users: {
      messages: {
        list: async ({ q }: { q: string }) => {
          calls.listQ.push(q)
          return { data: { messages } }
        },
        get: async ({ id }: { id: string }) => {
          calls.gotIds.push(id)
          return {
            data: {
              id,
              threadId: `t-${id}`,
              snippet: `snippet ${id}`,
              payload: {
                headers: [
                  { name: 'From', value: `${id}@example.com` },
                  { name: 'Subject', value: `subject ${id}` },
                  { name: 'Date', value: 'Wed, 11 Jun 2026 09:00:00 +0200' },
                ],
              },
            },
          }
        },
      },
    },
  }
  return { gmail, calls }
}

describe('listUnread', () => {
  it('lists unread inbox emails of the last day as EmailRefs (deps.gmail injected)', async () => {
    const { gmail, calls } = fakeGmail([{ id: 'a' }, { id: 'b' }])
    const res = await listUnread({}, { gmail })
    if ('error' in res) throw new Error(res.error)
    expect(res.emails.map((e) => e.messageId)).toEqual(['a', 'b'])
    expect(res.emails[0]).toEqual({
      messageId: 'a',
      threadId: 't-a',
      from: 'a@example.com',
      subject: 'subject a',
      date: 'Wed, 11 Jun 2026 09:00:00 +0200',
      snippet: 'snippet a',
    })
    expect(calls.listQ[0]).toContain('in:inbox')
    expect(calls.listQ[0]).toContain('is:unread')
    expect(calls.listQ[0]).toContain('newer_than:1d')
  })

  it('rounds sinceHours up to whole days (Gmail search has no hour granularity)', async () => {
    const { gmail, calls } = fakeGmail([])
    await listUnread({ sinceHours: 72 }, { gmail })
    expect(calls.listQ[0]).toContain('newer_than:3d')
  })

  it('returns { emails: [] } when nothing is unread', async () => {
    const { gmail } = fakeGmail([])
    const res = await listUnread({}, { gmail })
    expect(res).toEqual({ emails: [] })
  })

  it('returns { error } when no credential is given (makeGmailClient throws)', async () => {
    const res = await listUnread({}, {})
    expect('error' in res && res.error).toMatch(/oauth2 credential/)
  })
})
