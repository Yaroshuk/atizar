import { useState } from 'react'
import { Icon } from '@atizar/react'

type ApprovalData = { threadId: string; body: string }

type ApprovalDialogProps = {
  data: ApprovalData
  // The edited body flows to onApprove — this is the load-bearing "the edited text is what
  // lands in the real Gmail draft" path (the server executes the effect with this form).
  onApprove: (editedBody: string) => void
  onReject: () => void
}

export const ApprovalDialog = ({ data, onApprove, onReject }: ApprovalDialogProps) => {
  const [body, setBody] = useState(data.body)
  return (
    <div className='approval'>
      <div className='approval-head'>
        <span className='approval-badge'>
          <Icon name='alert' size={13} />
        </span>
        <span className='approval-kicker'>Approval needed</span>
      </div>
      <textarea
        className='approval-edit'
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={8}
      />
      <div className='approval-actions'>
        <button className='btn btn-teal' onClick={() => onApprove(body)}>
          Save draft
        </button>
        <button className='btn btn-ghost' onClick={onReject}>
          Reject
        </button>
      </div>
    </div>
  )
}
