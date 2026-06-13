import { useState } from 'react'
import { Icon } from '@atizar/react'

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

const ACTIONS: BatchAction[] = ['read', 'trash', 'star', 'keep']

export const EmailBatchCard = ({ data, onApprove, onReject }: EmailBatchCardProps) => {
  const [rows, setRows] = useState<BatchRow[]>(data.items)

  const setAction = (index: number, action: BatchAction) =>
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, action } : row)))

  const applied = rows.filter((r) => r.action !== 'keep').length

  return (
    <div className='approval'>
      <div className='approval-head'>
        <span className='approval-badge'>
          <Icon name='inbox' size={13} />
        </span>
        <span className='approval-kicker'>Review {rows.length} email(s)</span>
      </div>
      <div className='batch-rows'>
        {rows.map((row, i) => (
          <div className='batch-row' key={row.messageId}>
            <div className='batch-row-meta'>
              <span className='batch-row-from'>{row.from ?? row.messageId}</span>
              <span className='batch-row-subject'>{row.subject ?? ''}</span>
            </div>
            <select
              className='batch-row-action'
              value={row.action}
              onChange={(e) => setAction(i, e.target.value as BatchAction)}
              aria-label={`Action for ${row.from ?? row.messageId}`}
            >
              {ACTIONS.map((a) => (
                <option value={a} key={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div className='approval-actions'>
        <button className='btn btn-teal' onClick={() => onApprove({ items: rows })}>
          Apply {applied} action(s)
        </button>
        <button className='btn btn-ghost' onClick={onReject}>
          Reject
        </button>
      </div>
    </div>
  )
}
