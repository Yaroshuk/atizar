// Per-workflow tool-name const map for email-inbox. renderLead/saveDraft are named for the
// generic reply contract (one email → a drafted reply for approval); a workflow that reuses
// that contract would register the same names against its own components — each workflow owns
// its own const map (per-workflow scoping). `as const` → value IS the wire string; not a TS enum.
// Includes the READ tools (list_unread/get_email) so the descriptor's `readonly` arrays and the
// prompts route every tool name through one source — no raw literals.
export const EMAIL_INBOX_TOOLS = {
  list_unread: 'list_unread',
  get_email: 'get_email',
  route_emails: 'route_emails',
  renderSort: 'renderSort',
  renderLead: 'renderLead',
  saveDraft: 'saveDraft',
  applyActions: 'applyActions',
} as const

export type EmailInboxToolName = (typeof EMAIL_INBOX_TOOLS)[keyof typeof EMAIL_INBOX_TOOLS]
