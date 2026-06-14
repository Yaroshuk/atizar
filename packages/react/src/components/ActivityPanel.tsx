import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Icon } from './Icon'
import { Drawer } from '../primitives/Drawer/Drawer'
import { Segmented } from '../primitives/Segmented/Segmented'
import s from './ActivityPanel.module.scss'
import type { ActivityEntry } from '../serverTypes'
import type { ActivityFeed } from '../hooks/useActivity'

// CSS Modules (`localsConvention: 'camelCaseOnly'`) camelize BOTH `-` and `_`, so
// runtime-keyed class names (kind → `mk-<colour>` marker, kind → `tt-<kind>` trace
// type) must be camelized to match the emitted key.
const camelize = (input: string): string =>
  input.replace(/[-_]([a-z])/g, (_m, c: string) => c.toUpperCase())

// The observability surface. Operator mode = a chronological feed of meaningful
// events (status-colored marker, time, workflow + agent, summary), newest at the
// bottom, auto-following the live SSE. Dev mode (?dev=1) adds a Trace view —
// the same events grouped by work item, dense + monospace, collapsible. Both
// share filters (by workflow; by kind), the empty state, and the live/reconnecting
// chip. Generic over the workflow set so the package owns no vertical labels.
type WorkflowLite = { id: string; label: string }

type ActivityPanelProps = {
  open: boolean
  dev: boolean
  feed: ActivityFeed
  workflows: ReadonlyArray<WorkflowLite>
  onClose: () => void
}

// kind → marker color (mirrors the documented activity kinds).
const KIND_MARK: Record<string, string> = {
  queued: 'grey',
  running: 'blue',
  delivered: 'blue',
  gate: 'amber',
  resolved: 'green',
  effect: 'green',
  finished: 'green',
  error: 'red',
  cancelled: 'grey',
}
const markOf = (kind: string): string => KIND_MARK[kind] ?? 'grey'

const fmtTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

// agentId is `wf__agent`; show the agent half.
const agentName = (agentId: string): string => {
  const i = agentId.indexOf('__')
  return i >= 0 ? agentId.slice(i + 2) : agentId
}

const ConnChip = ({ connection }: { connection: ActivityFeed['connection'] }) =>
  connection === 'reconnecting' ? (
    <span className={clsx(s.actConn, s.reconnecting)}>
      <span className={s.cspin} />
      Reconnecting…
    </span>
  ) : (
    <span className={clsx(s.actConn, s.live)}>
      <span className={s.cdot} />
      Live
    </span>
  )

const ActivityRow = ({ e, wfLabel }: { e: ActivityEntry; wfLabel: string }) => (
  <div className={s.actRow}>
    <span className={clsx(s.actMarker, s[camelize('mk-' + markOf(e.kind))])} />
    <div className={s.actRowBody}>
      <div className={s.actRowMeta}>
        <span className={s.actTime}>{fmtTime(e.ts)}</span>
        <span className={s.actDotSep}>·</span>
        <span className={s.actChipWf}>{wfLabel}</span>
        <span className={s.actDotSep}>·</span>
        <span className={s.actAgent}>{agentName(e.agentId)}</span>
      </div>
      <div className={s.actRowSummary}>{e.summary}</div>
    </div>
  </div>
)

type TraceGroupData = { key: string; item: string; workflow: string; events: ActivityEntry[] }

const TraceGroup = ({ group, wfLabel }: { group: TraceGroupData; wfLabel: string }) => {
  const [open, setOpen] = useState(true)
  return (
    <div className={s.traceGroup}>
      <button
        className={clsx(s.traceGhead, !open && s.collapsed)}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name='chevron' className={s.tgChev} size={14} />
        <span className={s.tgItem}>{group.item.slice(0, 8)}</span>
        <span className={s.tgWf}>{wfLabel}</span>
        <span className={s.traceGcount}>{group.events.length} events</span>
      </button>
      {open && (
        <div className={s.traceLines}>
          {group.events.map((e, i) => (
            <div className={s.traceLine} key={i}>
              <span className={s.traceSeq}>#{i + 1}</span>
              <span className={clsx(s.traceType, s[camelize('tt-' + e.kind)])}>{e.kind}</span>
              <span className={s.traceDetail}>{e.summary}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export const ActivityPanel = ({ open, dev, feed, workflows, onClose }: ActivityPanelProps) => {
  const { events, connection } = feed
  const [mode, setMode] = useState<'activity' | 'trace'>('activity')
  const [wfFilter, setWfFilter] = useState('all')
  const [kindFilter, setKindFilter] = useState('all')
  const [following, setFollowing] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  const isTrace = dev && mode === 'trace'
  const labelOf = (id: string): string => workflows.find((w) => w.id === id)?.label ?? id

  let list = events
  if (wfFilter !== 'all') list = list.filter((e) => e.workflowId === wfFilter)
  if (kindFilter !== 'all') list = list.filter((e) => e.kind === kindFilter)

  // auto-follow the tail while pinned to the bottom
  useEffect(() => {
    if (!open || !following) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [events, open, following, mode, wfFilter, kindFilter])

  // Scrolling up pauses auto-follow so the live tail doesn't yank the operator down.
  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 48)
  }

  // group for the trace view (by work item, insertion order preserved)
  const groups: TraceGroupData[] = []
  if (isTrace) {
    const byItem: Record<string, TraceGroupData> = {}
    for (const e of list) {
      const k = e.workItemId
      if (!byItem[k]) {
        byItem[k] = { key: k, item: e.workItemId, workflow: e.workflowId, events: [] }
        groups.push(byItem[k])
      }
      byItem[k].events.push(e)
    }
  }

  const empty = list.length === 0
  const header = (
    <>
      <span className={s.actTitle}>
        <Icon name='activity' size={17} />
        {isTrace ? 'Trace' : 'Activity'}
      </span>
      {dev && (
        <Segmented
          variant='seg'
          ariaLabel='View'
          value={mode}
          onChange={setMode}
          options={[
            { value: 'activity', label: 'Activity' },
            { value: 'trace', label: 'Trace' },
          ]}
        />
      )}
      <span className={s.actHeadSpacer} />
      <ConnChip connection={connection} />
    </>
  )

  return (
    <Drawer
      open={open}
      onClose={onClose}
      ariaLabel={isTrace ? 'Trace log' : 'Activity log'}
      // `is-trace` is a Drawer-shell variant hook with no rule today — kept as a
      // harmless literal to preserve the existing DOM (no styling change).
      className={isTrace ? 'is-trace' : ''}
      header={header}
    >
      <div className={s.actFilters}>
        <Icon name='filter' className={s.actFilterIco} size={15} />
        <select
          className={s.actSelect}
          value={wfFilter}
          onChange={(e) => setWfFilter(e.target.value)}
          aria-label='Filter by workflow'
        >
          <option value='all'>All workflows</option>
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.label}
            </option>
          ))}
        </select>
        <select
          className={s.actSelect}
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          aria-label='Filter by event kind'
        >
          <option value='all'>All events</option>
          <option value='running'>Running</option>
          <option value='gate'>Awaiting approval</option>
          <option value='finished'>Finished</option>
          <option value='error'>Failed</option>
          <option value='cancelled'>Cancelled</option>
        </select>
      </div>

      <div className={clsx(s.actFeed, isTrace && s.traceFeed)} ref={scrollRef} onScroll={onScroll}>
        {empty ? (
          <div className={s.actEmpty}>
            <Icon name='activity' size={26} style={{ opacity: 0.4 }} />
            <div className={s.actEmptyTitle}>No activity yet</div>
            <div className={s.actEmptySub}>Events will appear here as your agents work.</div>
          </div>
        ) : isTrace ? (
          groups.map((g) => <TraceGroup key={g.key} group={g} wfLabel={labelOf(g.workflow)} />)
        ) : (
          list.map((e, i) => <ActivityRow key={i} e={e} wfLabel={labelOf(e.workflowId)} />)
        )}
      </div>
    </Drawer>
  )
}
