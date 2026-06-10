import { STATUS_LABEL, type Status } from '../status'
import { Icon, type IconName } from './Icon'

type AgentCardProps = {
  name: string
  subtitle: string
  iconName: IconName
  status: Status
  // Headline for the type card, e.g. "2 active · 1 awaiting approval" ('' = none live).
  // When set it replaces the START / hint footer with the live-instance summary.
  aggregateLabel: string
  // Whether this agent can be launched directly. Handoff-only agents (e.g. reply,
  // started by the qualifier) are not launchable and show no START button.
  canStart: boolean
  onStart: () => void
  onOpen: () => void
}

export const AgentCard = ({
  name,
  subtitle,
  iconName,
  status,
  aggregateLabel,
  canStart,
  onStart,
  onOpen,
}: AgentCardProps) => {
  const start = (e: React.MouseEvent) => {
    e.stopPropagation()
    onStart()
  }

  const renderFoot = () => {
    if (aggregateLabel) {
      return (
        <span className='run-foot'>
          <Icon name='sparkle' size={15} />
          {aggregateLabel} · tap to view
        </span>
      )
    }
    if (!canStart) {
      return <span className='foot-hint'>Runs from a handoff</span>
    }
    return (
      <div className='card-foot'>
        <button className='btn btn-primary' onClick={start}>
          START
        </button>
      </div>
    )
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

      {renderFoot()}
    </div>
  )
}
