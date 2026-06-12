import { useEffect } from 'react'
import { Button } from './Button'

// A small destructive-action confirmation (the bulk Stop scopes use it). Esc and
// scrim-click cancel; the confirm action is styled danger. Extensible: copy is
// fully prop-driven (`title`, `message`, `confirmLabel`).
type ConfirmDialogProps = {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export const ConfirmDialog = ({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <>
      <div className='confirm-scrim' onClick={onCancel} />
      <div className='confirm' role='alertdialog' aria-label={title}>
        <div className='confirm-icon'>
          <span className='stop-glyph' />
        </div>
        <h3 className='confirm-title'>{title}</h3>
        <p className='confirm-msg'>{message}</p>
        <div className='confirm-actions'>
          <Button variant='soft' onClick={onCancel}>
            Cancel
          </Button>
          <Button variant='danger' onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </>
  )
}
