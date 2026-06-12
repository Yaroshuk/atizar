// Build the Authorization header for a mutation fetch from the (optional) shared bearer token.
// No token ⇒ no header (the server is fail-open / demo-disabled in that case). The token comes
// from WorkflowsConfig.authToken — the package never reads import.meta.env.
export const authHeaders = (token?: string): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {}
