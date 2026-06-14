import { CardShell } from '@atizar/react'
import s from './ReplyDraftCard.module.scss'

type ReplyDraftCardProps = { data: { title: string; draft: string } }

export const ReplyDraftCard = ({ data }: ReplyDraftCardProps) => {
  return (
    <CardShell
      tone='attention'
      icon='pen'
      kicker='Suggested reply · draft, not posted'
      title={data.title}
    >
      <div className={s.preview}>{data.draft}</div>
    </CardShell>
  )
}
