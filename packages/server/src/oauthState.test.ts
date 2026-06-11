// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { signState, verifyState } from './oauthState.js'

const KEY = 'test-secret'

describe('signState / verifyState', () => {
  it('round-trips a payload', () => {
    const payload = { integration: 'gmail', connection: 'default' }
    const state = signState(payload, KEY)
    expect(verifyState(state, KEY)).toEqual(payload)
  })

  it('returns null for a tampered body', () => {
    const state = signState({ integration: 'gmail', connection: 'default' }, KEY)
    const [, sig] = state.split('.')
    const tamperedBody = Buffer.from(JSON.stringify({ integration: 'evil' })).toString('base64url')
    expect(verifyState(`${tamperedBody}.${sig}`, KEY)).toBeNull()
  })

  it('returns null for a tampered signature', () => {
    const state = signState({ integration: 'gmail', connection: 'default' }, KEY)
    const [body] = state.split('.')
    expect(verifyState(`${body}.badsig`, KEY)).toBeNull()
  })

  it('returns null for a malformed state with no dot separator', () => {
    expect(verifyState('nodothere', KEY)).toBeNull()
  })
})
