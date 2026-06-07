import { Icon } from './Icon'

type Verdict = {
  threadId: string
  from: string
  subject: string
  summary: string
  category: string
  priority: string
  reason: string
}

type VerdictCardProps = { data: Verdict; onDraftReply: () => void }

export const VerdictCard = ({ data, onDraftReply }: VerdictCardProps) => {
  return (
    <div className='lead-card'>
      <div className='lead-top'>
        <div className='lead-env'>
          <Icon name='envelope' size={16} />
        </div>
        <span className='lead-from'>{data.from}</span>
      </div>
      <div className='lead-subject'>{data.subject}</div>
      <div className='lead-tags'>
        <span className='pill'>
          <span className='pill-dot' />
          {data.category}
        </span>
        <span className='pill amber'>
          <span className='pill-dot' />
          {data.priority}
        </span>
      </div>
      <div className='lead-reason'>{data.reason}</div>
      {data.threadId && (
        <button className='btn btn-primary' onClick={onDraftReply}>
          Draft reply
        </button>
      )}
    </div>
  )
}
