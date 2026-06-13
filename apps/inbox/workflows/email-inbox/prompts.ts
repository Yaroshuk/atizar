import type { RunAgentInput } from '@ag-ui/client'
import { decodeHandoff, type PromptStrategy } from '@atizar/core'
import { ReplyPayloadSchema, EmailBatchSchema } from './descriptor.js'

// ── SORTER ─────────────────────────────────────────────────────────────────
// The input agent, started empty. It reads the unread inbox, then MACHINE-DISPATCHES
// children via route_emails (one call per destination group), then surfaces a summary.
function sorterFirst(instructions: string): string {
  return [
    instructions,
    '',
    'Call list_unread to read the unread inbox of the last 24 hours (it returns',
    '{ emails: [{ messageId, threadId, from, subject, date, snippet }] }). Decide a',
    'destination for EACH email:',
    '- needs a personal reply  → reply',
    '- informational / newsletters / receipts → reader',
    '- suspected spam → spam',
    '- important but no reply needed → important',
    'Then dispatch with route_emails:',
    '- for EACH email that needs a reply, call route_emails once with',
    '  { to: "reply", email: <the full email object> }.',
    '- for the reader / spam / important groups, call route_emails ONCE per group with',
    '  { to: "reader"|"spam"|"important", emails: [<the email objects in that group>] }.',
    '  Omit a group entirely if it is empty.',
    'Finally call renderSort with { summary, counts } — summary is one short sentence,',
    'counts is { reply, reader, spam, important } with the number routed to each.',
    'Do not narrate your tool usage or mention tools/schemas — keep any text brief and',
    'user-facing.',
  ].join('\n')
}

// The sorter dispatches via route_emails (not a render-tool handoff), so it has no `origin`
// to weave into a render — the param is omitted (unlike the lead-inbox qualifier prompts).
export function createSorterPrompts(instructions: string): PromptStrategy {
  return {
    buildFirst(): string {
      return sorterFirst(instructions)
    },
    // No buildResume: the sorter has no approvals, so it never resumes.
  }
}

// ── REPLY ──────────────────────────────────────────────────────────────────
function replyNoEmail(instructions: string): string {
  return [
    instructions,
    '',
    'No email was handed off to you. You do not read the inbox — the Email Sorter does.',
    'Reply with ONE short sentence telling the user to start from the Email Sorter. Do',
    'not call any tool and do not narrate tool usage.',
  ].join('\n')
}

function replyFirst(
  instructions: string,
  email: { messageId: string; threadId: string; from: string; subject: string }
): string {
  return [
    instructions,
    '',
    `You were handed one email that needs a reply — from ${email.from}, subject`,
    `"${email.subject}".`,
    'Take exactly these tool actions, in order:',
    `1. Call get_email with { messageId: "${email.messageId}" } to read the full body.`,
    '2. Call renderLead with { from, subject, summary } to surface it (summary = one',
    '   sentence on what the email asks for).',
    `3. Call saveDraft with { threadId: "${email.threadId}", body } — body is the full,`,
    '   short, businesslike reply you drafted.',
    'Calling saveDraft IS how you ask the human to approve — it is MANDATORY. Do NOT write',
    'the reply text in your message, do NOT ask "should I save this?" in prose, and do NOT',
    'end your turn without calling saveDraft. Do NOT create the draft yourself and do NOT',
    'send anything — saveDraft only proposes a draft for approval. Do not narrate your',
    'tool usage or mention tools/schemas — keep any message text to one short sentence.',
  ].join('\n')
}

function replyResume(instructions: string, draftId: string): string {
  return [
    instructions,
    '',
    'The human APPROVED the reply and the SERVER has ALREADY created the Gmail draft',
    `(draft id "${draftId}"). You do NOT create or send anything — it is done.`,
    'Reply with ONE short sentence confirming the draft was saved. Do not call any tool',
    'and do not narrate tool usage.',
  ].join('\n')
}

export function createReplyPrompts(instructions: string): PromptStrategy {
  return {
    buildFirst(input: RunAgentInput): string {
      const payload = decodeHandoff(input, ReplyPayloadSchema)
      return payload ? replyFirst(instructions, payload.email) : replyNoEmail(instructions)
    },
    buildResume(
      _args: Record<string, unknown>,
      executedResult?: Record<string, unknown>
    ): string | null {
      const draftId = typeof executedResult?.draftId === 'string' ? executedResult.draftId : 'saved'
      return replyResume(instructions, draftId)
    },
  }
}

// ── BATCH (reader / spam / important) ────────────────────────────────────────
type DefaultAction = 'read' | 'trash' | 'star'

function batchNoEmails(instructions: string): string {
  return [
    instructions,
    '',
    'No batch of emails was handed off to you. You do not read the inbox — the Email',
    'Sorter does. Reply with ONE short sentence telling the user to start from the Email',
    'Sorter. Do not call any tool and do not narrate tool usage.',
  ].join('\n')
}

function batchFirst(
  instructions: string,
  def: DefaultAction,
  emails: { messageId: string; from: string; subject: string }[]
): string {
  const rows = emails
    .map(
      (e) =>
        `  { messageId: "${e.messageId}", from: "${e.from}", subject: "${e.subject}", action: "${def}" }`
    )
    .join(',\n')
  return [
    instructions,
    '',
    `You were handed a batch of ${emails.length} email(s). The default action for this`,
    `group is "${def}". Call applyActions ONCE with { items: [...] } — one row per email,`,
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

function batchResume(instructions: string, executedResult?: Record<string, unknown>): string {
  const applied = typeof executedResult?.applied === 'number' ? executedResult.applied : 0
  const failedArr = Array.isArray(executedResult?.failed) ? executedResult.failed : []
  return [
    instructions,
    '',
    'The human APPROVED and the SERVER has ALREADY applied the actions',
    `(${applied} applied, ${failedArr.length} failed). You do NOT perform anything — it is done.`,
    'Reply with ONE short sentence confirming the result. Do not call any tool and do not',
    'narrate tool usage.',
  ].join('\n')
}

export function createBatchPrompts(instructions: string, def: DefaultAction): PromptStrategy {
  return {
    buildFirst(input: RunAgentInput): string {
      const payload = decodeHandoff(input, EmailBatchSchema)
      return payload ? batchFirst(instructions, def, payload.emails) : batchNoEmails(instructions)
    },
    buildResume(
      _args: Record<string, unknown>,
      executedResult?: Record<string, unknown>
    ): string | null {
      return batchResume(instructions, executedResult)
    },
  }
}
