import type { ReactNode } from 'react'
import { Icon, type IconName } from '../components/Icon'

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
    className='backdrop'
    onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose()
    }}
  >
    <div
      className={['modal', className].filter(Boolean).join(' ')}
      role='dialog'
      aria-modal='true'
      aria-label={ariaLabel ?? title}
    >
      <div className='modal-head'>
        <div className='modal-mark'>
          <Icon name={icon} size={17} />
        </div>
        <div className='modal-titles'>
          <span className='modal-title'>{title}</span>
          {subtitle && <span className='modal-status'>{subtitle}</span>}
        </div>
        <button className='modal-x' onClick={onClose} aria-label='Close'>
          <Icon name='close' size={17} />
        </button>
      </div>
      {children}
      {footer && <div className='modal-foot'>{footer}</div>}
    </div>
  </div>
)
