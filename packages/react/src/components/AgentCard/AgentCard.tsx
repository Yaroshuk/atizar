import clsx from 'clsx'
import type { Outcome } from '@atizar/core'
import { type Status } from '../../status'
import { cardLabel } from '../../statusDisplay'
import type { AgentHealth } from '../../serverTypes'
import { Icon, type IconName } from '../Icon/Icon'
import { Button } from '../../primitives/Button/Button'
import s from './AgentCard.module.scss'

type AgentCardProps = {
  name: string
  subtitle: string
  iconName: IconName
  status: Status
  // The representative terminal outcome when nothing is live (status === 'done'). A distinct
  // terminal (stopped/rejected) makes the badge read "Stopped"/"Rejected" instead of "Done"
  // AND keys its own muted-grey dot/pill colour; `null` / clean done → the status label + colour.
  outcome?: Outcome | null
  // Headline for the type card, e.g. "2 active · 1 awaiting approval" ('' = none live).
  // When set it replaces the START / hint footer with the live-instance summary.
  aggregateLabel: string
  // Whether this agent can be launched directly. Handoff-only agents (e.g. reply,
  // started by the qualifier) are not launchable and show no START button.
  canStart: boolean
  // Credential health (from the board snapshot). !ok → a warning line + START blocked.
  health?: AgentHealth
  // Optional stable hook for E2E (e.g. `agent-<id>`): tags the card + its START button.
  testId?: string
  onStart: () => void
  onOpen: () => void
}

// CSS Modules with `localsConvention: 'camelCaseOnly'` camelize BOTH `-` and `_`,
// so the runtime status string (e.g. `awaiting_approval`) must be camelized to
// match the emitted key (`awaitingApproval`; the pill variant `s-awaiting_approval`
// → `sAwaitingApproval`). This mirrors that transform for the status-keyed lookups.
const camelize = (input: string): string =>
  input.replace(/[-_]([a-z])/g, (_m, c: string) => c.toUpperCase())

// Dot + pill colour: a distinct terminal outcome (stopped/rejected) keys its own muted-grey
// class; otherwise status-keyed. Falls back to the status class when no outcome variant exists.
const dotClass = (status: Status, outcome: Outcome | null): string | undefined =>
  (outcome ? s[camelize(outcome)] : undefined) ?? s[camelize(status)]
const pillClass = (status: Status, outcome: Outcome | null): string | undefined =>
  (outcome ? s[camelize(`s-${outcome}`)] : undefined) ?? s[camelize(`s-${status}`)]

export const AgentCard = ({
  name,
  subtitle,
  iconName,
  status,
  outcome = null,
  aggregateLabel,
  canStart,
  health,
  testId,
  onStart,
  onOpen,
}: AgentCardProps) => {
  const start = (e: React.MouseEvent) => {
    e.stopPropagation()
    onStart()
  }

  const unhealthy = health && !health.ok
  // A missing credential blocks a launch; surface the hint and disable START.
  const blocked = !!unhealthy
  const blockedReason = unhealthy ? health.hint : undefined

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
          data-testid={testId ? `${testId}-start` : undefined}
          onClick={start}
        >
          START
        </Button>
      </div>
    )
  }

  return (
    <div
      className={clsx(s.agentCard, unhealthy && s.isError)}
      data-testid={testId}
      onClick={onOpen}
    >
      <div className={s.cardTop}>
        <div className={s.cardIcon}>
          <Icon name={iconName} size={20} />
        </div>
        <span className={clsx(s.status, pillClass(status, outcome))}>
          <span className={clsx(s.dot, dotClass(status, outcome))} />
          {cardLabel(status, outcome)}
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
