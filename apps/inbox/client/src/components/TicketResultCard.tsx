import { Icon } from './Icon'

type TicketResultCardProps = { data: { title: string; kind: string; analysis: string } }

export const TicketResultCard = ({ data }: TicketResultCardProps) => {
  return (
    <div className='lead-card'>
      <div className='lead-top'>
        <div className='lead-env'>
          <Icon name={data.kind === 'bug' ? 'bug' : 'wrench'} size={16} />
        </div>
        <span className='lead-from'>{data.kind === 'bug' ? 'Bug analysis' : 'Feature plan'}</span>
      </div>
      <div className='lead-subject'>{data.title}</div>
      <div className='lead-reason' style={{ whiteSpace: 'pre-wrap' }}>
        {data.analysis}
      </div>
    </div>
  )
}
