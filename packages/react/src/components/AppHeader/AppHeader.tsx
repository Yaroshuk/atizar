import { WorkflowTabs } from '../WorkflowTabs/WorkflowTabs'
import { Connections } from '../Connections/Connections'
import { StopButton } from '../../primitives/StopButton/StopButton'
import { ResetButton } from '../../primitives/ResetButton/ResetButton'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { testIds } from '../../testIds'
import s from './AppHeader.module.scss'
import type { WorkflowDescriptor } from '@atizar/core'

// The thin global header (Chrome tab strip + global controls). Left: a static brand
// (logo mark + workspace name — NOT a button, no hover; we have no menu/account to open).
// Middle: the workflow tabs. Right: the real, wired controls only — the integration
// connections (shared, so they live here), Stop all (emergency brake), Activity. No
// notifications/account/menu (the product has none). State-free; props drive everything.
type AppHeaderProps = {
  workflows: WorkflowDescriptor[]
  activeId: string
  unread: Record<string, number>
  onSelect: (id: string) => void
  // Stop all
  globalActive: number
  stoppingAll: boolean
  onStopAll: () => void
  // Reset all — stop and clear EVERYTHING across all workflows (running items included),
  // confirm-gated upstream (nothing happens until the human confirms). Optional: omit to hide.
  onResetAll?: () => void
  resettingAll?: boolean
  // Activity drawer
  activityOpen: boolean
  onToggleActivity: () => void
  workspaceName?: string
  // Optional brand logo. When set, an <img> replaces the letter mark (the initial of
  // workspaceName). The image lives in the consumer app; the framework only renders it.
  logoSrc?: string
  // Optional href the brand links to (e.g. the marketing landing). When set, the brand becomes
  // an anchor; the route is the app's concern, the framework only renders the link.
  brandHref?: string
  demo?: boolean
  // 'reconnecting' shows a header chip so a dropped board stream never reads as live-but-frozen.
  boardConnection?: 'live' | 'reconnecting'
}

export const AppHeader = ({
  workflows,
  activeId,
  unread,
  onSelect,
  globalActive,
  stoppingAll,
  onStopAll,
  onResetAll,
  resettingAll = false,
  activityOpen,
  onToggleActivity,
  workspaceName = 'Acme Inbox',
  logoSrc,
  brandHref,
  demo,
  boardConnection,
}: AppHeaderProps) => {
  const brandInner = (
    <>
      {/* `.ws-mark` stays a GLOBAL class (shared mark across surfaces) */}
      {logoSrc ? (
        <img className='ws-mark ws-mark-img' src={logoSrc} alt={workspaceName} />
      ) : (
        <span className='ws-mark'>{workspaceName.charAt(0)}</span>
      )}
      <span className={s.ahBrandName}>{workspaceName}</span>
    </>
  )
  return (
    <header className={s.appHeader}>
      {brandHref ? (
        <a className={s.ahBrand} href={brandHref}>
          {brandInner}
        </a>
      ) : (
        <div className={s.ahBrand}>{brandInner}</div>
      )}

      <WorkflowTabs workflows={workflows} activeId={activeId} unread={unread} onSelect={onSelect} />

      <span className={s.ahSpacer} />

      <div className={s.ahRight}>
        {!demo && <Connections />}
        {!demo && <span className={s.ahVline} />}
        {boardConnection === 'reconnecting' && (
          <span className={s.ahReconnect} data-testid={testIds.reconnectChip}>
            <span className={s.ahReconnectDot} />
            Reconnecting…
          </span>
        )}
        {onResetAll && (
          <ResetButton
            scope='all'
            label='Reset all'
            resetting={resettingAll}
            onClick={onResetAll}
            title='Clear every finished item across all workflows (in-progress work is kept)'
          />
        )}
        <StopButton
          scope='all'
          label='Stop all'
          data-testid={testIds.stopAll}
          disabled={globalActive === 0}
          stopping={stoppingAll}
          onClick={onStopAll}
          title='Emergency stop — halt every active item across all workflows'
        />
        {/* The activity feed is process-global (not yet tenant-scoped) — hide it in the demo so a
            visitor never sees another session's actions. The per-item trace stays (id-scoped). */}
        {!demo && (
          <IconButton
            icon='activity'
            active={activityOpen}
            onClick={onToggleActivity}
            aria-label='Activity log'
            title='Activity'
          />
        )}
      </div>
    </header>
  )
}
