import { Icon } from './Icon'
import { groupByStatus, type TriageTicket } from '../buckets'

type Route = 'feature' | 'bugfix' | 'reply-draft'

type TriageCardProps = {
  tickets: TriageTicket[]
  onRoute: (target: Route, ticket: TriageTicket) => void
}

const RECO_TO_ROUTE: Record<string, Route> = {
  feature: 'feature',
  bugfix: 'bugfix',
  bug: 'bugfix',
  reply: 'reply-draft',
}

export const TriageCard = ({ tickets, onRoute }: TriageCardProps) => {
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
                  {(['feature', 'bugfix', 'reply-draft'] as Route[]).map((route) => (
                    <button
                      key={route}
                      className={route === suggested ? 'btn btn-primary' : 'btn'}
                      onClick={() => onRoute(route, ticket)}
                    >
                      {route === 'reply-draft' ? 'reply' : route}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
