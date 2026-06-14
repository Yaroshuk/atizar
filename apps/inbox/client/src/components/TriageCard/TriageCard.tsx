import { CardShell, Button } from '@atizar/react'
import { groupByStatus, type TriageTicket } from '../../buckets'
import s from './TriageCard.module.scss'

type Route = 'feature' | 'bugfix' | 'reply-draft'

type TriageCardProps = {
  tickets: TriageTicket[]
  onRoute: (target: Route, ticket: TriageTicket) => void
  onTreatAsLead?: (t: TriageTicket) => void
}

const RECO_TO_ROUTE: Record<string, Route> = {
  feature: 'feature',
  bugfix: 'bugfix',
  bug: 'bugfix',
  reply: 'reply-draft',
}

// Triage already decided the route, so we show ONE primary action for it (not all three).
const ROUTE_LABEL: Record<Route, string> = {
  feature: 'Send to Feature',
  bugfix: 'Send to Bug-fix',
  'reply-draft': 'Draft reply',
}

export const TriageCard = ({ tickets, onRoute, onTreatAsLead }: TriageCardProps) => {
  const groups = groupByStatus(tickets)
  return (
    <CardShell icon='git' kicker={`Your tickets · ${tickets.length}`}>
      {groups.map((group) => (
        <div key={group.status} className={s.group}>
          <div className={s.groupLabel}>{group.status}</div>
          {group.tickets.map((ticket) => {
            const suggested = RECO_TO_ROUTE[ticket.recommendation] ?? 'feature'
            return (
              <div key={`${ticket.repo}#${ticket.number}`} className={s.ticket}>
                <div className={s.ticketTitle}>
                  <span>
                    #{ticket.number} {ticket.title}
                  </span>
                  {ticket.needsReply && <span className='pill amber'>needs reply</span>}
                </div>
                <div className={s.ticketActions}>
                  <Button variant='primary' onClick={() => onRoute(suggested, ticket)}>
                    {ROUTE_LABEL[suggested]}
                  </Button>
                  <a
                    className={s.link}
                    href={ticket.url}
                    target='_blank'
                    rel='noreferrer'
                    onClick={(e) => e.stopPropagation()}
                  >
                    Open in browser
                  </a>
                  {onTreatAsLead && (
                    <Button variant='ghost' onClick={() => onTreatAsLead(ticket)}>
                      Treat as lead
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </CardShell>
  )
}
