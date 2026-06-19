import { sessionHeaders } from './session.js'

// Headers for an enumerate/mutate fetch: the optional shared bearer token (from
// WorkflowsConfig.authToken — the package never reads import.meta.env) AND the per-browser tenant
// key (X-Atizar-Session, demo isolation). No token ⇒ no Authorization (server fail-open / demo);
// session disabled ⇒ no tenant header (server uses 'global').
export const authHeaders = (token?: string): Record<string, string> => ({
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
  ...sessionHeaders(),
})
