// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectRoutes } from './connectRoutes.js'
import { signState, verifyState } from './oauthState.js'
import type { CredentialStore, UpsertArgs } from './credentialStore.js'

const saved = { ...process.env }
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
  Object.assign(process.env, saved)
})

let upserted: UpsertArgs | undefined
const makeStore = (): CredentialStore =>
  ({
    upsert: async (a: UpsertArgs) => {
      upserted = a
    },
    get: async () => null,
    remove: async () => {},
  }) as unknown as CredentialStore

beforeEach(() => {
  upserted = undefined
  process.env.ATIZAR_SECRET_KEY = 'test-secret'
  process.env.ATIZAR_GOOGLE_CLIENT_ID = 'cid'
  process.env.ATIZAR_GOOGLE_CLIENT_SECRET = 'csec'
  delete process.env.ATIZAR_PUBLIC_URL
})

const deps = (fetchFn?: typeof fetch) => ({
  store: makeStore(),
  scopesFor: (_integration: string) => ['https://www.googleapis.com/auth/gmail.modify'],
  list: [{ integration: 'gmail', connection: 'default', provider: 'google' }],
  fetchFn,
})

describe('createConnectRoutes', () => {
  describe('GET /api/connect/:provider', () => {
    it('302s to the provider auth URL with client_id, redirect_uri, scope and state', async () => {
      const app = createConnectRoutes(deps())
      const res = await app.request('/api/connect/google?integration=gmail&connection=default')
      expect(res.status).toBe(302)
      const location = res.headers.get('location')!
      expect(location).toContain('https://accounts.google.com/o/oauth2/v2/auth')
      const url = new URL(location)
      expect(url.searchParams.get('client_id')).toBe('cid')
      expect(url.searchParams.get('redirect_uri')).toBe(
        'http://localhost:5173/api/connect/google/callback'
      )
      expect(url.searchParams.get('response_type')).toBe('code')
      expect(url.searchParams.get('access_type')).toBe('offline')
      expect(url.searchParams.get('prompt')).toBe('consent')
      expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.modify')
      expect(url.searchParams.get('state')).toBeTruthy()
      const decoded = verifyState(url.searchParams.get('state')!, 'test-secret')
      expect(decoded).not.toBeNull()
      expect(decoded).toEqual({ integration: 'gmail', connection: 'default' })
    })

    it('404s for an unknown provider', async () => {
      const app = createConnectRoutes(deps())
      const res = await app.request('/api/connect/nope?integration=gmail')
      expect(res.status).toBe(404)
    })

    it('500s when the OAuth client id is not configured', async () => {
      delete process.env.ATIZAR_GOOGLE_CLIENT_ID
      const app = createConnectRoutes(deps())
      const res = await app.request('/api/connect/google?integration=gmail')
      expect(res.status).toBe(500)
    })

    it('500s when ATIZAR_SECRET_KEY is not configured', async () => {
      delete process.env.ATIZAR_SECRET_KEY
      const app = createConnectRoutes(deps())
      const res = await app.request('/api/connect/google?integration=gmail')
      expect(res.status).toBe(500)
    })
  })

  describe('GET /api/connect/:provider/callback', () => {
    it('400s on a tampered state', async () => {
      const app = createConnectRoutes(deps())
      const res = await app.request('/api/connect/google/callback?code=abc&state=abc.def')
      expect(res.status).toBe(400)
    })

    it('exchanges the code, upserts an oauth2 token blob and 302s to ?connected', async () => {
      const fetchFn = (async () =>
        new Response(
          JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }),
          { status: 200 }
        )) as unknown as typeof fetch
      const d = deps(fetchFn)
      const app = createConnectRoutes(d)
      const state = signState({ integration: 'gmail', connection: 'default' }, 'test-secret')
      const res = await app.request(
        '/api/connect/google/callback?code=abc&state=' + encodeURIComponent(state)
      )
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('http://localhost:5173/?connected=gmail')
      expect(upserted).toBeDefined()
      expect(upserted!.kind).toBe('oauth2')
      expect(upserted!.connectionId).toBe('default')
      expect(upserted!.integration).toBe('gmail')
      const blob = JSON.parse(upserted!.secret)
      expect(blob.accessToken).toBe('AT')
      expect(blob.refreshToken).toBe('RT')
      expect(typeof blob.expiresAt).toBe('number')
    })

    it('302s to ?connect_error on a non-ok token exchange', async () => {
      const fetchFn = (async () =>
        new Response('nope', { status: 400 })) as unknown as typeof fetch
      const app = createConnectRoutes(deps(fetchFn))
      const state = signState({ integration: 'gmail', connection: 'default' }, 'test-secret')
      const res = await app.request(
        '/api/connect/google/callback?code=abc&state=' + encodeURIComponent(state)
      )
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('http://localhost:5173/?connect_error=gmail')
      expect(upserted).toBeUndefined()
    })
  })

  describe('GET /api/connections', () => {
    it('reports connected:false when no row exists', async () => {
      const app = createConnectRoutes(deps())
      const res = await app.request('/api/connections')
      expect(res.status).toBe(200)
      const body = (await res.json()) as Array<{ integration: string; connected: boolean }>
      expect(body).toEqual([
        { integration: 'gmail', connection: 'default', provider: 'google', connected: false },
      ])
    })

    it('reports connected:true when a row exists', async () => {
      const store = {
        upsert: async () => {},
        get: async () => ({ secret: '{}' }),
        remove: async () => {},
      } as unknown as CredentialStore
      const app = createConnectRoutes({
        store,
        scopesFor: () => [],
        list: [{ integration: 'gmail', connection: 'default', provider: 'google' }],
      })
      const res = await app.request('/api/connections')
      expect(res.status).toBe(200)
      const body = (await res.json()) as Array<{ integration: string; connected: boolean }>
      expect(body).toEqual([
        { integration: 'gmail', connection: 'default', provider: 'google', connected: true },
      ])
    })
  })

  describe('DELETE /api/connections/:integration', () => {
    it('removes the credential and returns { ok: true }', async () => {
      let removed: { connectionId: string; integration: string } | undefined
      const store = {
        upsert: async () => {},
        get: async () => null,
        remove: async (k: { connectionId: string; integration: string }) => {
          removed = k
        },
      } as unknown as CredentialStore
      const app = createConnectRoutes({
        store,
        scopesFor: () => [],
        list: [],
      })
      const res = await app.request('/api/connections/gmail?connection=default', {
        method: 'DELETE',
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
      expect(removed).toEqual({ connectionId: 'default', integration: 'gmail' })
    })
  })
})
