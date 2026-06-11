# Integration authentication contract — design (2026-06-11)

The credential/connection mechanism for `@atizar` integrations. Today an integration reads its
own secrets (`gmail-client.mjs` reads `~/.gmail-mcp/*.json`), so a connected integration is not
production-ready: there is no safe place for an end user's credentials and no in-app way to
connect an account. This design inverts that — an integration **declares** what auth it needs and
**receives** a resolved credential; the framework owns provisioning, encrypted storage, and an
OAuth "Connect" flow. It also fixes the env namespace so framework variables never collide with a
developer's own. Validated by deleting the gmail integration and rewriting it through the updated
`write-integration` skill.

**Sequencing:** this stage runs AFTER email-inbox Stage 3 (in flight — it consumes the current
gmail-viewer). The gmail rewrite (§6) re-points lead-inbox + email-inbox onto the new contract.

## 0. The core inversion

| | Today | This design |
|---|---|---|
| Who knows the secret source | the integration (reads files/env itself) | the FRAMEWORK (resolves + injects) |
| Where a user's OAuth token lives | a plaintext file in `~/.gmail-mcp/` | an encrypted Postgres row (per account) |
| How an end user connects | hand-place two JSON files | a "Connect" button → OAuth → stored token |
| Adding a new auth method | — (no contract) | a resolver in userland, **core untouched** |

Belief #3 / invariant I5 hold: the SDK ships a thin **type** contract; implementations
(resolvers, the store, the OAuth routes) live outside core; a custom integration adds auth
**without editing core**.

## 1. The auth declaration (`@platform/core` — types only, OPEN)

An integration exports an `AuthSpec`. The `kind` is an **open string**, NOT a sealed enum — that is
the boundary fix (a sealed union would force a core edit for every new auth method):

```ts
// @platform/core — pure type, no fs/env/engine (like HealthCheck).
export type AuthSpec =
  | { kind: 'none' }
  | { kind: 'apiKey' } // a single secret string, resolved from env
  | { kind: 'oauth2'; provider: string; scopes: string[] } // provider e.g. 'google'
  | { kind: string; [key: string]: unknown } // ESCAPE HATCH: any custom kind, self-resolved

// The resolved credential handed to an integration function. A discriminated payload so an
// integration reads exactly what its kind produced.
export type ResolvedCredential =
  | { kind: 'apiKey'; apiKey: string }
  | { kind: 'oauth2'; accessToken: string; refreshToken?: string; expiresAt?: number; raw?: unknown }
  | { kind: string; [key: string]: unknown }

// A pluggable resolver: given the spec + the target account, produce the live credential. Built-in
// resolvers (apiKey, oauth2) ship in @platform/server; a custom-kind integration ships its OWN
// resolver in userland — core only defines the interface.
export type CredentialResolver = (ctx: {
  integration: string
  accountId: string
  auth: AuthSpec
}) => Promise<ResolvedCredential>
```

- `apiKey` covers the common custom case (a Telegram bot token, a Slack token, a Stripe key) → the
  developer declares `{ kind: 'apiKey' }` and the built-in resolver reads `ATIZAR_<INTEGRATION>_API_KEY`. **Zero core change.**
- `oauth2` covers Google/etc. → the built-in resolver decrypts the stored token and refreshes it.
- An exotic method (e.g. Telegram MTProto phone-login) → the integration ships a custom
  `CredentialResolver` registered under its `kind`; core is not touched (same pattern as effects:
  names/types in core, functions in a binding outside).

### What the integration looks like

```ts
// userland: packages/integrations/src/gmail/auth.mjs  (or .d.ts beside it)
export const auth = { kind: 'oauth2', provider: 'google', scopes: ['https://www.googleapis.com/auth/gmail.modify'] }
```

Integration functions take the resolved credential via `deps` (generalizing today's injectable
`deps.getGmail`) — they NEVER read `process.env`/files for secrets:

```ts
export async function listUnread({ sinceHours } = {}, deps = {}) {
  const cred = deps.credential // ResolvedCredential (oauth2) — injected by the framework
  const gmail = makeGmailClient(cred) // build the client FROM the credential
  // …
}
```

## 2. Env namespace (`ATIZAR_` prefix)

All framework-owned + integration config is namespaced so it can't collide with a developer's own
env:
- `ATIZAR_SECRET_KEY` — the master AES key for the credential store (required when any oauth2
  integration is used).
- `ATIZAR_<PROVIDER>_CLIENT_ID` / `ATIZAR_<PROVIDER>_CLIENT_SECRET` — the OAuth APP registration,
  per provider (e.g. `ATIZAR_GOOGLE_CLIENT_ID`), shared by every integration of that provider.
- `ATIZAR_<INTEGRATION>_API_KEY` — for `apiKey` integrations (e.g. `ATIZAR_TELEGRAM_API_KEY`).
- `ATIZAR_DATABASE_URL` (optional override; falls back to the existing `DATABASE_URL` /
  compose default so nothing breaks).
- **NOT renamed:** `ANTHROPIC_API_KEY` (the vendor SDK's own convention — not ours to namespace),
  `PROVIDER`, `MASTRA_MODEL`, `DEV_RECORD_REPLAY`. The prefix governs ATIZAR-owned config; vendor
  conventions stay as the vendor names them.

A small `env.ts` helper in `@platform/server` reads `ATIZAR_*` by a typed accessor so the prefix is
applied in ONE place (no scattered `process.env.ATIZAR_…` strings).

## 3. Credential store + resolution (`@platform/server`)

- **Table `credentials`** (drizzle): PK `(account_id, integration)`; columns `kind`, `secret`
  (the encrypted blob — the oauth2 token JSON or the apiKey), `expires_at` (nullable),
  `connected_at`, `updated_at`. AES-256-GCM with the key from `ATIZAR_SECRET_KEY`; a tiny
  `crypto.ts` (encrypt/decrypt) — Node `crypto`, no new dep.
- **Account model:** `account_id` is part of the key from day one (multi-ready), but the beta wires
  a single `'default'` account (no user-login system yet — bearer token is the packaging stage).
- **`resolveCredential` (the single path):** built-in resolvers keyed by `kind`:
  - `apiKey` → `ATIZAR_<INTEGRATION>_API_KEY` (no DB; never stored).
  - `oauth2` → load+decrypt the row; if `expires_at` passed, refresh via the provider's token
    endpoint using `ATIZAR_<PROVIDER>_CLIENT_*`, persist the new token, return the access token.
  - a custom `kind` → the integration's own registered resolver.
  - Missing/expired-unrefreshable → returns a typed "not connected" so the F3 health surface shows
    the agent as needing a connection (the existing `checkCredentials` becomes "is there a usable
    resolved credential?").
- **One resolution path for all three runtimes:** server effects (in-process), native Mastra read
  tools (in-process), AND the stdio MCP children for claude-cli. The MCP child resolves the
  credential ITSELF — `claude-spawn.ts` passes `ATIZAR_SECRET_KEY` + `ATIZAR_DATABASE_URL` (and the
  provider client envs) through to the child, and the child imports the SAME `resolveCredential`
  + integration `auth`. (Without this, the child process has no token.)
- A new resolver registry seam: built-ins registered in `@platform/server`; a custom-kind resolver
  is registered by the app when it wires the integration (userland), so core stays closed-free.

## 4. The OAuth "Connect" flow

- **Routes (`@platform/server`):**
  - `GET /api/connect/:provider?integration=<id>` → build the provider's auth URL
    (`ATIZAR_<PROVIDER>_CLIENT_ID` + the integration's `auth.scopes` + a signed `state`) → 302 to
    the provider. `access_type=offline` + `prompt=consent` for Google so a refresh token comes back.
  - `GET /api/connect/:provider/callback` → verify `state` → exchange `code` for tokens (using
    `ATIZAR_<PROVIDER>_CLIENT_SECRET`) → encrypt → upsert into `credentials` (`account='default'`)
    → 302 back to the UI `/?connected=<integration>`.
- **UI (React):** a **Connections** view (its own small surface, fits with the Stage-4 chrome but
  is independent): one row per integration with status (connected / not connected, from the health
  surface) and a **Connect** / **Reconnect** / **Disconnect** button. "Connect" navigates to
  `/api/connect/:provider?integration=…`. **The consumer never touches files** — this is the
  "понятный механизм".
- **Disconnect** → `DELETE /api/connections/:integration` removes the row (revoking at the provider
  is post-beta).

## 5. `write-integration` skill — the auth interview (MANDATORY stop-and-ask)

Stage 2 (Intent gate) of the skill gains an explicit auth determination. **If the skill cannot tell
from the service's docs/the developer's description HOW authentication works, it MUST STOP and ask
the developer — never guess.** It must establish:
- the `kind` (`none` / `apiKey` / `oauth2` / a custom kind);
- for `oauth2`: the provider name + the exact scopes (ask if unstated);
- for `apiKey`: the env var name it will read (`ATIZAR_<INTEGRATION>_API_KEY`);
- for a custom kind: that the integration must ship its own `CredentialResolver` (the skill
  scaffolds the resolver stub and explains it registers in userland, not core).

The skill then enforces the contract: the integration **declares `auth`** and its functions
**receive the credential via `deps`** — a generated check / review step confirms NO
`process.env`/file read for secrets lives inside the integration. The "integration contract (FACTS)"
block is updated: "Auth is declared, never self-read. Credentials are injected (`deps.credential`).
Use the `ATIZAR_` env namespace. If you don't understand the service's auth, STOP and ask."

## 6. Validation — rewrite the gmail integration through the new skill

After Stage 3 lands, **delete the gmail integration(s) and rewrite a single `gmail` integration via
the updated skill**:
- declares `auth: { kind: 'oauth2', provider: 'google', scopes: ['…gmail.modify'] }`;
- functions (`listUnread`/`getEmail`/`markRead`/`trash`/`star`/`createDraft`) take `deps.credential`
  and build the client from it (delete `gmail-client.mjs`'s file/env reading);
- `checkCredentials` becomes "resolveCredential succeeds";
- re-point lead-inbox + email-inbox server bindings + the MCP/Mastra wiring to the `gmail`
  integration.
- **Browser E2E:** Connect Gmail via the button → token stored encrypted → run email-inbox →
  real Gmail actions on the connected account; Disconnect → the agent shows "not connected". This
  proves the contract + the skill + the OAuth flow end to end.

> Migration note: existing `~/.gmail-mcp/` files become irrelevant — the dev connects once via the
> button (or a one-time import script seeds the `credentials` row from the old file, optional).
> The two GCP files still supply `ATIZAR_GOOGLE_CLIENT_ID/SECRET` (the app registration) — that is
> the unavoidable one-time developer step; the per-user token now comes from the OAuth flow.

## 7. Build stages (each its own plan; one branch)

1. **Auth contract + env namespace** — `AuthSpec`/`ResolvedCredential`/`CredentialResolver` types in
   `@platform/core`; the `ATIZAR_` `env.ts` accessor in `@platform/server`. Pure, unit-tested.
2. **Credential store + resolution** — the `credentials` table + `crypto.ts` + `resolveCredential`
   + the built-in `apiKey`/`oauth2` resolvers + the resolver registry + token refresh. Real-PG
   tests (encrypt round-trip, refresh-on-expiry, apiKey-from-env, not-connected).
3. **OAuth connect flow** — the connect/callback routes + `state` signing + the Connections UI +
   `claude-spawn` env pass-through so MCP children resolve. Browser E2E of connect/disconnect.
4. **Skill update** — the `write-integration` auth interview + the "stop and ask" rule + the
   no-self-read enforcement.
5. **Gmail rewrite (validation)** — delete + rewrite via the skill; re-point both workflows; full
   browser E2E on the connected account.

## 8. Testing

- Unit: AuthSpec/resolver types; `crypto` encrypt/decrypt round-trip; `resolveCredential` per kind
  (apiKey-from-env, oauth2 decrypt, refresh-on-expiry, custom-resolver dispatch, not-connected);
  the `ATIZAR_` env accessor; the skill's scaffolded no-self-read check.
- Real-Postgres: the `credentials` table CRUD + encryption at rest (the stored blob is not the
  plaintext token).
- Browser E2E (the proof): Connect Gmail → email-inbox runs on the connected token → real Gmail
  action → Disconnect → agent unhealthy. Both claude-cli (MCP child resolves) and the in-process
  paths.

## 9. Out of scope (explicit)

- A user-login / multi-tenant identity system (bearer token = packaging stage; `account_id` is just
  `'default'` for the beta but the schema is ready).
- Revoking tokens at the provider on disconnect (delete the row only, for now).
- A secrets vault integration (env + encrypted Postgres is the beta; a Vault/KMS adapter is a later
  resolver).
- Per-field consumer editing of secrets (secrets are never consumer-editable text — only the
  Connect gesture).
