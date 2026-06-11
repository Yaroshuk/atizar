import type { AuthSpec, CredentialResolver, ResolvedCredential } from '@platform/core'
import { isOAuth2 } from '@platform/core'
import { db } from './db/client.js'
import { atizarEnv } from './env.js'
import { makeCredentialStore, type CredentialStore } from './credentialStore.js'
import { oauthProvider } from './oauthProviders.js'

// The single credential-resolution path (spec §3). Built-in `apiKey`/`oauth2`/`none` resolvers are
// registered at module load; a CUSTOM-kind integration plugs in its own via `registerResolver`
// WITHOUT editing this file or core (invariant I5). Every resolver returns ResolvedCredential|null
// — `null` = not connected (the F3 health surface shows the agent as needing a connection).

export interface ResolveCtx {
  integration: string
  connectionId: string
  auth: AuthSpec
}

// Runtime deps, injected for tests (defaults = the real store / global fetch / Date.now).
export interface ResolveDeps {
  store?: CredentialStore
  fetchFn?: typeof fetch
  now?: () => number
}

// The stored oauth2 secret blob (JSON, encrypted at rest by the credentialStore).
interface OAuthToken {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
}

// A resolver as held in the registry — it also receives the resolved runtime deps. Custom resolvers
// registered via `registerResolver` get the ctx-only `CredentialResolver` shape (deps ignored).
type InternalResolver = (
  ctx: ResolveCtx,
  deps: Required<ResolveDeps>
) => Promise<ResolvedCredential | null>

const registry = new Map<string, InternalResolver>()

// Register a resolver for a custom auth `kind` (userland — the I5 seam). The framework's built-ins
// ('apiKey'/'oauth2'/'none') are registered below at module load.
export function registerResolver(kind: string, fn: CredentialResolver): void {
  registry.set(kind, (ctx) => fn(ctx))
}

// --- built-ins ---

registry.set('none', async () => null)

// apiKey: the single secret string from ATIZAR_<INTEGRATION>_API_KEY (never stored in the DB).
registry.set('apiKey', async (ctx) => {
  const apiKey = atizarEnv.apiKey(ctx.integration)
  return apiKey ? { kind: 'apiKey', apiKey } : null
})

// oauth2: load the stored token; refresh it via the provider token endpoint when expired and
// refreshable; persist the refreshed token. Returns null when there is no stored row (not connected)
// or a refresh fails (the token is dead → reconnect needed).
registry.set('oauth2', async (ctx, deps) => {
  const provider = isOAuth2(ctx.auth) ? ctx.auth.provider : undefined
  const stored = await deps.store.get({
    connectionId: ctx.connectionId,
    integration: ctx.integration,
  })
  if (!stored) return null

  // A malformed/legacy blob is "not connected" (reconnect), not a crash — the store is the only
  // writer so this is defensive, but a hand-edited row must not throw the whole run.
  let token: OAuthToken
  try {
    token = JSON.parse(stored.secret)
  } catch {
    return null
  }
  const skewMs = 60_000
  const expired = typeof token.expiresAt === 'number' && token.expiresAt <= deps.now() + skewMs
  const client = provider
    ? atizarEnv.oauthClient(provider)
    : { clientId: undefined, clientSecret: undefined }
  const endpoint = provider ? oauthProvider(provider) : undefined

  if (expired && token.refreshToken && client.clientId && client.clientSecret && endpoint) {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    })
    const res = await deps.fetchFn(endpoint.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) return null
    const json = (await res.json()) as { access_token: string; expires_in?: number }
    const expiresAt =
      typeof json.expires_in === 'number' ? deps.now() + json.expires_in * 1000 : undefined
    // Google often omits the refresh_token on refresh — keep the existing one.
    const refreshed: OAuthToken = {
      accessToken: json.access_token,
      refreshToken: token.refreshToken,
      expiresAt,
    }
    await deps.store.upsert({
      connectionId: ctx.connectionId,
      integration: ctx.integration,
      kind: 'oauth2',
      secret: JSON.stringify(refreshed),
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    })
    return {
      kind: 'oauth2',
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt,
    }
  }

  return {
    kind: 'oauth2',
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresAt,
  }
})

// Resolve a live credential for a (integration, connection) by dispatching on the auth kind. An
// unregistered custom kind warns (a misconfig should be visible) and returns null.
export async function resolveCredential(
  ctx: ResolveCtx,
  deps: ResolveDeps = {}
): Promise<ResolvedCredential | null> {
  const resolved: Required<ResolveDeps> = {
    store: deps.store ?? makeCredentialStore(db),
    fetchFn: deps.fetchFn ?? fetch,
    now: deps.now ?? Date.now,
  }
  const resolver = registry.get(ctx.auth.kind)
  if (!resolver) {
    console.warn(`resolveCredential: no resolver registered for kind "${ctx.auth.kind}"`)
    return null
  }
  return resolver(ctx, resolved)
}
