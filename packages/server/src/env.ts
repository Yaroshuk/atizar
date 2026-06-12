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

  // The shared bearer token gating mutating routes. Undefined ⇒ auth disabled (fail-open).
  authToken(): string | undefined {
    return process.env.ATIZAR_AUTH_TOKEN
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

  // The public origin used to build redirect_uri for OAuth callbacks. Defaults to the local Vite
  // dev server so a fresh dev checkout needs no env file.
  publicUrl(): string {
    return process.env.ATIZAR_PUBLIC_URL || 'http://localhost:5173'
  },

  // DB URL precedence: ATIZAR_DATABASE_URL (namespaced) > DATABASE_URL (legacy) > compose default.
  // Keeps today's default so a fresh `docker compose up -d postgres` still needs no env file.
  databaseUrl(): string {
    return process.env.ATIZAR_DATABASE_URL ?? process.env.DATABASE_URL ?? COMPOSE_DEFAULT_DB
  },
}

// DEMO is a dev/demo tooling flag (NOT an ATIZAR_ runtime var — same class as DEV_RECORD_REPLAY),
// so it is read here as a standalone helper, not on atizarEnv. `DEMO=1` ⇒ zero-credential demo mode
// (PGlite in-memory, strict synthetic-cassette replay, fake effects, email-inbox only).
export function isDemo(): boolean {
  return process.env.DEMO === '1'
}
