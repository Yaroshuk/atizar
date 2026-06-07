import { Icon } from './Icon'

type ApprovalData = { threadId: string; body: string }

type ApprovalDialogProps = { data: ApprovalData; onApprove: () => void }

export const ApprovalDialog = ({ data, onApprove }: ApprovalDialogProps) => {
  return (
    <div className='approval'>
      <div className='approval-head'>
        <span className='approval-badge'>
          <Icon name='alert' size={13} />
        </span>
        <span className='approval-kicker'>Approval needed</span>
      </div>
      <div className='approval-preview'>{data.body}</div>
      <button className='btn btn-teal' onClick={onApprove}>
        Save draft
      </button>
    </div>
  )
}
