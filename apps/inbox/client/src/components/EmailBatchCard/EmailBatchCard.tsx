import { useState } from 'react'
import { CardShell, Button, IconButton, type IconName } from '@atizar/react'
import { appTestIds } from '../../testIds'
import s from './EmailBatchCard.module.scss'

type BatchAction = 'read' | 'trash' | 'star' | 'keep'
type BatchRow = { messageId: string; from?: string; subject?: string; action: BatchAction }
type EmailBatchData = { items: BatchRow[] }

type EmailBatchCardProps = {
  data: EmailBatchData
  // The edited rows flow to onApprove — this is the load-bearing "what the human approves is what
  // the server applies" path (the server executes applyEmailActions with this form).
  onApprove: (editedForm: EmailBatchData) => void
  onReject: () => void
}

// The four per-row actions as an ordered icon cluster. `mark-read` → check, `keep` → mail
// (the no-op "leave it"), trash + star use the dedicated glyphs added to the Icon set.
const ACTIONS: { action: BatchAction; icon: IconName; label: string }[] = [
  { action: 'trash', icon: 'trash', label: 'Trash' },
  { action: 'read', icon: 'check', label: 'Mark read' },
  { action: 'star', icon: 'star', label: 'Star' },
  { action: 'keep', icon: 'mail', label: 'Keep' },
]

export const EmailBatchCard = ({ data, onApprove, onReject }: EmailBatchCardProps) => {
  const [rows, setRows] = useState<BatchRow[]>(data.items)

  const setAction = (index: number, action: BatchAction) =>
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, action } : row)))

  const applied = rows.filter((r) => r.action !== 'keep').length

  return (
    <CardShell
      tone='attention'
      icon='inbox'
      kicker={`Review ${rows.length} email(s)`}
      actions={
        <>
          <Button
            variant='teal'
            data-testid={appTestIds.batchApply}
            onClick={() => onApprove({ items: rows })}
          >
            Apply {applied} action(s)
          </Button>
          <Button variant='ghost' data-testid={appTestIds.batchReject} onClick={onReject}>
            Reject
          </Button>
        </>
      }
    >
      <div className={s.rows}>
        {rows.map((row, i) => {
          const who = row.from ?? row.messageId
          return (
            <div className={s.row} key={row.messageId}>
              <div className={s.rowMeta}>
                <span className={s.rowFrom}>{who}</span>
                <span className={s.rowSubject}>{row.subject ?? ''}</span>
              </div>
              <div className={s.rowActions}>
                {ACTIONS.map(({ action, icon, label }) => (
                  <IconButton
                    key={action}
                    icon={icon}
                    iconSize={16}
                    active={row.action === action}
                    data-testid={appTestIds.batchAction(action)}
                    aria-label={`${label} — ${who}`}
                    aria-pressed={row.action === action}
                    onClick={() => setAction(i, action)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </CardShell>
  )
}
