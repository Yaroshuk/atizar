// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { checkCredentials } from './check-credentials.mjs'

describe('checkCredentials', () => {
  it('returns ok + the account email when the profile ping succeeds', async () => {
    const gmail = {
      users: { getProfile: async () => ({ data: { emailAddress: 'me@example.com' } }) },
    }
    const res = await checkCredentials({ getGmail: async () => gmail })
    expect(res).toEqual({ ok: true, email: 'me@example.com' })
  })

  it('returns ok:false with error + hint when auth fails', async () => {
    const res = await checkCredentials({
      getGmail: async () => {
        throw new Error('invalid_grant')
      },
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toMatch(/invalid_grant/)
      expect(res.hint).toMatch(/gmail-viewer\/SKILL\.md/)
    }
  })
})
