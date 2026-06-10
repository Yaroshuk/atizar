import { Icon } from '@platform/react'

type ReplyDraftCardProps = { data: { title: string; draft: string } }

export const ReplyDraftCard = ({ data }: ReplyDraftCardProps) => {
  return (
    <div className='approval'>
      <div className='approval-head'>
        <span className='approval-badge'>
          <Icon name='pen' size={13} />
        </span>
        <span className='approval-kicker'>Suggested reply · draft, not posted</span>
      </div>
      <div className='lead-subject'>{data.title}</div>
      <div className='approval-preview'>{data.draft}</div>
    </div>
  )
}
