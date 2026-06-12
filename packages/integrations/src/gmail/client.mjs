import { optionalPeerError } from '../optional-peer.mjs'

// Lazy-load the optional googleapis peer with a fail-fast, actionable error (the optional-peer
// pattern). Kept local so this package stays free of any eager googleapis import.
async function loadGoogleapis() {
  try {
    return (await import('googleapis')).google
  } catch (err) {
    const mapped = optionalPeerError(err, { name: 'googleapis', install: 'yarn add googleapis' })
    if (mapped) throw mapped
    throw err
  }
}

// Build a Gmail v1 client from a RESOLVED oauth2 credential (deps.credential). NO fs, NO
// process.env, NO cache (a module-level cache keyed by nothing would leak the token between
// connections). The framework resolves the credential; this just turns the token into a client.
export async function makeGmailClient(credential) {
  if (!credential || credential.kind !== 'oauth2' || !credential.accessToken) {
    throw new Error('gmail: a resolved oauth2 credential with an accessToken is required')
  }
  const google = await loadGoogleapis()
  const auth = new google.auth.OAuth2()
  auth.setCredentials({
    access_token: credential.accessToken,
    ...(credential.refreshToken ? { refresh_token: credential.refreshToken } : {}),
  })
  return google.gmail({ version: 'v1', auth })
}
