import clsx from 'clsx'
import { STATUS_LABEL, type Status } from '../status'
import type { AgentHealth } from '../serverTypes'
import { Icon, type IconName } from './Icon'
import { Button } from '../primitives/Button/Button'
import s from './AgentCard.module.scss'

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

// CSS Modules with `localsConvention: 'camelCaseOnly'` camelize BOTH `-` and `_`,
// so the runtime status string (e.g. `awaiting_approval`) must be camelized to
// match the emitted key (`awaitingApproval`; the pill variant `s-awaiting_approval`
// → `sAwaitingApproval`). This mirrors that transform for the status-keyed lookups.
const camelize = (input: string): string =>
  input.replace(/[-_]([a-z])/g, (_m, c: string) => c.toUpperCase())

const statusClass = (status: Status): string | undefined => s[camelize(status)]
const pillClass = (status: Status): string | undefined => s[camelize(`s-${status}`)]

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
        <span className={s.runFoot}>
          <Icon name='sparkle' size={15} />
          {aggregateLabel} · tap to view
        </span>
      )
    }
    if (!canStart) {
      return <span className={s.footHint}>Runs from a handoff</span>
    }
    return (
      <div className={s.cardFoot}>
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
    <div className={clsx(s.agentCard, unhealthy && s.isError)} onClick={onOpen}>
      <div className={s.cardTop}>
        <div className={s.cardIcon}>
          <Icon name={iconName} size={20} />
        </div>
        <span className={clsx(s.status, pillClass(status))}>
          <span className={clsx(s.dot, statusClass(status))} />
          {STATUS_LABEL[status]}
        </span>
      </div>

      <div className={s.cardHeadtext}>
        <p className={s.agentName}>{name}</p>
        <p className={s.agentSub}>{subtitle}</p>
        {unhealthy && (
          <p className={s.cardErrorMsg}>
            <Icon name='alert' size={13} />
            {health.error}
          </p>
        )}
      </div>

      {renderFoot()}
    </div>
  )
}
