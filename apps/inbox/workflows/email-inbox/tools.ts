// Per-workflow tool-name const map for email-inbox. renderLead/saveDraft repeat the
// lead-inbox names on purpose (the same reply contract reused across workflows); each
// workflow owns its own const map (per-workflow scoping). `as const` → value IS the wire
// string; not a TS enum.
export const EMAIL_INBOX_TOOLS = {
  route_emails: 'route_emails',
  renderSort: 'renderSort',
  renderLead: 'renderLead',
  saveDraft: 'saveDraft',
  applyActions: 'applyActions',
} as const

export type EmailInboxToolName = (typeof EMAIL_INBOX_TOOLS)[keyof typeof EMAIL_INBOX_TOOLS]
