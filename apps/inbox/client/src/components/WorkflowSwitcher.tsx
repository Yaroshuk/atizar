import { Icon } from './Icon'
import type { WorkflowDescriptor } from '@platform/core'

type WorkflowSwitcherProps = {
  workflows: WorkflowDescriptor[]
  activeId: string
  unread: Record<string, number>
  onSelect: (id: string) => void
}

export const WorkflowSwitcher = ({
  workflows,
  activeId,
  unread,
  onSelect,
}: WorkflowSwitcherProps) => (
  <div className='workflow-tabs'>
    {workflows.map((wf) => {
      const count = unread[wf.id] ?? 0
      return (
        <button
          key={wf.id}
          className={wf.id === activeId ? 'workflow-tab active' : 'workflow-tab'}
          onClick={() => onSelect(wf.id)}
        >
          <Icon name={wf.iconName as never} size={14} />
          {wf.label}
          {count > 0 && <span className='workflow-badge'>{count}</span>}
        </button>
      )
    })}
  </div>
)
