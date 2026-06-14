// App-side declaration of which (integration, connection, provider) the loaded workflows require,
// and the OAuth scopes each integration needs. Scopes are now DERIVED from each integration's own
// `auth` declaration (auth.scopes) — no hand-written duplicate (auth sub-stage 5).
import type { ConnectionDescriptor } from '@atizar/server'
import type { WorkflowDescriptor } from '@atizar/core'
import { auth as gmailAuth } from '@atizar/integrations/gmail/auth'
import { workflowDescriptors } from '../workflows/index.js'

// The AuthSpec union's open catch-all variant ({ kind: string; [k]: unknown }) widens `scopes` to
// unknown even under the oauth2 narrowing, so read it through the oauth2 shape explicitly.
const gmailScopes = (gmailAuth as { scopes?: string[] }).scopes ?? []
const SCOPES: Record<string, string[]> = {
  gmail: gmailScopes,
}

export const scopesFor = (integration: string): string[] => SCOPES[integration] ?? []

// Derive the live connection list by unioning every loaded workflow's declared connections,
// defaulting `connection` to 'default' and deduping by (integration, connection). A stale or extra
// chip becomes impossible — the list is exactly what the loaded workflows ask for.
export function deriveConnectionList(descriptors: WorkflowDescriptor[]): ConnectionDescriptor[] {
  const byKey = new Map<string, ConnectionDescriptor>()
  for (const d of descriptors) {
    for (const c of d.connections ?? []) {
      const connection = c.connection ?? 'default'
      const key = `${c.integration}:${connection}`
      if (!byKey.has(key))
        byKey.set(key, { integration: c.integration, connection, provider: c.provider })
    }
  }
  return [...byKey.values()]
}

export const connectionList: ConnectionDescriptor[] = deriveConnectionList(workflowDescriptors)
