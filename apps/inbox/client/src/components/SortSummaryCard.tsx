import { Icon } from '@atizar/react'

type SortCounts = { reply?: number; reader?: number; spam?: number; important?: number }
type SortSummaryCardProps = { summary: string; counts?: SortCounts }

const LABELS: { key: keyof SortCounts; label: string }[] = [
  { key: 'reply', label: 'reply' },
  { key: 'reader', label: 'reader' },
  { key: 'spam', label: 'spam' },
  { key: 'important', label: 'important' },
]

export const SortSummaryCard = ({ summary, counts }: SortSummaryCardProps) => {
  return (
    <div className='lead-card'>
      <div className='lead-top'>
        <div className='lead-env'>
          <Icon name='inbox' size={16} />
        </div>
        <span className='lead-from'>Inbox sorted</span>
      </div>
      <div className='lead-reason'>{summary}</div>
      {counts && (
        <div className='lead-tags'>
          {LABELS.filter(({ key }) => typeof counts[key] === 'number').map(({ key, label }) => (
            <span className='pill' key={key}>
              <span className='pill-dot' />
              {label}: {counts[key]}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
