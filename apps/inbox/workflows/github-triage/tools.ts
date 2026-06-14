// Per-workflow tool-name const map for github-triage. Includes the readonly read tools
// (list_my_tickets / get_ticket) so every literal in the descriptor flows through a const.
// `as const` → value IS the wire string; not a TS enum.
export const GITHUB_TRIAGE_TOOLS = {
  list_my_tickets: 'list_my_tickets',
  get_ticket: 'get_ticket',
  render_triage: 'render_triage',
  render_ticket_result: 'render_ticket_result',
  render_reply_draft: 'render_reply_draft',
} as const

export type GithubTriageToolName = (typeof GITHUB_TRIAGE_TOOLS)[keyof typeof GITHUB_TRIAGE_TOOLS]
