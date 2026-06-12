import type { MiddlewareHandler } from 'hono'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Gate mutating requests behind a shared bearer token. Active ONLY when a token is configured
// AND not in demo mode; otherwise every request passes (fail-open — see spec §2). GET/HEAD/
// OPTIONS (board, trace, SSE, health, config, gate-read) always pass: gating on the HTTP method
// covers all current mutating routes and auto-protects any future one.
export function createAuthMiddleware(opts: {
  token: string | undefined
  demo: boolean
}): MiddlewareHandler {
  const active = !opts.demo && !!opts.token
  return async (c, next) => {
    if (!active || !MUTATING.has(c.req.method)) return next()
    const header = c.req.header('Authorization') ?? ''
    const presented = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (presented !== opts.token) return c.json({ error: 'unauthorized' }, 401)
    return next()
  }
}
