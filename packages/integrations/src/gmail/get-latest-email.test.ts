// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { getLatestEmail } from './get-latest-email.mjs'

// Minimal fake Gmail message with a base64url-encoded body.
function makeMessage(threadId: string, from: string, subject: string, body: string) {
  const bodyData = Buffer.from(body, 'utf8').toString('base64url')
  return {
    threadId,
    snippet: '',
    payload: {
      headers: [
        { name: 'From', value: from },
        { name: 'Subject', value: subject },
      ],
      body: { data: bodyData },
    },
  }
}

function fakeGmail(message: ReturnType<typeof makeMessage> | null) {
  return {
    users: {
      messages: {
        list: async () => ({
          data: {
            messages: message ? [{ id: 'msg-1' }] : [],
          },
        }),
        get: async () => ({ data: message }),
      },
    },
  }
}

describe('getLatestEmail', () => {
  it('returns parsed fields for a message in the inbox', async () => {
    const msg = makeMessage('thread-1', 'lead@example.com', 'Hello there', 'Body text here.')
    const res = await getLatestEmail(undefined, { gmail: fakeGmail(msg) })
    expect(res).toEqual({
      threadId: 'thread-1',
      from: 'lead@example.com',
      subject: 'Hello there',
      body: 'Body text here.',
    })
  })

  it('returns { error } when inbox is empty', async () => {
    const res = await getLatestEmail(undefined, { gmail: fakeGmail(null) })
    expect(res).toEqual({ error: 'No emails found in inbox.' })
  })

  it('returns { error } when no credential is given (makeGmailClient throws)', async () => {
    const res = await getLatestEmail(undefined, {})
    expect((res as { error: string }).error).toMatch(/oauth2 credential/)
  })
})
