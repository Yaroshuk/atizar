import { Icon } from './Icon'

type Lead = { from: string; subject: string; summary: string }

type LeadCardProps = { lead: Lead }

export const LeadCard = ({ lead }: LeadCardProps) => {
  return (
    <div className='lead-card'>
      <div className='lead-top'>
        <div className='lead-env'>
          <Icon name='envelope' size={16} />
        </div>
        <span className='lead-from'>{lead.from}</span>
      </div>
      <div className='lead-subject'>{lead.subject}</div>
      <div className='lead-reason'>{lead.summary}</div>
    </div>
  )
}
