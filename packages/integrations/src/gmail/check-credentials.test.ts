// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { checkCredentials } from './check-credentials.mjs'

describe('checkCredentials', () => {
  it('returns ok + the account email when the profile ping succeeds', async () => {
    const gmail = {
      users: { getProfile: async () => ({ data: { emailAddress: 'me@example.com' } }) },
    }
    const res = await checkCredentials({ gmail })
    expect(res).toEqual({ ok: true, detail: 'me@example.com' })
  })

  it('returns ok:false with error + a Connect hint when the ping fails', async () => {
    const gmail = {
      users: {
        getProfile: async () => {
          throw new Error('invalid_grant')
        },
      },
    }
    const res = await checkCredentials({ gmail })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toMatch(/invalid_grant/)
      expect(res.hint).toMatch(/Connect/)
      expect(res.hint).toMatch(/ATIZAR_GOOGLE_CLIENT_ID/)
    }
  })

  it('returns ok:false with a Connect hint when no credential is connected', async () => {
    const res = await checkCredentials({})
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toMatch(/oauth2 credential/)
      expect(res.hint).toMatch(/Connect/)
    }
  })
})
