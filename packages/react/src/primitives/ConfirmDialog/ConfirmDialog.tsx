import { useEffect } from 'react'
import { Button } from '../Button/Button'
import s from './ConfirmDialog.module.scss'

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
      <div className={s.confirmScrim} onClick={onCancel} />
      <div className={s.confirm} role='alertdialog' aria-label={title}>
        <div className={s.confirmIcon}>
          {/* keeps the GLOBAL `stop-glyph` class — styled by `.confirmIcon
              :global(.stop-glyph)` in the module (shared glyph, owned by StopButton). */}
          <span className='stop-glyph' />
        </div>
        <h3 className={s.confirmTitle}>{title}</h3>
        <p className={s.confirmMsg}>{message}</p>
        <div className={s.confirmActions}>
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
