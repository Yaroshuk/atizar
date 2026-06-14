import clsx from 'clsx'
import { Icon } from '../Icon/Icon'
import s from './WorkflowTabs.module.scss'
import type { WorkflowDescriptor } from '@atizar/core'

// Chrome/Arc-style workflow tabs: the active tab is white, raised, and visually
// fused to the panel below it; inactive tabs are recessed and muted. A badge on a
// NON-active tab signals a background workflow needs attention (e.g. a fresh
// cross-workflow arrival). Tabs are fixed (not closeable/reorderable) → selection
// only. Extensible via `className` on the tab strip.
type WorkflowTabsProps = {
  workflows: WorkflowDescriptor[]
  activeId: string
  // Per-workflow attention count (cross-workflow unread); 0/absent → no badge.
  unread: Record<string, number>
  onSelect: (id: string) => void
  className?: string
}

export const WorkflowTabs = ({
  workflows,
  activeId,
  unread,
  onSelect,
  className,
}: WorkflowTabsProps) => (
  <nav className={clsx(s.wfTabs, className)} role='tablist' aria-label='Workflows'>
    {workflows.map((wf) => {
      const active = wf.id === activeId
      const badge = unread[wf.id] ?? 0
      return (
        <button
          key={wf.id}
          className={clsx(s.wfTab, active && s.active)}
          role='tab'
          aria-selected={active}
          onClick={() => onSelect(wf.id)}
        >
          <Icon name={wf.iconName as never} size={16} />
          <span className={s.wfName}>{wf.label}</span>
          {!active && badge > 0 && (
            <span className={s.wfBadge} title={`${badge} needing attention`}>
              {badge}
            </span>
          )}
        </button>
      )
    })}
  </nav>
)
