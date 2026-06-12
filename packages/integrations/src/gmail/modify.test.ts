// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { markRead, trash, star } from './modify.mjs'

function fakeGmail(opts: { failIds?: string[] } = {}) {
  const calls: { modify: { id: string; requestBody: unknown }[]; trash: string[] } = {
    modify: [],
    trash: [],
  }
  const fail = new Set(opts.failIds ?? [])
  const gmail = {
    users: {
      messages: {
        modify: async ({ id, requestBody }: { id: string; requestBody: unknown }) => {
          if (fail.has(id)) throw new Error(`boom ${id}`)
          calls.modify.push({ id, requestBody })
          return { data: {} }
        },
        trash: async ({ id }: { id: string }) => {
          if (fail.has(id)) throw new Error(`boom ${id}`)
          calls.trash.push(id)
          return { data: {} }
        },
      },
    },
  }
  return { gmail, calls }
}

describe('markRead / star / trash', () => {
  it('markRead removes the UNREAD label per message', async () => {
    const { gmail, calls } = fakeGmail()
    const res = await markRead({ messageIds: ['a', 'b'] }, { gmail })
    expect(res).toEqual({ done: ['a', 'b'], failed: [] })
    expect(calls.modify[0]).toEqual({ id: 'a', requestBody: { removeLabelIds: ['UNREAD'] } })
  })

  it('star adds the STARRED label', async () => {
    const { gmail, calls } = fakeGmail()
    const res = await star({ messageIds: ['a'] }, { gmail })
    expect(res).toEqual({ done: ['a'], failed: [] })
    expect(calls.modify[0]).toEqual({ id: 'a', requestBody: { addLabelIds: ['STARRED'] } })
  })

  it('trash is best-effort: a failing row is collected, the rest proceed', async () => {
    const { gmail, calls } = fakeGmail({ failIds: ['bad'] })
    const res = await trash({ messageIds: ['a', 'bad', 'b'] }, { gmail })
    expect(res).toEqual({ done: ['a', 'b'], failed: [{ messageId: 'bad', error: 'boom bad' }] })
    expect(calls.trash).toEqual(['a', 'b'])
  })

  it('returns { error } wholesale when no credential is given (makeGmailClient throws)', async () => {
    const res = await markRead({ messageIds: ['a'] }, {})
    expect('error' in res && res.error).toMatch(/oauth2 credential/)
  })
})
