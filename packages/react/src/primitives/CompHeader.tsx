import type { ReactNode } from 'react'
import { Icon, type IconName } from '../components/Icon'

// The shared component header used by sibling board columns (Pipeline, Your
// agents): a small uppercase icon+label on the left, an optional actions slot on
// the right, both columns guaranteed the same height/shape because they render
// the SAME primitive. Extensible: `actions` is a free render slot and `className`
// merges onto `.comp-head`.
type CompHeaderProps = {
  icon: IconName
  label: string
  iconSize?: number
  // Right-aligned controls (e.g. a Stop-workflow button, a legend).
  actions?: ReactNode
  className?: string
}

export const CompHeader = ({ icon, label, iconSize = 14, actions, className }: CompHeaderProps) => (
  <div className={['comp-head', className].filter(Boolean).join(' ')}>
    <span className='ch-label'>
      <Icon name={icon} size={iconSize} />
      {label}
    </span>
    <span className='ch-spacer' />
    {actions}
  </div>
)
