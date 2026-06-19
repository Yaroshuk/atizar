// Per-browser tenant key for multi-tenant demo isolation. The server scopes the board (and the
// global cancel/reset ops) by the X-Atizar-Session header; this module supplies it. ENABLED ONLY in
// demo mode — the app calls setSessionEnabled(config.demo) after /api/config resolves. When disabled
// (non-demo / single operator) no header is sent, so the server uses 'global' (shared, unchanged).
const KEY = 'atizar-session'

let enabled = false
let id: string | null = null

export function setSessionEnabled(on: boolean): void {
  enabled = on
  if (on && !id) {
    try {
      id = localStorage.getItem(KEY)
      if (!id) {
        id = crypto.randomUUID()
        localStorage.setItem(KEY, id)
      }
    } catch {
      // private mode / storage blocked → an ephemeral per-load id (still isolates this tab)
      id = crypto.randomUUID()
    }
  }
}

// The header to attach to every enumerate/mutate request, or {} when disabled.
export function sessionHeaders(): Record<string, string> {
  return enabled && id ? { 'X-Atizar-Session': id } : {}
}
