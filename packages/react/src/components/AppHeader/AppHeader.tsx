import { WorkflowTabs } from '../WorkflowTabs/WorkflowTabs'
import { Connections } from '../Connections/Connections'
import { StopButton } from '../../primitives/StopButton/StopButton'
import { ResetButton } from '../../primitives/ResetButton/ResetButton'
import { IconButton } from '../../primitives/IconButton/IconButton'
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
  demo,
  boardConnection,
}: AppHeaderProps) => (
  <header className={s.appHeader}>
    <div className={s.ahBrand}>
      {/* `.ws-mark` stays a GLOBAL class (shared mark across surfaces) */}
      <span className='ws-mark'>{workspaceName.charAt(0)}</span>
      <span className={s.ahBrandName}>{workspaceName}</span>
    </div>

    <WorkflowTabs workflows={workflows} activeId={activeId} unread={unread} onSelect={onSelect} />

    <span className={s.ahSpacer} />

    <div className={s.ahRight}>
      {!demo && <Connections />}
      {!demo && <span className={s.ahVline} />}
      {boardConnection === 'reconnecting' && (
        <span className={s.ahReconnect}>
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
        disabled={globalActive === 0}
        stopping={stoppingAll}
        onClick={onStopAll}
        title='Emergency stop — halt every active item across all workflows'
      />
      <IconButton
        icon='activity'
        active={activityOpen}
        onClick={onToggleActivity}
        aria-label='Activity log'
        title='Activity'
      />
    </div>
  </header>
)
