# Integration Auth — Sub-stage 1: contract types + ATIZAR env namespace — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the foundation for the integration authentication contract (spec: `docs/superpowers/specs/2026-06-11-integration-auth-contract-design.md`, §1 + §2): the pure type contract in `@platform/core` (`AuthSpec`, `ResolvedCredential`, `CredentialResolver`) and the `ATIZAR_`-prefixed env accessor in `@platform/server`. NO storage, NO OAuth flow, NO skill changes, NO gmail rewrite — those are sub-stages 2–5. This sub-stage ships only types + an env helper, fully unit-tested, with zero runtime behavior change to the existing app.

**Architecture:** Two small, isolated units. (1) `packages/core/src/integration-auth.ts` — pure TypeScript types (no fs, no env, no engine import — mirrors the existing `integration.ts`/`HealthCheck` pattern), exported from the core barrel. (2) `packages/server/src/env.ts` — a typed accessor that reads `ATIZAR_*` variables in ONE place so the prefix is never scattered as raw `process.env.ATIZAR_…` strings; it also defines the precedence for the DB URL (`ATIZAR_DATABASE_URL` → existing `DATABASE_URL` → compose default) without breaking today's `databaseUrl`.

**Tech Stack:** TypeScript (strict), vitest, yarn-classic workspace, NO build step (packages export `./src/index.ts`; `tsc --build` typechecks). Node `crypto`/`process.env` only — no new dependency.

**Branch:** continue on `feat/gmail-viewer` (the whole feature track shares this branch). Verify `git rev-parse --abbrev-ref HEAD` → `feat/gmail-viewer`; if not, STOP and report.

---

## CONTEXT FOR A FRESH AGENT (read before Task 1)

### What this is

An open-source agent-automation framework. We are building an **integration authentication contract** so an integration declares what credentials it needs and the framework provisions/stores/injects them (today each integration reads its own secret files — not production-ready). The full design is the spec above; THIS plan is only its first, foundational sub-stage: the shared types + the env namespace. Everything else (encrypted Postgres store, OAuth connect flow + UI, the `write-integration` skill's auth interview, the gmail rewrite) comes in later sub-stages and DEPENDS on these types existing.

### The locked foundation (relevant invariants)

`docs/PHILOSOPHY.md` + `docs/ARCHITECTURE.md` §0. This sub-stage touches:
- **I3** — `@platform/core` stays engine-free and Node-free: the auth types are PURE (no `fs`, no `process.env`, no `googleapis`, no Postgres). They are types + maybe a trivial type-guard, exactly like the existing `HealthCheck`/`ReadResult` in `packages/core/src/integration.ts`.
- **I5** — the framework/userland boundary: the SDK ships the THIN type contract; a custom integration adds a new auth `kind` WITHOUT editing core, because `kind` is an OPEN string (not a sealed enum) and the resolver is pluggable. Do NOT make `kind` a closed union — that is the whole point (a developer writing a Telegram integration must not have to edit core).

No foundation-doc edits are expected in this sub-stage.

### Conventions that bind every task

- English only (code, comments, identifiers, tests).
- Prettier: `semi: false`, single quotes, `trailingComma: 'es5'`, `printWidth: 100`. ESLint must stay green.
- NEVER `git add -A` / `git add .` — stage EXACT paths (the user edits docs in parallel; cassette/secret files must never be staged — there is a `guard-cassette-share` hook).
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- TDD: write the failing test, RUN it and confirm it fails for the predicted reason, implement minimally, confirm green, commit.
- Validation sweep from the repo root: `yarn typecheck && yarn test && yarn lint`. `yarn format:check` is RED on two pre-existing docs the user maintains (`.claude/skills/README.md`, `.claude/skills/check-foundation/SKILL.md`) — leave them; keep YOUR files Prettier-clean (`npx prettier --check <your files>`).

### The exact seams you touch (confirmed as-built)

- **`packages/core/src/index.ts`** — the core barrel. Export style is `export * from './<module>.js'` (note the `.js` extension in the specifier even though the file is `.ts` — that is the project's ESM/NodeNext convention). Existing line `export * from './integration.js'` is the sibling pattern to copy.
- **`packages/core/src/integration.ts`** — the EXISTING thin integration contract (`HealthCheck`, `ReadResult<T>`, `BatchActionResult`, `isOk`). Your new `integration-auth.ts` is its sibling: same purity, same style, same "types + one small guard" shape. (Keep them separate files — `integration.ts` is result shapes, `integration-auth.ts` is auth shapes; one responsibility each.)
- **`packages/server/src/db/client.ts`** — today: `export const databaseUrl = process.env.DATABASE_URL ?? 'postgres://aiworkflow:aiworkflow@localhost:5432/aiworkflow'`. Your `env.ts` adds the `ATIZAR_DATABASE_URL` precedence WITHOUT breaking this default; `client.ts` will read from `env.ts` (Task 4) so there is one source.
- **`packages/server/src/index.ts`** — the server barrel (named exports, e.g. `export { databaseUrl } from './db/client.js'`). Add the `env.ts` accessor exports here.

### Why types-first, alone

Sub-stages 2–5 (store, OAuth, skill, gmail) all reference these types. Shipping them first, with zero behavior change, means the later sub-stages are pure additions against a stable contract — and this sub-stage is trivially safe to land (it changes no running code path).

---

## TASK 1: `AuthSpec` / `ResolvedCredential` / `CredentialResolver` types in core (TDD)

**Files:**
- Create: `packages/core/src/integration-auth.ts`
- Test: `packages/core/src/integration-auth.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
    const tok: ResolvedCredential = { kind: 'oauth2', accessToken: 'at', refreshToken: 'rt', expiresAt: 1 }
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
    const cred = await resolver({ integration: 'gmail', connectionId: 'default', auth: { kind: 'apiKey' } })
    expect(cred).toEqual({ kind: 'apiKey', apiKey: 'sk-x' })
    // null is a valid "not connected" result.
    const none: CredentialResolver = async () => null
    expect(await none({ integration: 'x', connectionId: 'default', auth: { kind: 'none' } })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it, confirm it fails** — `yarn vitest run packages/core/src/integration-auth.test.ts` → FAIL (cannot resolve `./integration-auth.js`).

- [ ] **Step 3: Implement `integration-auth.ts`**

```ts
// The integration AUTHENTICATION contract (spec 2026-06-11 §1). TYPES ONLY — no base class, no
// runtime registration, no fs/env/engine import (pure, like ./integration.ts). The `kind` is an
// OPEN string, NOT a sealed union: built-in kinds ('apiKey'/'oauth2') get framework resolvers; a
// custom integration ships its OWN resolver for any other kind, WITHOUT editing core (invariant
// I5). An integration DECLARES its AuthSpec and RECEIVES a ResolvedCredential — it never reads a
// secret itself.

export type AuthSpec =
  | { kind: 'none' }
  | { kind: 'apiKey' }
  | { kind: 'oauth2'; provider: string; scopes: string[] }
  // Escape hatch: any custom kind. Extra fields carry whatever the custom resolver needs.
  | { kind: string; [key: string]: unknown }

// The live credential handed to an integration function (via `deps.credential`). Discriminated by
// kind so a function reads exactly what its kind produced; open for custom kinds.
export type ResolvedCredential =
  | { kind: 'apiKey'; apiKey: string }
  | {
      kind: 'oauth2'
      accessToken: string
      refreshToken?: string
      expiresAt?: number
      raw?: unknown
    }
  | { kind: string; [key: string]: unknown }

// Resolve a live credential for a (integration, connection) pair. `connectionId` is a
// developer-chosen connection LABEL ('default' | 'home' | 'work' | …) — NOT a user account; it
// lets two workflows reuse one integration under two credentials (e.g. home vs work mailbox).
// Built-in resolvers (apiKey/oauth2) ship in @platform/server; a custom-kind integration registers
// its own — core only defines this interface.
export type CredentialResolver = (ctx: {
  integration: string
  connectionId: string
  auth: AuthSpec
}) => Promise<ResolvedCredential | null> // null = not connected / no usable credential

// Narrow an AuthSpec to the built-in oauth2 shape.
export function isOAuth2(
  auth: AuthSpec
): auth is { kind: 'oauth2'; provider: string; scopes: string[] } {
  return auth.kind === 'oauth2'
}
```

- [ ] **Step 4: Export from the core barrel** — add to `packages/core/src/index.ts`:

```ts
export * from './integration-auth.js'
```

- [ ] **Step 5: Run the test + typecheck** — `yarn vitest run packages/core/src/integration-auth.test.ts` (PASS, 4 tests) then `yarn typecheck` (green; the new types compile into the core declaration build).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/integration-auth.ts packages/core/src/integration-auth.test.ts packages/core/src/index.ts
git commit -m "feat(core): integration auth contract types (open AuthSpec kind + ResolvedCredential + CredentialResolver)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK 2: the `ATIZAR_` env accessor in `@platform/server` (TDD)

A single typed reader for `ATIZAR_*` so the prefix lives in ONE place (never scattered as raw `process.env.ATIZAR_…` strings) and the naming scheme (§2 of the spec) is enforced by construction.

**Files:**
- Create: `packages/server/src/env.ts`
- Test: `packages/server/src/env.test.ts`

- [ ] **Step 1: Write the failing test** (tests set/restore `process.env` leak-safely — capture and restore in `finally`, the repo's pattern from `health.test.ts`)

```ts
// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import { atizarEnv } from './env.js'

const saved = { ...process.env }
afterEach(() => {
  // restore to the snapshot (delete keys added by a test)
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
  Object.assign(process.env, saved)
})

describe('atizarEnv', () => {
  it('reads the master secret key', () => {
    process.env.ATIZAR_SECRET_KEY = 'abc'
    expect(atizarEnv.secretKey()).toBe('abc')
  })

  it('builds the per-integration apiKey var name and reads it (uppercased)', () => {
    process.env.ATIZAR_TELEGRAM_API_KEY = 'tok'
    expect(atizarEnv.apiKey('telegram')).toBe('tok')
    expect(atizarEnv.apiKey('gmail')).toBeUndefined()
  })

  it('reads the per-provider OAuth client id/secret', () => {
    process.env.ATIZAR_GOOGLE_CLIENT_ID = 'cid'
    process.env.ATIZAR_GOOGLE_CLIENT_SECRET = 'csec'
    expect(atizarEnv.oauthClient('google')).toEqual({ clientId: 'cid', clientSecret: 'csec' })
  })

  it('returns undefined parts when an OAuth client var is missing', () => {
    delete process.env.ATIZAR_GOOGLE_CLIENT_ID
    delete process.env.ATIZAR_GOOGLE_CLIENT_SECRET
    expect(atizarEnv.oauthClient('google')).toEqual({ clientId: undefined, clientSecret: undefined })
  })

  it('reads the active connection label, defaulting to "default"', () => {
    delete process.env.ATIZAR_CONNECTION
    expect(atizarEnv.connection()).toBe('default')
    process.env.ATIZAR_CONNECTION = 'home'
    expect(atizarEnv.connection()).toBe('home')
  })

  it('databaseUrl precedence: ATIZAR_DATABASE_URL > DATABASE_URL > compose default', () => {
    delete process.env.ATIZAR_DATABASE_URL
    delete process.env.DATABASE_URL
    expect(atizarEnv.databaseUrl()).toBe('postgres://aiworkflow:aiworkflow@localhost:5432/aiworkflow')
    process.env.DATABASE_URL = 'postgres://x/y'
    expect(atizarEnv.databaseUrl()).toBe('postgres://x/y')
    process.env.ATIZAR_DATABASE_URL = 'postgres://a/b'
    expect(atizarEnv.databaseUrl()).toBe('postgres://a/b')
  })
})
```

- [ ] **Step 2: Run it, confirm it fails** — `yarn vitest run packages/server/src/env.test.ts`.

- [ ] **Step 3: Implement `env.ts`**

```ts
// The ONE place ATIZAR_* environment variables are read. Keeping the prefix here (never scattered
// as raw process.env.ATIZAR_… strings) is the env-namespace contract (spec 2026-06-11 §2):
//   RULE — every OFFICIAL framework env var carries the ATIZAR_ prefix and is read here; every
//   UNOFFICIAL/vendor var (a convention we merely consume) stays WITHOUT the prefix and is read as
//   the vendor names it. ATIZAR_* = ours; anything else = not ours.
// So ANTHROPIC_API_KEY, PROVIDER, MASTRA_MODEL, DEV_RECORD_REPLAY are NOT namespaced (they belong
// to their vendors), and a NEW official var must be ATIZAR_-prefixed and added to this accessor.

const COMPOSE_DEFAULT_DB = 'postgres://aiworkflow:aiworkflow@localhost:5432/aiworkflow'

// Uppercase + replace non-alphanumerics with `_` so an integration/provider id maps to an env
// segment (e.g. 'gmail-viewer' → 'GMAIL_VIEWER').
const seg = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]+/g, '_')

export const atizarEnv = {
  // AES master key for the credential store (sub-stage 2 uses it). Undefined ⇒ no oauth2 store.
  secretKey(): string | undefined {
    return process.env.ATIZAR_SECRET_KEY
  },

  // The single secret string for an `apiKey` integration: ATIZAR_<INTEGRATION>_API_KEY.
  apiKey(integration: string): string | undefined {
    return process.env[`ATIZAR_${seg(integration)}_API_KEY`]
  },

  // The OAuth app registration for a provider: ATIZAR_<PROVIDER>_CLIENT_ID / _CLIENT_SECRET.
  oauthClient(provider: string): { clientId?: string; clientSecret?: string } {
    return {
      clientId: process.env[`ATIZAR_${seg(provider)}_CLIENT_ID`],
      clientSecret: process.env[`ATIZAR_${seg(provider)}_CLIENT_SECRET`],
    }
  },

  // The active connection label for this process (sub-stage 2 threads it; claude-spawn passes
  // ATIZAR_CONNECTION to MCP children). Defaults to 'default'.
  connection(): string {
    return process.env.ATIZAR_CONNECTION || 'default'
  },

  // DB URL precedence: ATIZAR_DATABASE_URL (namespaced) > DATABASE_URL (legacy) > compose default.
  // Keeps today's default so a fresh `docker compose up -d postgres` still needs no env file.
  databaseUrl(): string {
    return process.env.ATIZAR_DATABASE_URL ?? process.env.DATABASE_URL ?? COMPOSE_DEFAULT_DB
  },
}
```

- [ ] **Step 4: Run the test** → PASS (all cases). `yarn typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/env.ts packages/server/src/env.test.ts
git commit -m "feat(server): atizarEnv — single typed reader for the ATIZAR_ env namespace

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK 3: export `atizarEnv` from the server barrel

**Files:** Modify `packages/server/src/index.ts`

- [ ] **Step 1:** add to the server barrel (named export, matching the file's style):

```ts
export { atizarEnv } from './env.js'
```

- [ ] **Step 2:** `yarn typecheck` (green). Commit.

```bash
git add packages/server/src/index.ts
git commit -m "feat(server): export atizarEnv from the package barrel

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK 4: route the existing `databaseUrl` through `atizarEnv` (no behavior change)

Make `db/client.ts` use the one env source so `ATIZAR_DATABASE_URL` works and there is a single precedence rule. This must NOT change the default behavior (a fresh clone with neither var set still gets the compose default).

**Files:**
- Modify: `packages/server/src/db/client.ts`

- [ ] **Step 1:** replace the inline `databaseUrl` literal with the accessor:

```ts
import { atizarEnv } from '../env.js'
// …
// Postgres is THE backend. Precedence + default live in atizarEnv (ATIZAR_DATABASE_URL >
// DATABASE_URL > compose default), so a fresh `docker compose up -d postgres` needs no env file.
export const databaseUrl = atizarEnv.databaseUrl()
```

(Keep the `export const databaseUrl` name — `apps/inbox/server/providers.ts` imports it for the Mastra DB URL. The value is identical when no `ATIZAR_DATABASE_URL` is set, so nothing regresses.)

- [ ] **Step 2: Full validation sweep** — `yarn typecheck && yarn test && yarn lint` (all green). The existing DB-backed tests must still connect to `aiworkflow_test` exactly as before (they set `DATABASE_URL` via the vitest globalSetup, which `atizarEnv.databaseUrl()` still honors as the second precedence). Confirm the pipeline/store tests pass unchanged.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/db/client.ts
git commit -m "refactor(server): resolve databaseUrl via atizarEnv (adds ATIZAR_DATABASE_URL precedence, same default)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK 5: wrap-up — foundation check + docs

**Files:**
- Modify: `HANDOFF.md`

- [ ] **Step 1: Foundation check** — invoke the `check-foundation` skill on the sub-stage diff. Expected CLEAR: the auth types are pure (no engine/Node import in `@platform/core` — I3), the `kind` is open so a new auth method needs no core edit (I5), and no running behavior changed. A WARN is a STOP — surface to the user.

- [ ] **Step 2: HANDOFF** — add an entry under a new "Integration auth contract" track (or alongside the email-inbox track): "Sub-stage 1 (contract types + ATIZAR env namespace) ✅ BUILT — `@platform/core` `integration-auth.ts` (`AuthSpec` open-kind / `ResolvedCredential` / `CredentialResolver`); `@platform/server` `atizarEnv` accessor (single ATIZAR_* reader, `databaseUrl` now routed through it). No behavior change. Next = sub-stage 2 (encrypted Postgres credential store + `resolveCredential` + built-in apiKey/oauth2 resolvers)." Spec → `docs/superpowers/specs/2026-06-11-integration-auth-contract-design.md`.

- [ ] **Step 3: Final sweep + commit docs**

```bash
yarn typecheck && yarn test && yarn lint
git add HANDOFF.md
git commit -m "docs(handoff): integration auth sub-stage 1 (contract types + ATIZAR env) built; next = credential store

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Final review** — dispatch a reviewer over the sub-stage commits: the `kind` is genuinely open (a custom-kind `AuthSpec` type-checks); `atizarEnv` is the sole `ATIZAR_*` reader; `databaseUrl` default is unchanged; everything is pure/typed with no running-path change. Ready-to-merge or issues-first.

---

## SELF-REVIEW NOTES (applied)

- **Spec coverage:** §1 (AuthSpec/ResolvedCredential/CredentialResolver, open kind) = Task 1; §2 (ATIZAR_ namespace, the var names, ANTHROPIC_API_KEY left alone, ATIZAR_DATABASE_URL precedence) = Tasks 2–4. Storage/OAuth/skill/gmail (§3–§6) are explicitly OUT (later sub-stages).
- **Boundary (I5):** the `kind: string` open union + the custom-kind branch in both `AuthSpec` and `ResolvedCredential` are the load-bearing detail — Task 1's first test asserts a custom kind type-checks without a core edit. Do not "tidy" it into a sealed union.
- **No behavior change:** Task 4 keeps the `databaseUrl` default identical; the env accessor only ADDS the `ATIZAR_*` precedence. The DB-test globalSetup still works via the `DATABASE_URL` middle precedence.
- **Purity (I3):** `integration-auth.ts` imports nothing; `env.ts` reads only `process.env` and lives in `@platform/server` (not core).
- **connectionId** is in the `CredentialResolver` signature + the `atizarEnv.connection()` reader from day one (spec decision 2026-06-11), wired to `'default'`; actually USING it (the store key, the spawn pass-through) is sub-stage 2/3.

## Subsequent sub-stages (design-level — each gets its own plan)

2. **Credential store + resolution:** the `credentials` table (PK `(connection_id, integration)`) + `crypto.ts` (AES-256-GCM, key from `atizarEnv.secretKey()`) + `resolveCredential` + built-in `apiKey`/`oauth2` resolvers + the resolver registry + token refresh. Real-PG tests.
3. **OAuth connect flow:** `/api/connect/:provider` + callback (state carries integration+connection) + the global-header Connect chip + Connections surface + `claude-spawn` env pass-through (`ATIZAR_SECRET_KEY`/`ATIZAR_DATABASE_URL`/`ATIZAR_CONNECTION`) so MCP children resolve. Browser E2E of connect/disconnect.
4. **`write-integration` skill:** the mandatory auth interview (STOP and ask the developer if the auth method is unclear) + the no-self-read enforcement + scaffolding the `auth` declaration and (for custom kinds) the resolver stub.
5. **Gmail rewrite (validation):** delete + rewrite a single `gmail` integration via the updated skill (`auth: oauth2/google/gmail.modify`, functions take `deps.credential`); re-point lead-inbox + email-inbox; full browser E2E (Connect → real Gmail action → Disconnect).
