import { Hono } from 'hono'
import type { CredentialStore } from './credentialStore.js'
import { atizarEnv } from './env.js'
import { oauthProvider } from './oauthProviders.js'
import { signState, verifyState } from './oauthState.js'

// The OAuth connect flow (spec §3/§4): a browser bounce to the provider consent screen and back.
// Pure HTTP — no knowledge of integrations or workflows; the app supplies `scopesFor` (the
// integration's `auth.scopes`) and `list` (which (integration, connection, provider) tuples to
// report). The token-exchange `fetchFn` is injectable so the round-trip is unit-testable; the live
// Google round-trip is the browser E2E.

export interface ConnectionDescriptor {
  integration: string
  connection: string
  provider: string
}

export interface ConnectRoutesDeps {
  store: CredentialStore
  scopesFor: (integration: string) => string[]
  list: ConnectionDescriptor[]
  fetchFn?: typeof fetch
}

// The stored oauth2 secret blob — MUST match what resolveCredential reads (expiresAt = epoch ms).
interface OAuthToken {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
}

export function createConnectRoutes(deps: ConnectRoutesDeps): Hono {
  const app = new Hono()
  const fetchFn = deps.fetchFn ?? fetch

  // Built once so connect and callback are byte-identical (the provider matches the redirect_uri).
  const redirectUri = (provider: string): string =>
    `${atizarEnv.publicUrl()}/api/connect/${provider}/callback`

  // START — bounce to the provider consent screen.
  app.get('/api/connect/:provider', (c) => {
    const provider = c.req.param('provider')
    const endpoint = oauthProvider(provider)
    if (!endpoint) return c.json({ error: `unknown provider: ${provider}` }, 404)

    const { clientId } = atizarEnv.oauthClient(provider)
    if (!clientId)
      return c.json({ error: `OAuth client for "${provider}" is not configured` }, 500)

    const key = atizarEnv.secretKey()
    if (!key) return c.json({ error: 'ATIZAR_SECRET_KEY not configured' }, 500)

    const integration = c.req.query('integration') ?? ''
    const connection = c.req.query('connection') ?? atizarEnv.connection()

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri(provider),
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      scope: deps.scopesFor(integration).join(' '),
      state: signState({ integration, connection }, key),
    })
    return c.redirect(`${endpoint.authUrl}?${params}`)
  })

  // CALLBACK — verify the signed state, exchange the code for tokens, persist, bounce home.
  app.get('/api/connect/:provider/callback', async (c) => {
    const provider = c.req.param('provider')
    const endpoint = oauthProvider(provider)
    if (!endpoint) return c.json({ error: `unknown provider: ${provider}` }, 404)

    const key = atizarEnv.secretKey()
    if (!key) return c.json({ error: 'ATIZAR_SECRET_KEY not configured' }, 500)

    const code = c.req.query('code') ?? ''
    const rawState = c.req.query('state') ?? ''
    const state = verifyState(rawState, key)
    if (!state) return c.json({ error: 'bad state' }, 400)

    const { clientId, clientSecret } = atizarEnv.oauthClient(provider)
    const publicUrl = atizarEnv.publicUrl()

    const res = await fetchFn(endpoint.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId ?? '',
        client_secret: clientSecret ?? '',
        redirect_uri: redirectUri(provider),
      }),
    })
    if (!res.ok) return c.redirect(`${publicUrl}/?connect_error=${state.integration}`)

    const json = (await res.json()) as {
      access_token: string
      refresh_token?: string
      expires_in?: number
    }
    const expiresAt =
      typeof json.expires_in === 'number' ? Date.now() + json.expires_in * 1000 : undefined
    const token: OAuthToken = {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt,
    }
    await deps.store.upsert({
      connectionId: state.connection,
      integration: state.integration,
      kind: 'oauth2',
      secret: JSON.stringify(token),
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    })
    return c.redirect(`${publicUrl}/?connected=${state.integration}`)
  })

  // STATUS — connected = a stored row exists for each reported (connection, integration).
  app.get('/api/connections', async (c) => {
    const rows = await Promise.all(
      deps.list.map(async (d) => ({
        integration: d.integration,
        connection: d.connection,
        provider: d.provider,
        connected: !!(await deps.store.get({
          connectionId: d.connection,
          integration: d.integration,
        })),
      }))
    )
    return c.json(rows)
  })

  // DISCONNECT — drop the stored credential.
  app.delete('/api/connections/:integration', async (c) => {
    const integration = c.req.param('integration')
    const connection = c.req.query('connection') ?? atizarEnv.connection()
    await deps.store.remove({ connectionId: connection, integration })
    return c.json({ ok: true })
  })

  return app
}
