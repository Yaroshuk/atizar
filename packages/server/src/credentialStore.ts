import { and, eq } from 'drizzle-orm'
import type { Db } from './db/client.js'
import { credentials } from './db/schema.js'
import { atizarEnv } from './env.js'
import { deriveKey, encryptSecret, decryptSecret } from './crypto.js'

export interface UpsertArgs {
  connectionId: string
  integration: string
  kind: string
  secret: string
  expiresAt?: Date | null
}
export interface StoredCredential {
  kind: string
  secret: string // decrypted
  expiresAt: Date | null
}
export interface CredentialKey {
  connectionId: string
  integration: string
}

function key(): Buffer {
  const master = atizarEnv.secretKey()
  if (!master)
    throw new Error('ATIZAR_SECRET_KEY is not set — the credential store cannot encrypt/decrypt')
  return deriveKey(master)
}

// Encrypt-on-write / decrypt-on-read store over the `credentials` table. Plaintext secrets never
// reach the DB. Keyed by (connectionId, integration).
export function makeCredentialStore(db: Db) {
  return {
    async upsert(args: UpsertArgs): Promise<void> {
      const secret = encryptSecret(args.secret, key())
      const now = new Date()
      await db
        .insert(credentials)
        .values({
          connectionId: args.connectionId,
          integration: args.integration,
          kind: args.kind,
          secret,
          expiresAt: args.expiresAt ?? null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [credentials.connectionId, credentials.integration],
          set: { kind: args.kind, secret, expiresAt: args.expiresAt ?? null, updatedAt: now },
        })
    },

    async get(k: CredentialKey): Promise<StoredCredential | null> {
      const [row] = await db
        .select()
        .from(credentials)
        .where(
          and(
            eq(credentials.connectionId, k.connectionId),
            eq(credentials.integration, k.integration)
          )
        )
        .limit(1)
      if (!row) return null
      return { kind: row.kind, secret: decryptSecret(row.secret, key()), expiresAt: row.expiresAt }
    },

    async remove(k: CredentialKey): Promise<void> {
      await db
        .delete(credentials)
        .where(
          and(
            eq(credentials.connectionId, k.connectionId),
            eq(credentials.integration, k.integration)
          )
        )
    },
  }
}

export type CredentialStore = ReturnType<typeof makeCredentialStore>
