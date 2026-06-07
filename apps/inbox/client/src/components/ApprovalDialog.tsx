type ApprovalData = { threadId: string; body: string }

type ApprovalDialogProps = { data: ApprovalData; onApprove: () => void }

export const ApprovalDialog = ({ data, onApprove }: ApprovalDialogProps) => {
  return (
    <div
      style={{
        border: '1px solid #f0c000',
        borderRadius: 10,
        padding: 12,
        background: '#fffbe6',
        margin: '8px 0',
      }}
    >
      <div style={{ marginBottom: 8, whiteSpace: 'pre-wrap' }}>{data.body}</div>
      <button
        onClick={onApprove}
        style={{
          background: '#0a7',
          color: '#fff',
          border: 0,
          borderRadius: 6,
          padding: '6px 14px',
        }}
      >
        Save draft
      </button>
    </div>
  )
}
