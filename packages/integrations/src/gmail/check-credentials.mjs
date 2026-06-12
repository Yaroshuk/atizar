import { errText } from './format.mjs'
import { makeGmailClient } from './client.mjs'

// Health now means: does a USABLE oauth2 credential reach this integration? It does NOT read
// files — the framework resolves the credential and injects it via deps.credential. A missing
// credential makes makeGmailClient throw the clear "oauth2 credential required" error, caught
// below → { ok:false } with the Connect hint.
const HINT =
  'No usable Gmail credential. Connect Google via the Connect chip in the app header (the in-app ' +
  'OAuth flow), and make sure the oauth2 app registration is set: ATIZAR_GOOGLE_CLIENT_ID, ' +
  'ATIZAR_GOOGLE_CLIENT_SECRET, and ATIZAR_SECRET_KEY (the credential-store encryption key). ' +
  'Setup guide: packages/integrations/skills/gmail/SKILL.md ("Credentials").'

// A 1-quota-unit real ping — proves the token actually works, not just that it exists.
// The client comes from deps.gmail (tests) or is built from deps.credential (the framework).
// Returns { ok: true, detail } or { ok: false, error, hint }.
export async function checkCredentials(deps = {}) {
  try {
    const gmail = deps.gmail ?? (await makeGmailClient(deps.credential))
    const profile = await gmail.users.getProfile({ userId: 'me' })
    return { ok: true, detail: profile.data.emailAddress ?? '' }
  } catch (err) {
    return { ok: false, error: errText(err), hint: HINT }
  }
}
