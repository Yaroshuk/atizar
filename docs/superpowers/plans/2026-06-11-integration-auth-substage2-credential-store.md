# Integration Auth — Sub-stage 2: encrypted credential store + resolveCredential — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the credential store + the single resolution path (spec: `docs/superpowers/specs/2026-06-11-integration-auth-contract-design.md`, §3): an AES-encrypted `credentials` Postgres table (PK `(connection_id, integration)`), a `crypto.ts` (encrypt/decrypt with the key from `atizarEnv.secretKey()`), a `credentialStore` (encrypt-on-write / decrypt-on-read CRUD), and `resolveCredential` with built-in `apiKey` + `oauth2` resolvers (incl. token refresh) plus a registry seam for custom-kind resolvers. NO OAuth connect routes/UI, NO skill changes, NO gmail rewrite — those are sub-stages 3–5. Also seed `.env.example`.

**Architecture:** All in `@atizar/server`, additive. `crypto.ts` is pure (Node `crypto`, no dep). `credentialStore.ts` wraps the new drizzle table, encrypting the secret blob at the boundary so plaintext never hits the DB. `resolveCredential.ts` dispatches by `auth.kind` to a resolver: `apiKey` reads `atizarEnv.apiKey(integration)` (never stored), `oauth2` loads+decrypts the row and refreshes via the provider token endpoint if expired, a custom kind calls a registered resolver. A tiny `oauthProviders.ts` map supplies the `google` token endpoint (shared with sub-stage 3's connect flow). Returns `ResolvedCredential | null` (null = not connected → the F3 health surface shows the agent as needing a connection).

**Tech Stack:** TypeScript (strict), drizzle + Postgres (already wired), Node `crypto` (AES-256-GCM), `fetch` (token refresh, injectable for tests), vitest (unit + real-PG), yarn-classic, NO build step.

**Branch:** `feat/gmail-viewer`. Verify `git rev-parse --abbrev-ref HEAD`; STOP if not on it.

**PREREQUISITE:** Sub-stage 1 (the contract types + `atizarEnv`) is BUILT. This plan imports `AuthSpec`/`ResolvedCredential`/`CredentialResolver` from `@atizar/core` and `atizarEnv` from `@atizar/server`. If sub-stage 1 is not done, STOP — build it first.

---

## CONTEXT FOR A FRESH AGENT (read before Task 1)

### What this is

The integration authentication feature (full design in the spec). Sub-stage 1 shipped the pure type contract + the `ATIZAR_` env accessor. THIS sub-stage builds the runtime: where a user's OAuth token is safely stored (encrypted Postgres, NOT files) and the one function every runtime calls to get a live credential. Sub-stage 3 (OAuth connect flow + UI) writes INTO this store; sub-stage 5 (gmail rewrite) consumes `resolveCredential`. So this sub-stage is the load-bearing middle — get the store + resolution API right and the rest plug in.

### The locked foundation (relevant invariants)

- **I3** — `@atizar/core` stays engine-free; all of THIS sub-stage is in `@atizar/server` (Node + Postgres live here legitimately). Do not put the store or crypto in core.
- **I5** — the resolver registry is the boundary seam: built-in `apiKey`/`oauth2` resolvers ship here; a custom-kind integration registers its OWN resolver (userland) WITHOUT editing core or this file. Build the registry so `registerResolver(kind, fn)` works from outside.

### Conventions (same as every sub-stage)

- English only; Prettier (`semi:false`, single quotes, `printWidth:100`); ESLint green.
- NEVER `git add -A` — exact paths. Commit trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- TDD: failing test → confirm it fails for the predicted reason → minimal impl → green → commit.
- Validation sweep from repo root: `yarn typecheck && yarn test && yarn lint`. `format:check` red on two pre-existing docs — keep YOUR files clean.
- **Real-PG tests run against `aiworkflow_test`** (vitest `globalSetup` creates+migrates it). Keep new DB tests there; **DO NOT truncate in `beforeEach`** (clobbers parallel files + the startup sweep can re-spawn real `claude`). Use unique `connectionId`/`integration` values per test + membership asserts. The globalSetup migrates the test DB from the migrations folder, so a NEW migration (Task 1) is applied there automatically.

### The exact seams you touch (confirmed as-built)

- **`packages/server/src/db/schema.ts`** — drizzle table defs (pgTable, pgEnum, `primaryKey({ columns: [...] })` for composite PKs — see the `trace` table). Add the `credentials` table here. Export `Credential`/`NewCredential` inferred types at the bottom (the file's pattern). The `kind` column is plain `text` (the contract's `kind` is an open string — NOT a pgEnum).
- **Migrations:** `apps/inbox/drizzle.config.ts` points drizzle-kit at `packages/server/src/db/schema.ts` → `out: packages/server/src/db/migrations`. Generate with `yarn workspace inbox db:generate` (creates a new `NNNN_*.sql` + updates `meta/`). Apply with `yarn workspace inbox db:migrate`. The test DB picks up the new migration via globalSetup; the dev DB via migrate-on-boot.
- **`packages/server/src/db/client.ts`** — `db` (drizzle instance) + `databaseUrl` (now via `atizarEnv`, from sub-stage 1). Import `db` for the store.
- **`atizarEnv`** (`packages/server/src/env.ts`, sub-stage 1) — `secretKey()`, `apiKey(integration)`, `oauthClient(provider)`, `connection()`, `databaseUrl()`. Use these — never read `process.env` directly.
- **`packages/server/src/index.ts`** — the barrel (named exports). Export the new public surface (`resolveCredential`, `registerResolver`, `credentialStore`, the types).
- **`@atizar/core`** — import `AuthSpec`, `ResolvedCredential`, `CredentialResolver`, `isOAuth2` (sub-stage 1).

### Encryption model (spec §3)

AES-256-GCM. The key is derived from `atizarEnv.secretKey()` (a string) → a 32-byte key (sha256 of the string, or require a 32-byte hex/base64 — see Task 2 for the exact rule). Each encrypt produces `iv:authTag:ciphertext` (base64 parts joined by `:`) stored as the `secret` column. Decrypt reverses it. If `secretKey()` is undefined, encryption is unavailable → the store throws on write and `resolveCredential` for oauth2 returns null (not connected). `apiKey` resolution does NOT need the secret key (it reads env, nothing stored).

---

## TASK 1: the `credentials` table + migration

**Files:**
- Modify: `packages/server/src/db/schema.ts`
- Generate: `packages/server/src/db/migrations/NNNN_*.sql` (+ `meta/` update) via drizzle-kit

- [ ] **Step 1: Add the table** to `schema.ts` (place it after `actionLedger`, before the inferred-type exports):

```ts
// Encrypted per-connection credentials (integration auth, spec 2026-06-11 §3). PK
// (connection_id, integration): connection_id is a developer-chosen LABEL ('default'|'home'|…),
// NOT a user account. `secret` is the AES-256-GCM blob (oauth2 token JSON or an apiKey) — plaintext
// NEVER hits the DB. `kind` is the open AuthSpec kind (plain text, not an enum). expires_at drives
// the oauth2 refresh-on-resolve.
export const credentials = pgTable(
  'credentials',
  {
    connectionId: text('connection_id').notNull(),
    integration: text('integration').notNull(),
    kind: text('kind').notNull(),
    secret: text('secret').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    connectedAt: timestamp('connected_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.integration] })]
)
```

Add the inferred types with the others at the bottom:

```ts
export type Credential = typeof credentials.$inferSelect
export type NewCredential = typeof credentials.$inferInsert
```

- [ ] **Step 2: Generate the migration**

```bash
yarn workspace inbox db:generate
```

Expected: a new `packages/server/src/db/migrations/NNNN_*.sql` creating `credentials` + a `meta/` snapshot update. Inspect the SQL — it must `CREATE TABLE "credentials"` with the composite PK and no destructive change to existing tables.

- [ ] **Step 3: Apply + verify** — `docker compose up -d postgres` then `yarn workspace inbox db:migrate` (applies to the dev DB). `yarn typecheck`. (The test DB gets it via globalSetup on the next test run.)

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/db/schema.ts packages/server/src/db/migrations/
git commit -m "feat(server): credentials table — encrypted per-connection store (auth sub-stage 2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK 2: `crypto.ts` — AES-256-GCM encrypt/decrypt (TDD, pure)

**Files:**
- Create: `packages/server/src/crypto.ts`
- Test: `packages/server/src/crypto.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run, confirm fail.**

- [ ] **Step 3: Implement `crypto.ts`**

```ts
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
```

- [ ] **Step 4: Run, confirm green (4 tests). Step 5: Commit.**

```bash
git add packages/server/src/crypto.ts packages/server/src/crypto.test.ts
git commit -m "feat(server): AES-256-GCM secret encryption helpers (auth sub-stage 2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK 3: `credentialStore.ts` — encrypt-on-write / decrypt-on-read CRUD (TDD, real-PG)

**Files:**
- Create: `packages/server/src/credentialStore.ts`
- Test: `packages/server/src/credentialStore.test.ts`

**Design:** `makeCredentialStore(db)` → `{ upsert, get, remove }`. `upsert({ connectionId, integration, kind, secret, expiresAt? })` encrypts `secret` (using `atizarEnv.secretKey()` → `deriveKey`) and upserts the row (`ON CONFLICT (connection_id, integration) DO UPDATE`). `get({ connectionId, integration })` returns `{ kind, secret(decrypted), expiresAt } | null`. `remove(...)` deletes. If `atizarEnv.secretKey()` is undefined, `upsert`/`get` of an encrypted secret throws a clear error (oauth2 store needs the key). **The stored `secret` column is NEVER plaintext** — the test asserts the raw DB value differs from the input.

- [ ] **Step 1: Write the failing test** (real-PG, `aiworkflow_test`, unique keys, no truncate)

```ts
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
    await store.upsert({ connectionId: conn, integration: 'gmail', kind: 'oauth2', secret: 'tok-123' })
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
    await store.upsert({ connectionId: conn, integration: 'gmail', kind: 'oauth2', secret: 'tok-456' })
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
```

- [ ] **Step 2: Run, confirm fail.**

- [ ] **Step 3: Implement `credentialStore.ts`**

```ts
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
          and(eq(credentials.connectionId, k.connectionId), eq(credentials.integration, k.integration))
        )
        .limit(1)
      if (!row) return null
      return { kind: row.kind, secret: decryptSecret(row.secret, key()), expiresAt: row.expiresAt }
    },

    async remove(k: CredentialKey): Promise<void> {
      await db
        .delete(credentials)
        .where(
          and(eq(credentials.connectionId, k.connectionId), eq(credentials.integration, k.integration))
        )
    },
  }
}

export type CredentialStore = ReturnType<typeof makeCredentialStore>
```

- [ ] **Step 4: Run the test (real PG must be up; globalSetup migrates `aiworkflow_test` incl. the Task-1 migration). Confirm green. Step 5: Commit.**

```bash
git add packages/server/src/credentialStore.ts packages/server/src/credentialStore.test.ts
git commit -m "feat(server): credentialStore — encrypt-on-write/decrypt-on-read CRUD over the credentials table

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK 4: OAuth provider descriptors (the token endpoint, shared with sub-stage 3)

**Files:**
- Create: `packages/server/src/oauthProviders.ts`
- Test: `packages/server/src/oauthProviders.test.ts`

A tiny map so `resolveCredential`'s oauth2 refresh (and sub-stage 3's connect flow) know each provider's endpoints. Beta ships `google`.

- [ ] **Step 1: Failing test**

```ts
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
```

- [ ] **Step 2: Run, fail. Step 3: Implement**

```ts
// OAuth provider endpoints (spec §3/§4). Beta ships google; add a provider = one entry here.
// Shared by resolveCredential's refresh (sub-stage 2) and the connect flow (sub-stage 3).
export interface OAuthProvider {
  authUrl: string
  tokenUrl: string
}

const PROVIDERS: Record<string, OAuthProvider> = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
  },
}

export function oauthProvider(provider: string): OAuthProvider | undefined {
  return PROVIDERS[provider]
}
```

- [ ] **Step 4: Run green. Step 5: Commit.**

```bash
git add packages/server/src/oauthProviders.ts packages/server/src/oauthProviders.test.ts
git commit -m "feat(server): oauth provider endpoint descriptors (google) (auth sub-stage 2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK 5: `resolveCredential` + built-in resolvers + registry (TDD)

**Files:**
- Create: `packages/server/src/resolveCredential.ts`
- Test: `packages/server/src/resolveCredential.test.ts`

**Design:**
- A resolver registry: `registerResolver(kind, fn)` + an internal lookup. Built-ins for `apiKey` + `oauth2` are registered at module load; `none` resolves to `null`. A custom kind with no registered resolver → `null` (and a `console.warn` so a misconfig is visible).
- `resolveCredential(ctx, deps?)` dispatches by `ctx.auth.kind`:
  - **apiKey:** `atizarEnv.apiKey(ctx.integration)` → `{ kind:'apiKey', apiKey }` or `null` if the env var is unset. (Never touches the DB.)
  - **oauth2:** `store.get({connectionId, integration})` → `null` if no row. Decrypt → the stored secret is the token JSON (`{ accessToken, refreshToken, expiresAt }`). If `expiresAt` passed (and a `refreshToken` + provider client exist), call the provider `tokenUrl` (via injectable `fetch`) to refresh, persist the new token (`store.upsert`), and return the fresh `accessToken`. Else return the stored token.
  - **custom:** the registered resolver, else `null`.
- `deps` injects `{ store, fetchFn, now }` for tests (default to the real store / global `fetch` / `Date.now`).

> Note: `Date.now()` is fine in server code (this is not a Workflow script). Inject `now` only so the refresh-on-expiry test is deterministic.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { resolveCredential, registerResolver } from './resolveCredential.js'
import type { AuthSpec } from '@atizar/core'

const fakeStore = (initial: Record<string, { kind: string; secret: string; expiresAt: Date | null }>) => {
  const m = new Map(Object.entries(initial))
  const k = (c: string, i: string) => `${c}:${i}`
  return {
    saved: m,
    get: async ({ connectionId, integration }: { connectionId: string; integration: string }) =>
      m.get(k(connectionId, integration)) ?? null,
    upsert: async (a: any) =>
      void m.set(k(a.connectionId, a.integration), { kind: a.kind, secret: a.secret, expiresAt: a.expiresAt ?? null }),
    remove: async () => {},
  }
}

describe('resolveCredential', () => {
  it('apiKey reads ATIZAR_<INTEGRATION>_API_KEY, null when unset', async () => {
    process.env.ATIZAR_SLACK_API_KEY = 'xoxb-1'
    const cred = await resolveCredential(
      { integration: 'slack', connectionId: 'default', auth: { kind: 'apiKey' } },
      { store: fakeStore({}) as any }
    )
    expect(cred).toEqual({ kind: 'apiKey', apiKey: 'xoxb-1' })
    delete process.env.ATIZAR_SLACK_API_KEY
    expect(
      await resolveCredential(
        { integration: 'slack', connectionId: 'default', auth: { kind: 'apiKey' } },
        { store: fakeStore({}) as any }
      )
    ).toBeNull()
  })

  it('oauth2 returns the stored token when not expired', async () => {
    const store = fakeStore({
      'default:gmail': {
        kind: 'oauth2',
        secret: JSON.stringify({ accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: 9_999_999_999_000 }),
        expiresAt: new Date(9_999_999_999_000),
      },
    })
    const cred = await resolveCredential(
      { integration: 'gmail', connectionId: 'default', auth: { kind: 'oauth2', provider: 'google', scopes: [] } },
      { store: store as any, now: () => 1_000 }
    )
    expect(cred).toMatchObject({ kind: 'oauth2', accessToken: 'at-1' })
  })

  it('oauth2 refreshes an expired token, persists, and returns the new accessToken', async () => {
    process.env.ATIZAR_GOOGLE_CLIENT_ID = 'cid'
    process.env.ATIZAR_GOOGLE_CLIENT_SECRET = 'csec'
    const store = fakeStore({
      'default:gmail': {
        kind: 'oauth2',
        secret: JSON.stringify({ accessToken: 'old', refreshToken: 'rt-1', expiresAt: 1_000 }),
        expiresAt: new Date(1_000),
      },
    })
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'new-at', expires_in: 3600 }),
    })) as any
    const cred = await resolveCredential(
      { integration: 'gmail', connectionId: 'default', auth: { kind: 'oauth2', provider: 'google', scopes: [] } },
      { store: store as any, fetchFn, now: () => 2_000 }
    )
    expect(fetchFn).toHaveBeenCalledOnce()
    expect(cred).toMatchObject({ kind: 'oauth2', accessToken: 'new-at' })
    // persisted: the stored token now has new-at
    const saved = JSON.parse((store.saved.get('default:gmail') as any).secret)
    expect(saved.accessToken).toBe('new-at')
    delete process.env.ATIZAR_GOOGLE_CLIENT_ID
    delete process.env.ATIZAR_GOOGLE_CLIENT_SECRET
  })

  it('oauth2 returns null when there is no stored row (not connected)', async () => {
    expect(
      await resolveCredential(
        { integration: 'gmail', connectionId: 'default', auth: { kind: 'oauth2', provider: 'google', scopes: [] } },
        { store: fakeStore({}) as any }
      )
    ).toBeNull()
  })

  it('a custom kind dispatches to a registered resolver', async () => {
    registerResolver('tg', async () => ({ kind: 'tg', session: 's1' }))
    const cred = await resolveCredential(
      { integration: 'tgbot', connectionId: 'default', auth: { kind: 'tg' } as AuthSpec },
      { store: fakeStore({}) as any }
    )
    expect(cred).toEqual({ kind: 'tg', session: 's1' })
  })

  it('an unknown custom kind returns null', async () => {
    expect(
      await resolveCredential(
        { integration: 'x', connectionId: 'default', auth: { kind: 'unregistered' } as AuthSpec },
        { store: fakeStore({}) as any }
      )
    ).toBeNull()
  })
})
```

- [ ] **Step 2: Run, confirm fail.**

- [ ] **Step 3: Implement `resolveCredential.ts`** — registry + built-ins + the orchestrator. The oauth2 resolver reads the store, refreshes via `oauthProvider(provider).tokenUrl` + `atizarEnv.oauthClient(provider)`, persists, and returns. Inject `store`/`fetchFn`/`now` via an optional `deps` param (defaults: `makeCredentialStore(db)`, global `fetch`, `Date.now`). Build it so `registerResolver` lets a userland custom kind plug in without editing this file (I5). Return `ResolvedCredential | null` everywhere.

> Implementation notes: the stored oauth2 secret is the JSON `{ accessToken, refreshToken, expiresAt }`. "Expired" = `expiresAt` present AND `<= now() + a small skew (e.g. 60s)`. Refresh POST body = `grant_type=refresh_token&refresh_token=…&client_id=…&client_secret=…` (form-encoded) to the provider `tokenUrl`; on `ok`, read `access_token` + `expires_in`, compute the new `expiresAt = now + expires_in*1000`, KEEP the existing `refreshToken` (Google often omits it on refresh), `store.upsert` the new JSON, return `{ kind:'oauth2', accessToken, refreshToken, expiresAt }`. On a non-ok refresh → return null (the token is dead → not connected → reconnect needed).

- [ ] **Step 4: Run the test → green (6 cases). `yarn typecheck`.**

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/resolveCredential.ts packages/server/src/resolveCredential.test.ts
git commit -m "feat(server): resolveCredential + built-in apiKey/oauth2 resolvers + custom-kind registry (auth sub-stage 2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK 6: barrel exports + `.env.example`

**Files:**
- Modify: `packages/server/src/index.ts`
- Create: `.env.example` (repo root)

- [ ] **Step 1: Export the public surface** from `packages/server/src/index.ts`:

```ts
export { resolveCredential, registerResolver } from './resolveCredential.js'
export { makeCredentialStore } from './credentialStore.js'
export type { CredentialStore, StoredCredential } from './credentialStore.js'
export { oauthProvider } from './oauthProviders.js'
export type { OAuthProvider } from './oauthProviders.js'
```

(Do NOT export `crypto.ts` — it is internal to the store.)

- [ ] **Step 2: Create `.env.example`** at the repo root (committed, NO values — the single "what keys do I need" source, spec §2):

```bash
# Atizar — environment example. Copy to .env.local and fill what you use.
# Official framework vars are ATIZAR_-prefixed; vendor vars (ANTHROPIC_API_KEY, …) are not.
# .env.local is gitignored; this file holds NO values.

# --- Framework ---
# AES master key for the encrypted credential store (any string; required for OAuth integrations).
ATIZAR_SECRET_KEY=
# Postgres URL override (optional; falls back to DATABASE_URL, then the docker-compose default).
ATIZAR_DATABASE_URL=

# --- Provider (LLM) ---
# Anthropic API key for PROVIDER=mastra (vendor convention — NOT namespaced).
ANTHROPIC_API_KEY=

# --- Google OAuth app (for Gmail and other Google integrations) ---
# One-time app registration from Google Cloud Console (APIs & Services → Credentials → OAuth client
# ID, type Desktop/Web). The per-user token comes from the in-app Connect flow, NOT from here.
ATIZAR_GOOGLE_CLIENT_ID=
ATIZAR_GOOGLE_CLIENT_SECRET=
```

> The `write-integration` skill appends an integration's own block here in sub-stage 4. `.gitignore` already ignores `.env`/`.env.local`; `.env.example` is NOT ignored (verify it is tracked after `git add`).

- [ ] **Step 3: Full sweep** — `yarn typecheck && yarn test && yarn lint`. Confirm `.env.example` is staged (not gitignored).

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/index.ts .env.example
git commit -m "feat(server): export the credential resolution surface + seed .env.example (auth sub-stage 2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK 7: wrap-up — foundation check + docs

**Files:** Modify `HANDOFF.md`

- [ ] **Step 1: Foundation check** — `check-foundation` on the sub-stage diff. Assert: no engine import entered `@atizar/core` (all here is `@atizar/server`); the resolver registry is the I5 seam (a custom kind plugs in without editing core or `resolveCredential.ts`); secrets are encrypted at rest (plaintext never in the DB). WARN → STOP.

- [ ] **Step 2: HANDOFF** — under the integration-auth track: "Sub-stage 2 ✅ BUILT — `credentials` table (encrypted, PK `(connection_id, integration)`) + `crypto.ts` (AES-256-GCM) + `credentialStore` + `resolveCredential` (built-in apiKey/oauth2 + token refresh + custom-kind registry) + `oauthProviders` (google) + `.env.example`. Next = sub-stage 3 (OAuth connect routes + Connections UI + claude-spawn env pass-through)."

- [ ] **Step 3: Final sweep + commit docs**

```bash
yarn typecheck && yarn test && yarn lint
git add HANDOFF.md
git commit -m "docs(handoff): integration auth sub-stage 2 (encrypted credential store + resolveCredential) built

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Final review** — dispatch a reviewer over the sub-stage: encryption is real (the raw column ≠ plaintext, verified by a real-PG test); refresh persists + returns the new token; null is returned consistently for not-connected; the registry lets a custom kind plug in; `crypto.ts` is not exported. Ready-to-merge or issues-first.

---

## SELF-REVIEW NOTES (applied)

- **Spec coverage (§3):** table = Task 1; crypto = Task 2; store = Task 3; provider endpoints (needed for refresh) = Task 4; `resolveCredential` + resolvers + registry = Task 5; barrel + `.env.example` (§2) = Task 6. OAuth routes/UI (§4), skill (§5), gmail rewrite (§6) are explicitly OUT.
- **I5 seam:** `registerResolver` is tested with a custom kind that resolves WITHOUT editing `resolveCredential.ts` — the load-bearing boundary detail.
- **Encryption at rest** is asserted against the REAL DB column (not just a round-trip), per the spec's testing section.
- **`connectionId` everywhere** (store key, resolve ctx) — using a non-`'default'` value is just data; nothing here hardcodes `'default'`.
- **Injected `store`/`fetchFn`/`now`** keep Task 5 unit-testable without real network/PG; the store itself is real-PG tested in Task 3.
- **No consumer of `resolveCredential` yet** — sub-stage 5 (gmail) wires it into the integration; sub-stage 3 writes into the store via the connect flow. This sub-stage ships the API they depend on.

## Subsequent sub-stages (design-level — detailed plan written just before each)

3. **OAuth connect flow + UI:** `/api/connect/:provider` + callback (state carries integration+connection; exchange code → `store.upsert`); the global-header Connect chip + a Connections surface; `claude-spawn.ts` passes `ATIZAR_SECRET_KEY`/`ATIZAR_DATABASE_URL`/`ATIZAR_CONNECTION` to MCP children so they `resolveCredential`. Browser E2E of connect/disconnect.
4. **`write-integration` skill:** the mandatory auth interview (STOP and ask if auth is unclear) + no-self-read enforcement + name the exact env var + append to `.env.example` + scaffold the `auth` declaration (and a resolver stub for a custom kind).
5. **Gmail rewrite (validation):** delete + rewrite a single `gmail` integration via the updated skill (`auth: oauth2/google/gmail.modify`, functions take `deps.credential`); re-point lead-inbox + email-inbox; full browser E2E (Connect → real Gmail action → Disconnect).
