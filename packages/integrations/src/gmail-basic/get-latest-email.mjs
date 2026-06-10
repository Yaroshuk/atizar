import { parseLatestMessage, errText } from './format.mjs'
import { getGmail as defaultGetGmail } from './gmail-client.mjs'

// Pure, importable read: fetch the most-recent inbox email and return parsed fields.
// `getGmail` is injectable so the server imports this directly (no MCP child) and tests pass a
// fake client. Returns { threadId, from, subject, body } or { error }.
export async function getLatestEmail(deps = {}) {
  const getGmail = deps.getGmail ?? defaultGetGmail
  try {
    const gmail = await getGmail()
    const list = await gmail.users.messages.list({ userId: 'me', q: 'in:inbox', maxResults: 1 })
    if (!list.data.messages?.length) return { error: 'No emails found in inbox.' }
    const full = await gmail.users.messages.get({
      userId: 'me',
      id: list.data.messages[0].id,
      format: 'full',
    })
    return parseLatestMessage(full.data)
  } catch (err) {
    return { error: errText(err) }
  }
}
