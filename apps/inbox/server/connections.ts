// App-side declaration of which (integration, connection, provider) the loaded workflows require,
// and the OAuth scopes each integration needs. Sub-stage 5 replaces this hand-written list with the
// integrations' own `auth` declarations (auth.scopes); for now gmail still reads files, so we
// declare its connection requirement here to make the connect flow testable end-to-end.
import type { ConnectionDescriptor } from '@platform/server'

const SCOPES: Record<string, string[]> = {
  gmail: ['https://www.googleapis.com/auth/gmail.modify'],
}

export const scopesFor = (integration: string): string[] => SCOPES[integration] ?? []

export const connectionList: ConnectionDescriptor[] = [
  { integration: 'gmail', connection: 'default', provider: 'google' },
]
