import { parseLatestMessage, errText } from './format.mjs'
import { makeGmailClient } from './client.mjs'

// Pure, importable read: one email by messageId with the full decoded text body.
// The REPLY agent calls this itself — bodies never ride through the sorter model.
// The client comes from deps.gmail (tests) or is built from deps.credential (the framework).
// Returns { messageId, threadId, from, subject, body } or { error }.
export async function getEmail({ messageId }, deps = {}) {
  try {
    const gmail = deps.gmail ?? (await makeGmailClient(deps.credential))
    const full = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' })
    return { messageId, ...parseLatestMessage(full.data) }
  } catch (err) {
    return { error: errText(err) }
  }
}
