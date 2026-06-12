import { describe, it, expect } from 'vitest'
import { authHeaders } from './authHeaders.js'

describe('authHeaders', () => {
  it('returns an empty object when no token is given', () => {
    expect(authHeaders(undefined)).toEqual({})
  })

  it('returns a Bearer Authorization header when a token is given', () => {
    expect(authHeaders('sek')).toEqual({ Authorization: 'Bearer sek' })
  })
})
