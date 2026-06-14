import { useEffect, type ReactNode } from 'react'
import clsx from 'clsx'
import { Icon } from '../../components/Icon'
import s from './Drawer.module.scss'

// A right-anchored slide-in drawer over a dim scrim — the Activity/Trace surface
// is built on this. Secondary surface: Esc and scrim-click dismiss it; it never
// takes the operator out of context. The drawer owns ONLY the scrim, the slide
// shell, and the head (caller-supplied `header` + a close button); everything
// below the head is the caller's `children` (filters, scroll feed, etc.), so the
// caller keeps control of scroll refs and follow behaviour. Extensible via
// `className` on the shell.
type DrawerProps = {
  open: boolean
  onClose: () => void
  ariaLabel: string
  header: ReactNode
  children: ReactNode
  className?: string
}

export const Drawer = ({ open, onClose, ariaLabel, header, children, className }: DrawerProps) => {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <>
      <div className={s.actScrim} onClick={onClose} />
      <aside className={clsx(s.actDrawer, className)} role='dialog' aria-label={ariaLabel}>
        <div className={s.actHead}>
          {header}
          <button className={s.actX} onClick={onClose} aria-label='Close'>
            <Icon name='close' size={17} />
          </button>
        </div>
        {children}
      </aside>
    </>
  )
}
