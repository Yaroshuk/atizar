import { CardShell } from '@atizar/react'
import s from './SortSummaryCard.module.scss'

type SortCounts = { reply?: number; reader?: number; spam?: number; important?: number }
type SortSummaryCardProps = { summary: string; counts?: SortCounts }

const LABELS: { key: keyof SortCounts; label: string }[] = [
  { key: 'reply', label: 'reply' },
  { key: 'reader', label: 'reader' },
  { key: 'spam', label: 'spam' },
  { key: 'important', label: 'important' },
]

export const SortSummaryCard = ({ summary, counts }: SortSummaryCardProps) => (
  <CardShell icon='inbox' kicker='Inbox sorted'>
    <p className={s.reason}>{summary}</p>
    {counts && (
      <div className={s.tags}>
        {LABELS.filter(({ key }) => typeof counts[key] === 'number').map(({ key, label }) => (
          <span className='pill' key={key}>
            <span className='pill-dot' />
            {label}: {counts[key]}
          </span>
        ))}
      </div>
    )}
  </CardShell>
)
