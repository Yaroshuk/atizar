// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { makeGmailClient } from './client.mjs'

describe('makeGmailClient', () => {
  it('throws a clear error when no credential is given', async () => {
    await expect(makeGmailClient(undefined as never)).rejects.toThrow(
      /oauth2 credential with an accessToken is required/
    )
  })

  it('throws when the credential is not oauth2', async () => {
    await expect(makeGmailClient({ kind: 'apiKey', apiKey: 'x' } as never)).rejects.toThrow(
      /oauth2 credential with an accessToken is required/
    )
  })

  it('throws when the oauth2 credential has no accessToken', async () => {
    await expect(makeGmailClient({ kind: 'oauth2', accessToken: '' } as never)).rejects.toThrow(
      /oauth2 credential with an accessToken is required/
    )
  })
})
