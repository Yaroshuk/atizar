import { Icon } from './Icon'
import type { Workflow } from '../workflows'

type WorkflowSwitcherProps = {
  workflows: Workflow[]
  activeId: string
  onSelect: (id: string) => void
}

export const WorkflowSwitcher = ({ workflows, activeId, onSelect }: WorkflowSwitcherProps) => {
  return (
    <div className='workflow-tabs'>
      {workflows.map((wf) => (
        <button
          key={wf.id}
          className={wf.id === activeId ? 'workflow-tab active' : 'workflow-tab'}
          onClick={() => onSelect(wf.id)}
        >
          <Icon name={wf.iconName} size={14} />
          {wf.label}
        </button>
      ))}
    </div>
  )
}
