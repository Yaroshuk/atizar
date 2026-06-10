// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createDraft } from './create-draft.mjs'

function fakeGmail(overrides = {}) {
  const calls = { drafts: [] }
  const gmail = {
    users: {
      threads: {
        get: async () => ({
          data: {
            messages: [
              {
                payload: {
                  headers: [
                    { name: 'From', value: 'lead@example.com' },
                    { name: 'Subject', value: 'Pricing question' },
                  ],
                },
              },
            ],
          },
        }),
      },
      drafts: {
        create: async ({ requestBody }: { requestBody: any }) => {
          calls.drafts.push(requestBody as never)
          return { data: { id: 'draft-123' } }
        },
      },
    },
  }
  return { gmail: { ...gmail, ...overrides }, calls }
}

describe('createDraft', () => {
  it('creates a draft and returns the draftId', async () => {
    const { gmail, calls } = fakeGmail()
    const res = await createDraft({ threadId: 't1', body: 'Hello there' }, { getGmail: async () => gmail })
    expect(res).toEqual({ ok: true, draftId: 'draft-123' })
    expect(calls.drafts).toHaveLength(1)
    expect((calls.drafts[0] as any).message.threadId).toBe('t1')
  })

  it('returns an error when the thread has no From header', async () => {
    const noFrom = {
      users: {
        threads: { get: async () => ({ data: { messages: [{ payload: { headers: [] } }] } }) },
        drafts: { create: async () => ({ data: { id: 'x' } }) },
      },
    }
    const res = await createDraft({ threadId: 't1', body: 'Hi' }, { getGmail: async () => noFrom })
    expect((res as any).error).toMatch(/recipient/i)
  })
})
