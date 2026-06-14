// Per-workflow card-name const map for github-triage.
export const GITHUB_TRIAGE_CARDS = {
  TriageCard: 'TriageCard',
  TicketResultCard: 'TicketResultCard',
  ReplyDraftCard: 'ReplyDraftCard',
} as const

export type GithubTriageCardName = (typeof GITHUB_TRIAGE_CARDS)[keyof typeof GITHUB_TRIAGE_CARDS]
