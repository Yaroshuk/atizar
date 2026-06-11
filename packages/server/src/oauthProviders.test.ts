import { describe, it, expect } from 'vitest'
import { oauthProvider } from './oauthProviders.js'

describe('oauthProvider', () => {
  it('describes google', () => {
    const g = oauthProvider('google')
    expect(g?.tokenUrl).toMatch(/oauth2\.googleapis\.com\/token/)
    expect(g?.authUrl).toMatch(/accounts\.google\.com/)
  })
  it('returns undefined for an unknown provider', () => {
    expect(oauthProvider('zzz')).toBeUndefined()
  })
})
