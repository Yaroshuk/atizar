// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { getEmail } from './get-email.mjs'

describe('getEmail', () => {
  it('fetches one message and returns parsed fields including the full body', async () => {
    const gmail = {
      users: {
        messages: {
          get: async ({ id, format }: { id: string; format: string }) => {
            expect(id).toBe('m1')
            expect(format).toBe('full')
            return {
              data: {
                threadId: 't1',
                snippet: 'snip',
                payload: {
                  headers: [
                    { name: 'From', value: 'lead@example.com' },
                    { name: 'Subject', value: 'Pricing' },
                  ],
                  body: { data: Buffer.from('Full body here', 'utf8').toString('base64url') },
                },
              },
            }
          },
        },
      },
    }
    const res = await getEmail({ messageId: 'm1' }, { gmail })
    expect(res).toEqual({
      messageId: 'm1',
      threadId: 't1',
      from: 'lead@example.com',
      subject: 'Pricing',
      body: 'Full body here',
    })
  })

  it('returns { error } when no credential is given (makeGmailClient throws)', async () => {
    const res = await getEmail({ messageId: 'x' }, {})
    expect('error' in res && res.error).toMatch(/oauth2 credential/)
  })
})
