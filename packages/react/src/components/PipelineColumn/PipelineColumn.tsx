import { useRef } from 'react'
import type { AgentGroup, Instance, PInstance, PipelineBlock } from '../../pipelineModel'
import type { Status } from '../../status'
import { pillLabel, pillTint } from '../../statusDisplay'
import { testIds } from '../../testIds'
import { LINGER_MS, useLingerSet } from '../../pipelineLinger'
import { Icon } from '../Icon/Icon'
import { CompHeader } from '../../primitives/CompHeader/CompHeader'
import { StopButton } from '../../primitives/StopButton/StopButton'
import { ResetButton } from '../../primitives/ResetButton/ResetButton'
import s from './PipelineColumn.module.scss'

// ---------------------------------------------------------------------------
// Linger snapshot types — the minimal data PipelineColumn needs to re-emit a
// leaf row after buildPipeline drops it from `blocks`.
// ---------------------------------------------------------------------------

/** A snapshot of one leaf row — enough to re-render it with the leaving class. */
type LeafRow =
  | { kind: 'block'; block: PipelineBlock }
  | { kind: 'single'; parentLocalId: string; group: AgentGroup; inst: Instance }
  | { kind: 'inst'; parentLocalId: string; group: AgentGroup; inst: Instance }

type PipelineColumnProps = {
  blocks: PipelineBlock[]
  onOpen: (localId: string) => void
  // Stop one work item (an active instance card). Absent → no per-item Stop.
  onStopItem?: (localId: string) => void
  stoppingItems?: Record<string, boolean>
  // Stop this whole workflow (header control). Disabled when nothing is active.
  onStopWorkflow?: () => void
  workflowActiveCount?: number
  stoppingWorkflow?: boolean
  // Reset this workflow — clear its finished items from the live column. Absent → no Reset.
  onResetWorkflow?: () => void
  resettingWorkflow?: boolean
}

// A work item is stoppable while it is actively occupying the operator (running or
// awaiting a human). idle/done/error are terminal-ish — no Stop.
const isStoppable = (s: Status): boolean => s === 'running' || s === 'awaiting_approval'

// The down-arrow connector from a parent to its children (SVG, matches the design).
const ConnectorDown = () => (
  <div className={s.connectorDown} aria-hidden='true'>
    <svg viewBox='0 0 14 26' width='14' height='26' style={{ overflow: 'visible' }}>
      <line x1='7' y1='0' x2='7' y2='20' stroke='currentColor' strokeWidth='1.6' />
      <path
        d='M3.5 17 7 21l3.5-4'
        fill='none'
        stroke='currentColor'
        strokeWidth='1.6'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  </div>
)

export const PipelineColumn = ({
  blocks,
  onOpen,
  onStopItem,
  stoppingItems = {},
  onStopWorkflow,
  workflowActiveCount = 0,
  stoppingWorkflow = false,
  onResetWorkflow,
  resettingWorkflow = false,
}: PipelineColumnProps) => {
  // -------------------------------------------------------------------------
  // Linger: keep leaf rows mounted (fading) for LINGER_MS after they drop out
  // of `blocks`. Snapshot maps localId → LeafRow for re-rendering leaving rows.
  // -------------------------------------------------------------------------
  const snapshot = useRef<Map<string, LeafRow>>(new Map())

  // Collect all present leaf-row ids from the current blocks.
  const presentIds = new Set<string>()
  for (const block of blocks) {
    if (block.groups.length === 0) {
      // Lone-leaf block: the parent mini IS the leaf.
      presentIds.add(block.parent.localId)
      snapshot.current.set(block.parent.localId, { kind: 'block', block })
    } else {
      // Parent mini with children: the parent is NOT a leaf here (it has children).
      // The leaf rows are the child single/inst entries.
      for (const group of block.groups) {
        const single = group.instances.length === 1 && group.queued === 0
        if (single) {
          const inst = group.instances[0]
          presentIds.add(inst.head.localId)
          snapshot.current.set(inst.head.localId, {
            kind: 'single',
            parentLocalId: block.parent.localId,
            group,
            inst,
          })
        } else {
          for (const inst of group.instances) {
            presentIds.add(inst.head.localId)
            snapshot.current.set(inst.head.localId, {
              kind: 'inst',
              parentLocalId: block.parent.localId,
              group,
              inst,
            })
          }
        }
      }
      // Also snapshot the parent block itself (for child-under-parent reuse).
      snapshot.current.set(block.parent.localId, { kind: 'block', block })
    }
  }

  const { isLeaving, lingering } = useLingerSet(presentIds, LINGER_MS)

  // Build the render list: current blocks + extra blocks/rows for lingering ids.
  // Strategy: start with present blocks (rendered normally), then append lingering
  // rows whose parent block is NOT present (lone-leaf case). Lingering children
  // under a still-present parent are injected in the group render loop below.
  const presentBlockIds = new Set(blocks.map((b) => b.parent.localId))
  const lingeringOrphanBlocks: PipelineBlock[] = []
  for (const id of lingering) {
    const snap = snapshot.current.get(id)
    if (!snap) continue
    if (snap.kind === 'block') {
      // A lone-leaf block or a parent that dropped entirely.
      if (!presentBlockIds.has(id)) {
        lingeringOrphanBlocks.push(snap.block)
      }
      // If the parent is still present, this id was snapped as a block but its
      // children are tracked separately — skip.
    }
    // 'single' / 'inst' under a present parent are handled inline in the JSX loop.
  }
  // The state pill + (when active and a stop handler exists) a per-item Stop button.
  // `.m-state`/`.dot`/the status word stay GLOBAL (shared with AgentCard + the
  // instance picker); the StopButton renders its own (global) `.stop-btn.icon`.
  const stateAndStop = (inst: PInstance) => {
    const stoppable = onStopItem && isStoppable(inst.status)
    return (
      <>
        <span className='m-state'>
          <span className={`dot ${inst.status}`} />
          {pillLabel(inst.status, inst.outcome)}
        </span>
        {stoppable && (
          <StopButton
            scope='item'
            stopping={!!stoppingItems[inst.localId]}
            title='Stop this item'
            onClick={(e) => {
              e.stopPropagation()
              onStopItem(inst.localId)
            }}
          />
        )}
      </>
    )
  }

  // `has-stop`/`is-stopping` are GLOBAL hover-reveal classes (their rules + the
  // `.mini.has-stop .stop-btn.icon` compounds live in styles.css); composed as
  // plain strings alongside the global `mini`/`pl-single`/`pl-inst` + tint classes.
  const stopClasses = (inst: PInstance): string => {
    if (!(onStopItem && isStoppable(inst.status))) return ''
    return ' has-stop' + (stoppingItems[inst.localId] ? ' is-stopping' : '')
  }

  // -------------------------------------------------------------------------
  // JSX helpers — extracted to avoid duplication between present and lingering renders.
  // -------------------------------------------------------------------------

  const renderMiniRow = (parent: PInstance, leaving: boolean) => (
    <div
      className={`mini ${pillTint(parent.status, parent.outcome)}${stopClasses(parent)}${leaving ? ' ' + s.leaving : ''}`}
      data-testid={testIds.pipelineRow(parent.agentId)}
      onClick={() => onOpen(parent.localId)}
    >
      <div className='m-icon'>
        <Icon name={parent.iconName} size={15} />
      </div>
      <div className='m-text'>
        <span className='m-name'>
          {parent.name}
          {parent.label ? ` · ${parent.label}` : ''}
        </span>
      </div>
      {stateAndStop(parent)}
    </div>
  )

  const renderSingleRow = (g: AgentGroup, inst: Instance, leaving: boolean) => {
    const head = inst.head
    return (
      <div
        key={g.agentId}
        className={`pl-single ${pillTint(head.status, head.outcome)}${stopClasses(head)}${leaving ? ' ' + s.leaving : ''}`}
        data-testid={testIds.pipelineRow(head.agentId)}
        onClick={() => onOpen(head.localId)}
      >
        <div className='m-icon'>
          <Icon name={g.iconName} size={15} />
        </div>
        <div className='m-text'>
          <span className='m-name'>
            {g.name}
            {head.label ? ` · ${head.label}` : ''}
            {inst.runs.length > 1 && <span className={s.plRunCount}> · {inst.runs.length}</span>}
          </span>
        </div>
        {stateAndStop(head)}
      </div>
    )
  }

  const renderInstRow = (inst: Instance, leaving: boolean) => {
    const head = inst.head
    return (
      <div key={inst.key} className={s.plKid}>
        <span className={s.plHstub} />
        <div
          className={`pl-inst ${pillTint(head.status, head.outcome)}${stopClasses(head)}${leaving ? ' ' + s.leaving : ''}`}
          data-testid={testIds.pipelineRow(head.agentId)}
          onClick={() => onOpen(head.localId)}
        >
          <span className='pl-iname'>
            {head.label || head.name}
            {inst.runs.length > 1 && <span className={s.plRunCount}> · {inst.runs.length}</span>}
          </span>
          {stateAndStop(head)}
        </div>
      </div>
    )
  }

  // Collect lingering child snapshots keyed by their parent block localId, for injection
  // into still-present parent blocks.
  const lingeringChildrenByParent = new Map<string, LeafRow[]>()
  for (const id of lingering) {
    const snap = snapshot.current.get(id)
    if (!snap) continue
    if (snap.kind === 'single' || snap.kind === 'inst') {
      if (presentBlockIds.has(snap.parentLocalId)) {
        const arr = lingeringChildrenByParent.get(snap.parentLocalId) ?? []
        arr.push(snap)
        lingeringChildrenByParent.set(snap.parentLocalId, arr)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Block renderer — shared by present blocks and lingering orphan blocks.
  // -------------------------------------------------------------------------
  const renderBlock = (block: PipelineBlock, blockIsLeaving: boolean) => {
    const parent = block.parent
    // Collect lingering children for this block (only relevant for present blocks).
    const lingeringKids = lingeringChildrenByParent.get(parent.localId) ?? []

    return (
      <div className={s.plBlock} key={parent.localId}>
        {renderMiniRow(parent, blockIsLeaving && block.groups.length === 0)}

        {(block.groups.length > 0 || lingeringKids.length > 0) && (
          <>
            <ConnectorDown />
            <div className={s.plCont}>
              {block.groups.map((g) => {
                // We group by INSTANCES, not Runs. A single instance of this agent → the
                // flat `pl-single` row (its Run count is shown as a `· N` badge, never as
                // nesting). The group treatment (mini-header + nested instance rows) is ONLY
                // for ≥2 instances. g.queued > 0 also forces it so the `queued: N` badge shows.
                const single = g.instances.length === 1 && g.queued === 0
                if (single) {
                  const inst = g.instances[0]
                  const leaving = isLeaving(inst.head.localId)
                  return renderSingleRow(g, inst, leaving)
                }
                return (
                  <div key={g.agentId} className={s.plGroup}>
                    <div className={s.plAhead}>
                      <div className='m-icon'>
                        <Icon name={g.iconName} size={14} />
                      </div>
                      <span className={s.plAname}>{g.name}</span>
                      <span className={s.plAcount}>{g.instances.length} active</span>
                    </div>
                    <div className={s.plKids}>
                      {g.instances.map((inst) => {
                        // The pipeline draws INSTANCES, never Runs. One instance = one row,
                        // represented by its `head` (single-source status, via PRIORITY in
                        // pipelineModel — never re-derived here). An instance holding several
                        // Runs (one sender, several drafts) shows a `· N` count; opening the
                        // row loads ALL its Runs in one InstanceView. No Run is nested.
                        const leaving = isLeaving(inst.head.localId)
                        return renderInstRow(inst, leaving)
                      })}
                    </div>
                    {g.queued > 0 && <p className={s.plQueued}>queued: {g.queued}</p>}
                  </div>
                )
              })}
              {/* Lingering children that dropped out of this block's groups */}
              {lingeringKids.map((snap) => {
                if (snap.kind === 'single') return renderSingleRow(snap.group, snap.inst, true)
                if (snap.kind === 'inst') return renderInstRow(snap.inst, true)
                return null
              })}
            </div>
          </>
        )}
      </div>
    )
  }

  // Empty state: no present blocks AND nothing lingering.
  const isEmpty = blocks.length === 0 && lingeringOrphanBlocks.length === 0

  return (
    <div className={s.pipelineCol}>
      <CompHeader
        icon='pipeline'
        label='Pipeline'
        actions={
          (onResetWorkflow || onStopWorkflow) && (
            <span className={s.pipeActions}>
              {/* Icon-only in the narrow 296px Pipeline header (tooltips carry the meaning);
                  the labelled affordance lives in the top bar's "Reset all" / "Stop all". */}
              {onResetWorkflow && (
                <ResetButton
                  scope='workflow'
                  data-testid={testIds.resetWorkflow}
                  resetting={resettingWorkflow}
                  onClick={onResetWorkflow}
                  title='Reset this workflow — stop and clear everything (running items included)'
                />
              )}
              {onStopWorkflow && (
                <StopButton
                  scope='workflow'
                  data-testid={testIds.stopWorkflow}
                  disabled={workflowActiveCount === 0}
                  stopping={stoppingWorkflow}
                  onClick={onStopWorkflow}
                  title='Stop every active item in this workflow'
                />
              )}
            </span>
          )
        }
      />

      <div className={s.pipelineBody}>
        {isEmpty ? (
          <p className={s.pipeEmpty}>No agent is running yet. Launched agents appear here.</p>
        ) : (
          <>
            {blocks.map((block) => renderBlock(block, false))}
            {lingeringOrphanBlocks.map((block) => renderBlock(block, true))}
          </>
        )}
      </div>

      <div className={s.tintLegend}>
        <span className='ti'>
          <span className='sw run' />
          Running
        </span>
        <span className='ti'>
          <span className='sw await' />
          Awaiting approval
        </span>
        <span className='ti'>
          <span className='sw err' />
          Needs attention
        </span>
        <span className='ti'>
          <span className='sw idle' />
          Idle
        </span>
      </div>
    </div>
  )
}
