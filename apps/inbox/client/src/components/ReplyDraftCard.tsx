import { Icon } from './Icon'

type ReplyDraftCardProps = { data: { title: string; draft: string } }

export const ReplyDraftCard = ({ data }: ReplyDraftCardProps) => {
  return (
    <div className='approval'>
      <span className='approval-badge'>
        <Icon name='pen' size={12} /> Suggested reply (draft — not posted)
      </span>
      <div className='lead-subject'>{data.title}</div>
      <div className='approval-preview' style={{ whiteSpace: 'pre-wrap' }}>
        {data.draft}
      </div>
    </div>
  )
}
