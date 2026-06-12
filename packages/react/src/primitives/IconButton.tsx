import type { ReactNode } from 'react'
import { Icon, type IconName } from '../components/Icon'

// A square icon-only header control (`.icon-btn`) — the bell, the activity pulse.
// `active` tints it teal; `badge` overlays a count chip (e.g. unread notifications).
// `children` (e.g. a dropdown) render inside the same position:relative wrap, so a
// popover anchors to the button. Extensible: spreads native <button> attributes.
type IconButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: IconName
  iconSize?: number
  active?: boolean
  // A count overlay; rendered as `.bell-badge` when > 0. Pass undefined for none.
  badge?: number
  // Anchored popover content (rendered inside the relative wrap, after the badge).
  children?: ReactNode
}

export const IconButton = ({
  icon,
  iconSize = 20,
  active = false,
  badge,
  className,
  children,
  ...rest
}: IconButtonProps) => {
  const cls = ['icon-btn', active ? 'active' : '', className].filter(Boolean).join(' ')
  const hasBadge = typeof badge === 'number' && badge > 0
  return (
    <span className='bell-wrap'>
      <button className={cls} {...rest}>
        <Icon name={icon} size={iconSize} />
      </button>
      {hasBadge && <span className='bell-badge'>{badge}</span>}
      {children}
    </span>
  )
}
