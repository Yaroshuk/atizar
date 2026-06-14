// Per-workflow card-name const map for email-inbox.
export const EMAIL_INBOX_CARDS = {
  SortSummaryCard: 'SortSummaryCard',
  LeadCard: 'LeadCard',
  ApprovalDialog: 'ApprovalDialog',
  EmailBatchCard: 'EmailBatchCard',
} as const

export type EmailInboxCardName = (typeof EMAIL_INBOX_CARDS)[keyof typeof EMAIL_INBOX_CARDS]
