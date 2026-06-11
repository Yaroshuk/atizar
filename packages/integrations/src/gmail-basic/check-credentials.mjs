import { errText } from './format.mjs'
import { getGmail as defaultGetGmail } from './gmail-client.mjs'

const HINT =
  'Gmail OAuth credentials are missing or expired. Keys are read from ' +
  '~/.gmail-mcp/gcp-oauth.keys.json + credentials.json (override via GMAIL_OAUTH_KEYS / ' +
  'GMAIL_OAUTH_CREDENTIALS). Setup guide: packages/integrations/skills/gmail-viewer/SKILL.md ' +
  '("Credentials").'

// Health check shared by gmail-basic and gmail-viewer (same OAuth client + account).
// A 1-quota-unit real ping — proves the token actually works, not just that files exist.
// Returns { ok: true, detail } or { ok: false, error, hint }.
export async function checkCredentials(deps = {}) {
  const getGmail = deps.getGmail ?? defaultGetGmail
  try {
    const gmail = await getGmail()
    const profile = await gmail.users.getProfile({ userId: 'me' })
    return { ok: true, detail: profile.data.emailAddress ?? '' }
  } catch (err) {
    return { ok: false, error: errText(err), hint: HINT }
  }
}
