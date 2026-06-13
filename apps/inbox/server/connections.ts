// App-side declaration of which (integration, connection, provider) the loaded workflows require,
// and the OAuth scopes each integration needs. Scopes are now DERIVED from each integration's own
// `auth` declaration (auth.scopes) — no hand-written duplicate (auth sub-stage 5).
import type { ConnectionDescriptor } from '@atizar/server'
import { auth as gmailAuth } from '@atizar/integrations/gmail/auth'

// The AuthSpec union's open catch-all variant ({ kind: string; [k]: unknown }) widens `scopes` to
// unknown even under the oauth2 narrowing, so read it through the oauth2 shape explicitly.
const gmailScopes = (gmailAuth as { scopes?: string[] }).scopes ?? []
const SCOPES: Record<string, string[]> = {
  gmail: gmailScopes,
}

export const scopesFor = (integration: string): string[] => SCOPES[integration] ?? []

export const connectionList: ConnectionDescriptor[] = [
  { integration: 'gmail', connection: 'default', provider: 'google' },
]
