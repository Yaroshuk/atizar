import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Icon, type IconName } from '../../components/Icon/Icon.js'
import s from './CardShell.module.scss'

// The shared frame every in-thread card composes — one anatomy for all 8 cards.
// `tone` switches the surface: 'default' = neutral white (today's .lead-card look),
// 'attention' = amber (today's .approval look). Header (icon badge + kicker + title +
// trailing badge), a body slot, and a right-aligned actions zone — each rendered only
// when its slot is provided, so a card can use any subset.
type CardShellTone = 'default' | 'attention'

type CardShellProps = {
  tone?: CardShellTone
  icon?: IconName
  kicker?: ReactNode
  title?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}

export const CardShell = ({
  tone = 'default',
  icon,
  kicker,
  title,
  badge,
  actions,
  children,
  className,
}: CardShellProps) => (
  <div className={clsx(s.shell, tone === 'attention' && s.attention, className)}>
    {(icon || kicker || title || badge) && (
      <div className={s.head}>
        {icon && (
          <span className={s.iconBadge}>
            <Icon name={icon} size={16} />
          </span>
        )}
        <div className={s.heading}>
          {kicker && <span className={s.kicker}>{kicker}</span>}
          {title && <span className={s.title}>{title}</span>}
        </div>
        {badge && <span className={s.badge}>{badge}</span>}
      </div>
    )}
    {children && <div className={s.body}>{children}</div>}
    {actions && <div className={s.actions}>{actions}</div>}
  </div>
)
