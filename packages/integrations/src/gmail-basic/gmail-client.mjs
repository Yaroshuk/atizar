import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { optionalPeerError } from '../optional-peer.mjs'

const keysPath =
  process.env.GMAIL_OAUTH_KEYS || join(homedir(), '.gmail-mcp', 'gcp-oauth.keys.json')
const credsPath =
  process.env.GMAIL_OAUTH_CREDENTIALS || join(homedir(), '.gmail-mcp', 'credentials.json')

async function loadGoogleapis() {
  try {
    return (await import('googleapis')).google
  } catch (err) {
    const mapped = optionalPeerError(err, { name: 'googleapis', install: 'yarn add googleapis' })
    if (mapped) throw mapped
    throw err
  }
}

let _gmail
export async function getGmail() {
  if (_gmail) return _gmail
  const google = await loadGoogleapis()
  const keys = JSON.parse(readFileSync(keysPath, 'utf8'))
  const clientData = keys.installed || keys.web
  if (!clientData)
    throw new Error('gcp-oauth.keys.json has neither "installed" nor "web" client config')
  const { client_id, client_secret, redirect_uris } = clientData
  const auth = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris?.[0] || 'http://localhost:3000/oauth2callback'
  )
  const creds = JSON.parse(readFileSync(credsPath, 'utf8'))
  auth.setCredentials(creds)
  _gmail = google.gmail({ version: 'v1', auth })
  return _gmail
}

export function errText(err) {
  return err?.response?.data?.error?.message ?? err?.message ?? String(err)
}
