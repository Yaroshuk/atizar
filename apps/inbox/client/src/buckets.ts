// The triage ticket shape the TriageCard renders (the model couriers this from
// list_my_tickets through render_triage; see github-tools.mjs). Mirrors
// TicketHandoffPayload minus `recommendation` being optional at render time.
export type TriageTicket = {
  repo: string
  number: number
  title: string
  status: string
  priority: string
  body: string
  url: string
  lastComment: { author: string; body: string } | null
  needsReply: boolean
  recommendation: string
}

export type TicketGroup = { status: string; tickets: TriageTicket[] }

// Board Status order (matches the Magma board's single-select options). Unknown
// statuses sort after all known ones, in first-seen order.
const STATUS_ORDER = [
  'Backlog',
  'Todo',
  'In progress',
  'On pluto',
  'Ready for mars',
  'On mars',
  'Ready for venus',
  'On venus',
  'Ready for prod',
  'Verify on prod',
  'Done',
]

export function groupByStatus(tickets: TriageTicket[]): TicketGroup[] {
  const byStatus = new Map<string, TriageTicket[]>()
  for (const ticket of tickets) {
    const list = byStatus.get(ticket.status) ?? []
    list.push(ticket)
    byStatus.set(ticket.status, list)
  }
  const rank = (s: string) => {
    const i = STATUS_ORDER.indexOf(s)
    return i === -1 ? STATUS_ORDER.length : i
  }
  return [...byStatus.entries()]
    .map(([status, list]) => ({ status, tickets: list }))
    .sort((a, b) => rank(a.status) - rank(b.status))
}
