import { Icon } from './Icon'
import { groupByStatus, type TriageTicket } from '../buckets'

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

// Triage already decided the route, so we show ONE action button for it (not all three).
const ROUTE_LABEL: Record<Route, string> = {
  feature: 'Send to Feature',
  bugfix: 'Send to Bug-fix',
  'reply-draft': 'Draft reply',
}

export const TriageCard = ({ tickets, onRoute, onTreatAsLead }: TriageCardProps) => {
  const groups = groupByStatus(tickets)
  return (
    <div className='lead-card'>
      <div className='lead-top'>
        <div className='lead-env'>
          <Icon name='git' size={16} />
        </div>
        <span className='lead-from'>Your tickets · {tickets.length}</span>
      </div>
      {groups.map((group) => (
        <div key={group.status} className='triage-group'>
          <div className='triage-status'>{group.status}</div>
          {group.tickets.map((ticket) => {
            const suggested = RECO_TO_ROUTE[ticket.recommendation] ?? 'feature'
            return (
              <div key={`${ticket.repo}#${ticket.number}`} className='triage-row'>
                <div className='triage-row-title'>
                  {ticket.needsReply && <span className='pill amber'>needs reply</span>}#
                  {ticket.number} {ticket.title}
                </div>
                <div className='triage-routes'>
                  <a
                    className='triage-link'
                    href={ticket.url}
                    target='_blank'
                    rel='noreferrer'
                    onClick={(e) => e.stopPropagation()}
                  >
                    Open in browser
                  </a>
                  <button className='btn btn-primary' onClick={() => onRoute(suggested, ticket)}>
                    {ROUTE_LABEL[suggested]}
                  </button>
                  {onTreatAsLead && (
                    <button className='btn btn-primary' onClick={() => onTreatAsLead(ticket)}>
                      Treat as lead → Lead inbox
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
