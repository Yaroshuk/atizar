import { describe, it, expect } from 'vitest'
import {
  isOAuth2,
  type AuthSpec,
  type ResolvedCredential,
  type CredentialResolver,
} from './integration-auth.js'

describe('integration auth contract', () => {
  it('AuthSpec kind is OPEN — a custom kind type-checks without a core change', () => {
    const none: AuthSpec = { kind: 'none' }
    const apiKey: AuthSpec = { kind: 'apiKey' }
    const oauth: AuthSpec = { kind: 'oauth2', provider: 'google', scopes: ['s1'] }
    const custom: AuthSpec = { kind: 'telegram-mtproto', phoneRequired: true } // open escape hatch
    expect([none.kind, apiKey.kind, oauth.kind, custom.kind]).toEqual([
      'none',
      'apiKey',
      'oauth2',
      'telegram-mtproto',
    ])
  })

  it('isOAuth2 narrows an AuthSpec to its oauth2 shape', () => {
    const spec: AuthSpec = { kind: 'oauth2', provider: 'google', scopes: ['gmail.modify'] }
    expect(isOAuth2(spec)).toBe(true)
    expect(isOAuth2({ kind: 'apiKey' })).toBe(false)
    if (isOAuth2(spec)) expect(spec.scopes).toContain('gmail.modify')
  })

  it('ResolvedCredential carries the per-kind payload', () => {
    const key: ResolvedCredential = { kind: 'apiKey', apiKey: 'sk-x' }
    const tok: ResolvedCredential = {
      kind: 'oauth2',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: 1,
    }
    expect(key.kind === 'apiKey' && key.apiKey).toBe('sk-x')
    expect(tok.kind === 'oauth2' && tok.accessToken).toBe('at')
  })

  it('a CredentialResolver is a function of {integration, connectionId, auth} returning cred|null', async () => {
    const resolver: CredentialResolver = async ({ integration, connectionId, auth }) => {
      expect(integration).toBe('gmail')
      expect(connectionId).toBe('default')
      expect(auth.kind).toBe('apiKey')
      return { kind: 'apiKey', apiKey: 'sk-x' }
    }
    const cred = await resolver({
      integration: 'gmail',
      connectionId: 'default',
      auth: { kind: 'apiKey' },
    })
    expect(cred).toEqual({ kind: 'apiKey', apiKey: 'sk-x' })
    // null is a valid "not connected" result.
    const none: CredentialResolver = async () => null
    expect(await none({ integration: 'x', connectionId: 'default', auth: { kind: 'none' } })).toBeNull()
  })
})
