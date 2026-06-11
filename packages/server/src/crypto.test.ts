// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { encryptSecret, decryptSecret, deriveKey } from './crypto.js'

describe('crypto (AES-256-GCM)', () => {
  const key = deriveKey('a-test-master-key')

  it('round-trips a secret', () => {
    const blob = encryptSecret('hello token', key)
    expect(blob).not.toContain('hello token') // ciphertext, not plaintext
    expect(blob.split(':')).toHaveLength(3) // iv:tag:ciphertext
    expect(decryptSecret(blob, key)).toBe('hello token')
  })

  it('produces a different blob each time (random IV) but decrypts the same', () => {
    const a = encryptSecret('x', key)
    const b = encryptSecret('x', key)
    expect(a).not.toBe(b)
    expect(decryptSecret(a, key)).toBe('x')
    expect(decryptSecret(b, key)).toBe('x')
  })

  it('fails to decrypt with the wrong key (auth tag mismatch)', () => {
    const blob = encryptSecret('x', key)
    expect(() => decryptSecret(blob, deriveKey('other-key'))).toThrow()
  })

  it('deriveKey yields a 32-byte key from any string', () => {
    expect(deriveKey('short').length).toBe(32)
    expect(deriveKey('a'.repeat(100)).length).toBe(32)
  })
})
