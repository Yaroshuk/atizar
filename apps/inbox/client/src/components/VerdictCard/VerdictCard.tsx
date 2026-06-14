import { CardShell, Button } from '@atizar/react'
import s from './VerdictCard.module.scss'

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

export const VerdictCard = ({ data, onDraftReply }: VerdictCardProps) => (
  <CardShell
    icon='envelope'
    kicker={data.from}
    title={data.subject}
    actions={
      // "Draft reply" only when the verdict carries a thread to reply into.
      data.threadId ? (
        <Button variant='primary' onClick={onDraftReply}>
          Draft reply
        </Button>
      ) : undefined
    }
  >
    <div className={s.tags}>
      <span className='pill'>
        <span className='pill-dot' />
        {data.category}
      </span>
      <span className='pill amber'>
        <span className='pill-dot' />
        {data.priority}
      </span>
    </div>
    <p className={s.reason}>{data.reason}</p>
  </CardShell>
)
