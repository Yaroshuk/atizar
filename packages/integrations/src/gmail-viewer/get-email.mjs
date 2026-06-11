import { parseLatestMessage, errText } from '../gmail-basic/format.mjs'
import { getGmail as defaultGetGmail } from '../gmail-basic/gmail-client.mjs'

// Pure, importable read: one email by messageId with the full decoded text body.
// The REPLY agent calls this itself — bodies never ride through the sorter model.
// Returns { messageId, threadId, from, subject, body } or { error }.
export async function getEmail({ messageId }, deps = {}) {
  const getGmail = deps.getGmail ?? defaultGetGmail
  try {
    const gmail = await getGmail()
    const full = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' })
    return { messageId, ...parseLatestMessage(full.data) }
  } catch (err) {
    return { error: errText(err) }
  }
}
