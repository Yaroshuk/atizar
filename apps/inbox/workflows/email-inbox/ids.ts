// Per-workflow wire-id consts for email-inbox. `as const` → each value IS the wire string
// (config-as-data, I7); never a TS enum. The client scopes its render/HITL specs with
// EMAIL_INBOX_ID and the descriptor stamps its id/handoffs/roles from these maps.
export const EMAIL_INBOX_ID = 'email-inbox' as const

export const EMAIL_INBOX_AGENTS = {
  sorter: 'sorter',
  reply: 'reply',
  reader: 'reader',
  spam: 'spam',
  important: 'important',
} as const
export type EmailInboxAgentId = (typeof EMAIL_INBOX_AGENTS)[keyof typeof EMAIL_INBOX_AGENTS]

export const ROLES = { input: 'input', worker: 'worker' } as const
