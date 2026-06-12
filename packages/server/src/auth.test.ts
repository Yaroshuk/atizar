// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createAuthMiddleware } from './auth.js'

// Mount the middleware on a tiny app with one GET and one POST route, then probe it.
const makeApp = (opts: { token: string | undefined; demo: boolean }) => {
  const app = new Hono()
  app.use('*', createAuthMiddleware(opts))
  app.get('/api/board', (c) => c.json({ ok: true }))
  app.post('/api/dispatch', (c) => c.json({ id: 'x' }))
  app.delete('/api/connections/:i', (c) => c.json({ ok: true }))
  app.put('/api/items/:i', (c) => c.json({ ok: true }))
  return app
}
const bearer = (t: string) => ({ headers: { Authorization: `Bearer ${t}` } })

describe('createAuthMiddleware', () => {
  it('passes all requests in demo mode even with a token set', async () => {
    const app = makeApp({ token: 'sek', demo: true })
    expect((await app.request('/api/dispatch', { method: 'POST' })).status).toBe(200)
  })

  it('passes all requests when no token is configured (fail-open)', async () => {
    const app = makeApp({ token: undefined, demo: false })
    expect((await app.request('/api/dispatch', { method: 'POST' })).status).toBe(200)
  })

  describe('active (token set, not demo)', () => {
    const app = makeApp({ token: 'sek', demo: false })

    it('lets GET through with no header', async () => {
      expect((await app.request('/api/board')).status).toBe(200)
    })

    it('401s a POST with no Authorization header', async () => {
      expect((await app.request('/api/dispatch', { method: 'POST' })).status).toBe(401)
    })

    it('401s a POST with a wrong token', async () => {
      const res = await app.request('/api/dispatch', { method: 'POST', ...bearer('nope') })
      expect(res.status).toBe(401)
    })

    it('passes a POST with the correct token', async () => {
      const res = await app.request('/api/dispatch', { method: 'POST', ...bearer('sek') })
      expect(res.status).toBe(200)
    })

    it('401s a DELETE with a wrong token and passes with the right one', async () => {
      expect((await app.request('/api/connections/gmail', { method: 'DELETE' })).status).toBe(401)
      const ok = await app.request('/api/connections/gmail', { method: 'DELETE', ...bearer('sek') })
      expect(ok.status).toBe(200)
    })

    it('401s a POST with "Bearer " prefix but no value', async () => {
      const res = await app.request('/api/dispatch', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' },
      })
      expect(res.status).toBe(401)
    })

    it('passes a POST with a lowercase authorization header', async () => {
      const res = await app.request('/api/dispatch', {
        method: 'POST',
        headers: { authorization: 'Bearer sek' },
      })
      expect(res.status).toBe(200)
    })

    it('401s a PUT with no header', async () => {
      expect((await app.request('/api/items/1', { method: 'PUT' })).status).toBe(401)
    })
  })
})
