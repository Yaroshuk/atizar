import { useState } from 'react'
import { CardShell, Button, SourcePanel } from '@atizar/react'
import { appTestIds } from '../../testIds'
import s from './ApprovalDialog.module.scss'

type ApprovalData = { threadId: string; body: string }

type ApprovalDialogProps = {
  data: ApprovalData
  // The untrusted source email the agent drafted a reply TO — shown above the editable body,
  // flagged untrusted, so the human reviews the real input next to the proposed action.
  source: Record<string, unknown>
  // The edited body flows to onApprove — this is the load-bearing "the edited text is what
  // lands in the real Gmail draft" path (the server executes the effect with this form).
  onApprove: (editedBody: string) => void
  onReject: () => void
}

export const ApprovalDialog = ({ data, source, onApprove, onReject }: ApprovalDialogProps) => {
  const [body, setBody] = useState(data.body ?? '')
  return (
    <CardShell
      tone='attention'
      icon='pen'
      kicker='Approval needed'
      actions={
        <>
          <Button
            variant='teal'
            data-testid={appTestIds.approvalSave}
            onClick={() => onApprove(body)}
          >
            Save draft
          </Button>
          <Button variant='ghost' data-testid={appTestIds.approvalReject} onClick={onReject}>
            Reject
          </Button>
        </>
      }
    >
      <SourcePanel source={source} />
      <textarea
        className={s.edit}
        data-testid={appTestIds.approvalBody}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={8}
      />
    </CardShell>
  )
}
