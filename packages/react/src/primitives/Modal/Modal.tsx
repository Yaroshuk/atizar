import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Icon, type IconName } from '../../components/Icon/Icon'
import s from './Modal.module.scss'

// A centered modal over a dim backdrop, with the Smedja head (icon mark + title +
// optional subtitle + close ×). Click-outside and the × close it. `footer` is an
// optional action row; `className` lets a variant set width (e.g. settings).
// Extensible: `children` is the body, `footer`/`subtitle` are free slots.
type ModalProps = {
  title: string
  icon: IconName
  onClose: () => void
  subtitle?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
  ariaLabel?: string
}

export const Modal = ({
  title,
  icon,
  onClose,
  subtitle,
  footer,
  children,
  className,
  ariaLabel,
}: ModalProps) => (
  <div
    className={s.backdrop}
    onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose()
    }}
  >
    <div
      className={clsx(s.modal, className)}
      role='dialog'
      aria-modal='true'
      aria-label={ariaLabel ?? title}
    >
      <div className={s.modalHead}>
        <div className={s.modalMark}>
          <Icon name={icon} size={17} />
        </div>
        <div className={s.modalTitles}>
          <span className={s.modalTitle}>{title}</span>
          {subtitle && <span className={s.modalStatus}>{subtitle}</span>}
        </div>
        <button className={s.modalX} onClick={onClose} aria-label='Close'>
          <Icon name='close' size={17} />
        </button>
      </div>
      {children}
      {/* `.modal-foot` stays a GLOBAL class (shared): caller-supplied footer
          children are styled by global `.modal-foot .*` descendant selectors. */}
      {footer && <div className='modal-foot'>{footer}</div>}
    </div>
  </div>
)
