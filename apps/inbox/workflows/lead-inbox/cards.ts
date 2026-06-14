// Per-workflow card-name const map (client side). The `renders` map values in the
// descriptor are component NAMES (core stays React-free); the client renderRegistry maps
// name → component. These consts keep the descriptor's render values + the client specs
// referencing one source instead of duplicated string literals.
export const LEAD_INBOX_CARDS = {
  LeadCard: 'LeadCard',
  VerdictCard: 'VerdictCard',
  ApprovalDialog: 'ApprovalDialog',
} as const

export type LeadInboxCardName = (typeof LEAD_INBOX_CARDS)[keyof typeof LEAD_INBOX_CARDS]
