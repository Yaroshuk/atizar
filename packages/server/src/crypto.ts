import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

// AES-256-GCM secret encryption for the credential store (spec §3). The master key string from
// ATIZAR_SECRET_KEY is hashed to a stable 32-byte key (so any-length string works). Blob format:
// base64(iv) : base64(authTag) : base64(ciphertext). Pure — no env/db access (the caller supplies
// the key), so it unit-tests with a literal key.

const ALG = 'aes-256-gcm'

export function deriveKey(masterKey: string): Buffer {
  return createHash('sha256').update(masterKey, 'utf8').digest() // 32 bytes
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12) // 96-bit nonce, GCM standard
  const cipher = createCipheriv(ALG, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':')
}

export function decryptSecret(blob: string, key: Buffer): string {
  const [ivB64, tagB64, ctB64] = blob.split(':')
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('malformed secret blob')
  const decipher = createDecipheriv(ALG, key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString(
    'utf8'
  )
}
