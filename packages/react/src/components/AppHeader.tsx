import { WorkflowTabs } from './WorkflowTabs'
import { Connections } from './Connections'
import { StopButton } from '../primitives/StopButton/StopButton'
import { IconButton } from '../primitives/IconButton/IconButton'
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
  // Activity drawer
  activityOpen: boolean
  onToggleActivity: () => void
  workspaceName?: string
  demo?: boolean
}

export const AppHeader = ({
  workflows,
  activeId,
  unread,
  onSelect,
  globalActive,
  stoppingAll,
  onStopAll,
  activityOpen,
  onToggleActivity,
  workspaceName = 'Acme Inbox',
  demo,
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
