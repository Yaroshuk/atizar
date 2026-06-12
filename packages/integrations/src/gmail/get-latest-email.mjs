import { parseLatestMessage, errText } from './format.mjs'
import { makeGmailClient } from './client.mjs'

// Pure, importable read: fetch the most-recent inbox email and return parsed fields.
// (lead-inbox's qualifier consumes this as get_latest_email.) The client comes from
// deps.gmail (tests) or is built from deps.credential (the framework).
// Returns { threadId, from, subject, body } or { error }.
export async function getLatestEmail(args, deps = {}) {
  try {
    const gmail = deps.gmail ?? (await makeGmailClient(deps.credential))
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
