import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { Drawer } from '../primitives/Drawer'
import { Segmented } from '../primitives/Segmented'
import type { ActivityEntry } from '../serverTypes'
import type { ActivityFeed } from '../hooks/useActivity'

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
    <span className='act-conn reconnecting'>
      <span className='cspin' />
      Reconnecting…
    </span>
  ) : (
    <span className='act-conn live'>
      <span className='cdot' />
      Live
    </span>
  )

const ActivityRow = ({ e, wfLabel }: { e: ActivityEntry; wfLabel: string }) => (
  <div className='act-row'>
    <span className={'act-marker mk-' + markOf(e.kind)} />
    <div className='act-row-body'>
      <div className='act-row-meta'>
        <span className='act-time'>{fmtTime(e.ts)}</span>
        <span className='act-dot-sep'>·</span>
        <span className='act-chip-wf'>{wfLabel}</span>
        <span className='act-dot-sep'>·</span>
        <span className='act-agent'>{agentName(e.agentId)}</span>
      </div>
      <div className='act-row-summary'>{e.summary}</div>
    </div>
  </div>
)

type TraceGroupData = { key: string; item: string; workflow: string; events: ActivityEntry[] }

const TraceGroup = ({ group, wfLabel }: { group: TraceGroupData; wfLabel: string }) => {
  const [open, setOpen] = useState(true)
  return (
    <div className='trace-group'>
      <button
        className={'trace-ghead' + (open ? '' : ' collapsed')}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name='chevron' className='tg-chev' size={14} />
        <span className='tg-item'>{group.item.slice(0, 8)}</span>
        <span className='tg-wf'>{wfLabel}</span>
        <span className='trace-gcount'>{group.events.length} events</span>
      </button>
      {open && (
        <div className='trace-lines'>
          {group.events.map((e, i) => (
            <div className='trace-line' key={i}>
              <span className='trace-seq'>#{i + 1}</span>
              <span className={'trace-type tt-' + e.kind}>{e.kind}</span>
              <span className='trace-detail'>{e.summary}</span>
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
      <span className='act-title'>
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
      <span className='act-head-spacer' />
      <ConnChip connection={connection} />
    </>
  )

  return (
    <Drawer
      open={open}
      onClose={onClose}
      ariaLabel={isTrace ? 'Trace log' : 'Activity log'}
      className={isTrace ? 'is-trace' : ''}
      header={header}
    >
      <div className='act-filters'>
        <Icon name='filter' className='act-filter-ico' size={15} />
        <select
          className='act-select'
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
          className='act-select'
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

      <div
        className={'act-feed' + (isTrace ? ' trace-feed' : '')}
        ref={scrollRef}
        onScroll={onScroll}
      >
        {empty ? (
          <div className='act-empty'>
            <Icon name='activity' size={26} style={{ opacity: 0.4 }} />
            <div className='act-empty-title'>No activity yet</div>
            <div className='act-empty-sub'>Events will appear here as your agents work.</div>
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
