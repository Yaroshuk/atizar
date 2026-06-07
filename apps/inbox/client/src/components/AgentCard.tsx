import { STATUS_LABEL, type Status } from '../status'
import { Icon, type IconName } from './Icon'

type AgentCardProps = {
  name: string
  subtitle: string
  iconName: IconName
  status: Status
  onStart: () => void
  onOpen: () => void
}

export const AgentCard = ({
  name,
  subtitle,
  iconName,
  status,
  onStart,
  onOpen,
}: AgentCardProps) => {
  const start = (e: React.MouseEvent) => {
    e.stopPropagation()
    onStart()
  }

  return (
    <div className='agent-card' onClick={onOpen}>
      <div className='card-top'>
        <div className='card-icon'>
          <Icon name={iconName} size={20} />
        </div>
        <span className={`status s-${status}`}>
          <span className={`dot ${status}`} />
          {STATUS_LABEL[status]}
        </span>
      </div>

      <div className='card-headtext'>
        <p className='agent-name'>{name}</p>
        <p className='agent-sub'>{subtitle}</p>
      </div>

      {status === 'running' ? (
        <span className='run-foot'>
          <Icon name='sparkle' size={15} />
          Running… tap to view
        </span>
      ) : (
        <div className='card-foot'>
          <button className='btn btn-primary' onClick={start}>
            START
          </button>
        </div>
      )}
    </div>
  )
}
