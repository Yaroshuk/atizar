// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq, and } from 'drizzle-orm'
import { db } from './db/client.js'
import { credentials } from './db/schema.js'
import { makeCredentialStore } from './credentialStore.js'

const KEY = 'test-master-key-substage2'
beforeAll(() => {
  process.env.ATIZAR_SECRET_KEY = KEY
})
afterAll(() => {
  delete process.env.ATIZAR_SECRET_KEY
})

describe('credentialStore (real PG)', () => {
  const store = makeCredentialStore(db)
  const conn = `t-${Math.random().toString(36).slice(2)}` // unique per run — no truncate needed

  it('upserts then reads back the decrypted secret', async () => {
    await store.upsert({
      connectionId: conn,
      integration: 'gmail',
      kind: 'oauth2',
      secret: 'tok-123',
    })
    const got = await store.get({ connectionId: conn, integration: 'gmail' })
    expect(got?.kind).toBe('oauth2')
    expect(got?.secret).toBe('tok-123')
  })

  it('stores the secret ENCRYPTED (raw column is not the plaintext)', async () => {
    const [row] = await db
      .select()
      .from(credentials)
      .where(and(eq(credentials.connectionId, conn), eq(credentials.integration, 'gmail')))
    expect(row.secret).not.toContain('tok-123')
    expect(row.secret.split(':')).toHaveLength(3)
  })

  it('upsert replaces the secret for the same (connection, integration)', async () => {
    await store.upsert({
      connectionId: conn,
      integration: 'gmail',
      kind: 'oauth2',
      secret: 'tok-456',
    })
    expect((await store.get({ connectionId: conn, integration: 'gmail' }))?.secret).toBe('tok-456')
  })

  it('remove deletes the row', async () => {
    await store.remove({ connectionId: conn, integration: 'gmail' })
    expect(await store.get({ connectionId: conn, integration: 'gmail' })).toBeNull()
  })

  it('get returns null for an unknown connection', async () => {
    expect(await store.get({ connectionId: 'nope-xyz', integration: 'gmail' })).toBeNull()
  })
})
