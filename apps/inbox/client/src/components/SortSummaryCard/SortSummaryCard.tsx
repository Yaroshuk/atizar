import { CardShell, Markdown, useBoard, useThreadHandoffs } from '@atizar/react'
import { projectScanResult, type Dest } from '../../../../workflows/email-inbox/scanResult'
import { appTestIds } from '../../testIds'
import s from './SortSummaryCard.module.scss'

type SortSummaryCardProps = { summary: string }

const DESTS: Dest[] = ['reply', 'reader', 'spam', 'important']

export const SortSummaryCard = ({ summary }: SortSummaryCardProps) => {
  const handoffs = useThreadHandoffs()
  const { items } = useBoard()
  const r = projectScanResult(handoffs, items)
  const sum = (rec: Record<Dest, number>) => DESTS.reduce((n, d) => n + rec[d], 0)
  const handled = sum(r.alreadyHandled)

  const chips = (rec: Record<Dest, number>) =>
    DESTS.filter((d) => rec[d] > 0).map((d) => (
      <span className='pill' key={d}>
        <span className='pill-dot' />
        {d}: {rec[d]}
      </span>
    ))

  return (
    <CardShell icon='inbox' kicker='Inbox sorted'>
      <div className={s.reason}>
        <Markdown>{summary}</Markdown>
      </div>
      <div className={s.headline} data-testid={appTestIds.sortHeadline}>
        {r.read} read · {sum(r.new)} new{handled > 0 ? ` · ${handled} already handled` : ''}
      </div>
      <div className={s.tags}>{chips(r.new)}</div>
      {handled > 0 && <div className={`${s.tags} ${s.handled}`}>{chips(r.alreadyHandled)}</div>}
    </CardShell>
  )
}
