import { STATUS_LABEL, type Status } from '../status'
import type { AgentHealth } from '../serverTypes'
import { Icon, type IconName } from './Icon'
import { Button } from '../primitives/Button'

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
  // Credential health (from the board snapshot). !ok → a warning line + START blocked.
  health?: AgentHealth
  // START is disabled (e.g. a singleton already running) with this reason as the title.
  startDisabled?: boolean
  startDisabledReason?: string
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
  health,
  startDisabled = false,
  startDisabledReason,
  onStart,
  onOpen,
}: AgentCardProps) => {
  const start = (e: React.MouseEvent) => {
    e.stopPropagation()
    onStart()
  }

  const unhealthy = health && !health.ok
  // A missing credential blocks a launch; surface the hint and disable START.
  const blocked = startDisabled || !!unhealthy
  const blockedReason = unhealthy ? health.hint : startDisabledReason

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
        <Button
          variant='primary'
          block
          icon='play'
          iconSize={12}
          disabled={blocked}
          title={blocked ? blockedReason : undefined}
          onClick={start}
        >
          START
        </Button>
      </div>
    )
  }

  return (
    <div className={'agent-card' + (unhealthy ? ' is-error' : '')} onClick={onOpen}>
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
        {unhealthy && (
          <p className='card-error-msg'>
            <Icon name='alert' size={13} />
            {health.error}
          </p>
        )}
      </div>

      {renderFoot()}
    </div>
  )
}
