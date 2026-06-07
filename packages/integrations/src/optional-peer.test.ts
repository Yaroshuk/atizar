import { describe, it, expect } from 'vitest'
import { optionalPeerError } from './optional-peer.mjs'

describe('optionalPeerError', () => {
  it('returns an actionable Error when the module is not found', () => {
    const err = Object.assign(new Error("Cannot find package 'googleapis'"), {
      code: 'ERR_MODULE_NOT_FOUND',
    })
    const mapped = optionalPeerError(err, { name: 'googleapis', install: 'yarn add googleapis' })
    expect(mapped).toBeInstanceOf(Error)
    expect(mapped?.message).toContain("optional peer 'googleapis'")
    expect(mapped?.message).toContain('yarn add googleapis')
  })

  it('returns null for unrelated errors (caller rethrows the original)', () => {
    const err = Object.assign(new Error('boom'), { code: 'SOME_OTHER' })
    expect(
      optionalPeerError(err, { name: 'googleapis', install: 'yarn add googleapis' })
    ).toBeNull()
  })
})
