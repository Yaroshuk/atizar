import { definePrompt } from '@atizar/core'
import type { ResumeOutcome } from '@atizar/core'
import { EMAIL_INBOX_TOOLS as t } from './tools.js'
import { ReplyPayloadSchema, EmailBatchSchema, type EmailRef } from './contracts.js'

// Each agent's PromptStrategy is built with definePrompt: a flat, TURN-ONLY block. The agent's
// identity (defineAgent.instructions composed with the workflow prompt) is PREPENDED by the
// provider — never repeated here. Every tool a prompt mentions is routed through the EMAIL_INBOX_TOOLS
// consts as `Call ${t.x}`, so the drift guard can verify no raw tool literal leaked in.

// ── SORTER ─────────────────────────────────────────────────────────────────
// The input agent, started empty. It reads the unread inbox, MACHINE-DISPATCHES children via
// route_emails (one call per destination group), then surfaces a summary. No approvals → no resume.
export const sorterPrompt = definePrompt({
  onStart: () =>
    [
      `Call ${t.list_unread} to read the unread inbox of the last 24 hours (it returns`,
      '{ emails: [{ messageId, threadId, from, subject, date, snippet }] }). Decide a',
      'destination for EACH email:',
      '- needs a personal reply  → reply',
      '- informational / newsletters / receipts → reader',
      '- suspected spam → spam',
      '- important but no reply needed → important',
      `Then dispatch with ${t.route_emails}:`,
      `- for EACH email that needs a reply, call ${t.route_emails} once with`,
      '  { to: "reply", email: <the full email object> }.',
      `- for the reader / spam / important groups, call ${t.route_emails} ONCE per group with`,
      '  { to: "reader"|"spam"|"important", emails: [<the email objects in that group>] }.',
      '  Omit a group entirely if it is empty.',
      `Finally call ${t.renderSort} with { summary } — summary is one short sentence describing what`,
      'you sorted. Do NOT compute or report counts; the app derives the numbers from the dispatches.',
      'Do not narrate your tool usage or mention tools/schemas — keep any text brief and',
      'user-facing.',
    ].join('\n'),
})

// ── REPLY ──────────────────────────────────────────────────────────────────
const replyOnInput = (email: EmailRef): string =>
  [
    `You were handed one email that needs a reply — from ${email.from}, subject`,
    `"${email.subject}".`,
    'Take exactly these tool actions, in order:',
    `1. Call ${t.get_email} with { messageId: "${email.messageId}" } to read the full body.`,
    `2. Call ${t.renderLead} with { from, subject, summary } to surface it (summary = one`,
    '   sentence on what the email asks for).',
    `3. Call ${t.saveDraft} with { threadId: "${email.threadId}", body } — body is the full,`,
    '   short, businesslike reply you drafted.',
    `Calling ${t.saveDraft} IS how you ask the human to approve — it is MANDATORY. Do NOT write`,
    'the reply text in your message, do NOT ask "should I save this?" in prose, and do NOT',
    `end your turn without calling ${t.saveDraft}. Do NOT create the draft yourself and do NOT`,
    `send anything — ${t.saveDraft} only proposes a draft for approval. Do not narrate your`,
    'tool usage or mention tools/schemas — keep any message text to one short sentence.',
  ].join('\n')

const replyOnStart = (): string =>
  [
    'No email was handed off to you. You do not read the inbox — the Email Sorter does.',
    'Reply with ONE short sentence telling the user to start from the Email Sorter. Do',
    'not call any tool and do not narrate tool usage.',
  ].join('\n')

const replyOnResume = (result: Record<string, unknown>): ResumeOutcome => {
  const draftId = typeof result.draftId === 'string' ? result.draftId : 'saved'
  const text = [
    'The human APPROVED the reply and the SERVER has ALREADY created the Gmail draft',
    `(draft id "${draftId}"). You do NOT create or send anything — it is done.`,
    'Reply with ONE short sentence confirming the draft was saved. Do not call any tool',
    'and do not narrate tool usage.',
  ].join('\n')
  return { kind: 'prompt', text }
}

export const replyPrompt = definePrompt({
  input: ReplyPayloadSchema,
  onInput: (payload) => replyOnInput(payload.email),
  onStart: replyOnStart,
  onResume: replyOnResume,
})

// ── BATCH (reader / spam / important) ────────────────────────────────────────
// reader / spam / important share ONE strategy shape; only the proposed default action differs.
// batchPrompt is the single reuse point — no per-agent copies.
type DefaultAction = 'read' | 'trash' | 'star'

const batchOnInput = (def: DefaultAction, emails: EmailRef[]): string => {
  const rows = emails
    .map(
      (e) =>
        `  { messageId: "${e.messageId}", from: "${e.from}", subject: "${e.subject}", action: "${def}" }`
    )
    .join(',\n')
  return [
    `You were handed a batch of ${emails.length} email(s). The default action for this`,
    `group is "${def}". Call ${t.applyActions} ONCE with { items: [...] } — one row per email,`,
    `each row { messageId, from, subject, action } with action defaulted to "${def}".`,
    'You may set a different action (read / trash / star / keep) for a row if it clearly',
    'warrants it. This asks the human to review and apply — the human may change any row.',
    'A suggested first cut for the items array:',
    '[',
    rows,
    ']',
    'Do not perform any action yourself and do not narrate tool usage — keep any text',
    'brief and user-facing.',
  ].join('\n')
}

const batchOnStart = (): string =>
  [
    'No batch of emails was handed off to you. You do not read the inbox — the Email',
    'Sorter does. Reply with ONE short sentence telling the user to start from the Email',
    'Sorter. Do not call any tool and do not narrate tool usage.',
  ].join('\n')

const batchOnResume = (result: Record<string, unknown>): ResumeOutcome => {
  const applied = typeof result.applied === 'number' ? result.applied : 0
  const failedArr = Array.isArray(result.failed) ? result.failed : []
  const text = [
    'The human APPROVED and the SERVER has ALREADY applied the actions',
    `(${applied} applied, ${failedArr.length} failed). You do NOT perform anything — it is done.`,
    'Reply with ONE short sentence confirming the result. Do not call any tool and do not',
    'narrate tool usage.',
  ].join('\n')
  return { kind: 'prompt', text }
}

const batchPrompt = (def: DefaultAction) =>
  definePrompt({
    input: EmailBatchSchema,
    onInput: (payload) => batchOnInput(def, payload.emails),
    onStart: batchOnStart,
    onResume: batchOnResume,
  })

export const readerPrompt = batchPrompt('read')
export const spamPrompt = batchPrompt('trash')
export const importantPrompt = batchPrompt('star')
