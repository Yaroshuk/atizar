// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { resolveCredential, registerResolver } from './resolveCredential.js'
import type { AuthSpec } from '@platform/core'

const fakeStore = (
  initial: Record<string, { kind: string; secret: string; expiresAt: Date | null }>
) => {
  const m = new Map(Object.entries(initial))
  const k = (c: string, i: string) => `${c}:${i}`
  return {
    saved: m,
    get: async ({ connectionId, integration }: { connectionId: string; integration: string }) =>
      m.get(k(connectionId, integration)) ?? null,
    upsert: async (a: any) =>
      void m.set(k(a.connectionId, a.integration), {
        kind: a.kind,
        secret: a.secret,
        expiresAt: a.expiresAt ?? null,
      }),
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
        secret: JSON.stringify({
          accessToken: 'at-1',
          refreshToken: 'rt-1',
          expiresAt: 9_999_999_999_000,
        }),
        expiresAt: new Date(9_999_999_999_000),
      },
    })
    const cred = await resolveCredential(
      {
        integration: 'gmail',
        connectionId: 'default',
        auth: { kind: 'oauth2', provider: 'google', scopes: [] },
      },
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
      {
        integration: 'gmail',
        connectionId: 'default',
        auth: { kind: 'oauth2', provider: 'google', scopes: [] },
      },
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
        {
          integration: 'gmail',
          connectionId: 'default',
          auth: { kind: 'oauth2', provider: 'google', scopes: [] },
        },
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
