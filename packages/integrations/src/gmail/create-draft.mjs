import { buildReplyRaw, errText } from './format.mjs'
import { makeGmailClient } from './client.mjs'

// Pure, importable effect: create a Gmail DRAFT reply for a thread. NEVER sends.
// The client comes from deps.gmail (tests) or is built from deps.credential (the framework),
// so the server imports this directly (no MCP child). Returns { ok:true, draftId } or { error }.
export async function createDraft({ threadId, body }, deps = {}) {
  try {
    const gmail = deps.gmail ?? (await makeGmailClient(deps.credential))
    const thread = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject'],
    })
    const messages = thread.data.messages ?? []
    const lastMsg = messages[messages.length - 1]
    const headers = lastMsg?.payload?.headers ?? []
    const findHeader = (name) => {
      const lower = name.toLowerCase()
      return headers.find((h) => h.name.toLowerCase() === lower)?.value ?? ''
    }
    const to = findHeader('From')
    const subject = findHeader('Subject')
    if (!to) return { error: 'Could not derive a recipient from the thread (no From header).' }

    const raw = buildReplyRaw({ to, subject, body, threadId })
    const draft = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw, threadId } },
    })
    return { ok: true, draftId: draft.data.id }
  } catch (err) {
    return { error: errText(err) }
  }
}
