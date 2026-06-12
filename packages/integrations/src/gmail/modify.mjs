import { errText } from './format.mjs'
import { makeGmailClient } from './client.mjs'

// Best-effort batch mutations (the email-inbox spec §4): one bad row must not abort
// the rest — per-row failures are collected so the gate effect can report a summary.
// A wholesale failure (client unavailable) returns { error }. The client comes from
// deps.gmail (tests) or is built from deps.credential (the framework).
async function perMessage(messageIds, deps, action) {
  let gmail
  try {
    gmail = deps.gmail ?? (await makeGmailClient(deps.credential))
  } catch (err) {
    return { error: errText(err) }
  }
  const done = []
  const failed = []
  for (const messageId of messageIds) {
    try {
      await action(gmail, messageId)
      done.push(messageId)
    } catch (err) {
      failed.push({ messageId, error: errText(err) })
    }
  }
  return { done, failed }
}

// Remove the UNREAD label (mark as read).
export async function markRead({ messageIds }, deps = {}) {
  return perMessage(messageIds, deps, (gmail, id) =>
    gmail.users.messages.modify({ userId: 'me', id, requestBody: { removeLabelIds: ['UNREAD'] } })
  )
}

// Move to trash (reversible in Gmail for ~30 days — NOT a permanent delete).
export async function trash({ messageIds }, deps = {}) {
  return perMessage(messageIds, deps, (gmail, id) =>
    gmail.users.messages.trash({ userId: 'me', id })
  )
}

// Add the STARRED label.
export async function star({ messageIds }, deps = {}) {
  return perMessage(messageIds, deps, (gmail, id) =>
    gmail.users.messages.modify({ userId: 'me', id, requestBody: { addLabelIds: ['STARRED'] } })
  )
}
