// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import { atizarEnv, isDemo } from './env.js'

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
    expect(atizarEnv.oauthClient('google')).toEqual({
      clientId: undefined,
      clientSecret: undefined,
    })
  })

  it('reads the active connection label, defaulting to "default"', () => {
    delete process.env.ATIZAR_CONNECTION
    expect(atizarEnv.connection()).toBe('default')
    process.env.ATIZAR_CONNECTION = 'home'
    expect(atizarEnv.connection()).toBe('home')
  })

  it('publicUrl defaults to http://localhost:5173 when ATIZAR_PUBLIC_URL is unset', () => {
    delete process.env.ATIZAR_PUBLIC_URL
    expect(atizarEnv.publicUrl()).toBe('http://localhost:5173')
    process.env.ATIZAR_PUBLIC_URL = 'https://app.example.com'
    expect(atizarEnv.publicUrl()).toBe('https://app.example.com')
  })

  it('databaseUrl precedence: ATIZAR_DATABASE_URL > DATABASE_URL > compose default', () => {
    delete process.env.ATIZAR_DATABASE_URL
    delete process.env.DATABASE_URL
    expect(atizarEnv.databaseUrl()).toBe(
      'postgres://aiworkflow:aiworkflow@localhost:5432/aiworkflow'
    )
    process.env.DATABASE_URL = 'postgres://x/y'
    expect(atizarEnv.databaseUrl()).toBe('postgres://x/y')
    process.env.ATIZAR_DATABASE_URL = 'postgres://a/b'
    expect(atizarEnv.databaseUrl()).toBe('postgres://a/b')
  })
})

describe('isDemo', () => {
  const prev = process.env.DEMO
  afterEach(() => {
    if (prev === undefined) delete process.env.DEMO
    else process.env.DEMO = prev
  })

  it('is true only when DEMO is exactly "1"', () => {
    process.env.DEMO = '1'
    expect(isDemo()).toBe(true)
  })

  it('is false when DEMO is unset', () => {
    delete process.env.DEMO
    expect(isDemo()).toBe(false)
  })

  it('is false for other truthy strings (avoids accidental demo in prod)', () => {
    process.env.DEMO = 'true'
    expect(isDemo()).toBe(false)
  })
})
