import { parseEmailMeta, errText } from './format.mjs'
import { makeGmailClient } from './client.mjs'

// Hard cap on returned emails — bounds the sorter's payload (the email-inbox spec
// keeps bodies out; metadata for 25 emails is small).
const MAX_RESULTS = 25

// Pure, importable read: unread inbox emails from the last `sinceHours` (default 24),
// metadata + snippet only — NO bodies (the consumer fetches a body via getEmail).
// Gmail search has day granularity only, so hours round UP to whole days.
// The client comes from deps.gmail (tests) or is built from deps.credential (the framework).
// Returns { emails: EmailRef[] } or { error }.
export async function listUnread({ sinceHours = 24 } = {}, deps = {}) {
  try {
    const gmail = deps.gmail ?? (await makeGmailClient(deps.credential))
    const days = Math.max(1, Math.ceil(sinceHours / 24))
    const q = `in:inbox is:unread newer_than:${days}d`
    const list = await gmail.users.messages.list({ userId: 'me', q, maxResults: MAX_RESULTS })
    const emails = []
    for (const m of list.data.messages ?? []) {
      const meta = await gmail.users.messages.get({
        userId: 'me',
        id: m.id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      })
      emails.push(parseEmailMeta(meta.data))
    }
    return { emails }
  } catch (err) {
    return { error: errText(err) }
  }
}
