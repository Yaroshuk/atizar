import { useEffect, useRef, useState } from 'react'
import { instanceId, type AgentDefinition } from '@platform/core'
import { useBoard } from './hooks/useBoard'
import { useDispatch } from './hooks/useDispatch'
import { useActivity } from './hooks/useActivity'
import { useHealth } from './hooks/useHealth'
import { toPInstances, queuedByAgent, statusesOf } from './boardModel'
import { aggregateAgent, aggregateLabel } from './aggregate'
import { buildPipeline } from './pipelineModel'
import { isDevMode } from './devMode'
import { AgentCard } from './components/AgentCard'
import { AgentModal, type HandoffNote } from './components/AgentModal'
import { ThreadModal } from './components/ThreadModal'
import { InstancePickerModal } from './components/InstancePickerModal'
import { PipelineColumn } from './components/PipelineColumn'
import { AppHeader } from './components/AppHeader'
import { ActivityPanel } from './components/ActivityPanel'
import { CompHeader } from './primitives/CompHeader'
import { ConfirmDialog } from './primitives/ConfirmDialog'
import type { ServerStatus, WorkItem } from './serverTypes'
import { WorkflowsProvider, type WorkflowsConfig } from './workflowsContext'

// Server statuses that count as "active" (occupying the operator / a worker slot) —
// what Stop halts and what the badges count.
const ACTIVE_SERVER: ReadonlySet<ServerStatus> = new Set([
  'queued',
  'running',
  'awaiting_approval',
  'awaiting_input',
])

// A cross-workflow child = a work item whose parent lives in a DIFFERENT workflow (a
// delivery via a published contract). Powers the per-workflow "new arrivals" badge.
const isCrossWorkflowChild = (w: WorkItem, parentOf: (id: string) => WorkItem | undefined) => {
  if (!w.parentId) return false
  const parent = parentOf(w.parentId)
  return parent !== undefined && parent.workflowId !== w.workflowId
}

// Every Stop scope confirms before halting in-flight work.
type Confirm = { kind: 'item'; id: string } | { kind: 'workflow' } | { kind: 'all' } | null

const BoardInner = ({ config, demo }: { config: WorkflowsConfig; demo?: boolean }) => {
  const { workflows, meta: META, renders: renderSpecs, hitl: hitlSpecs } = config
  const board = useBoard()
  const { start, deliver, cancel, cancelWorkflow, cancelAll } = useDispatch()

  // Tool names that render as generative-UI cards. Anything else (list_my_tickets,
  // get_latest_email, …) is plumbing, hidden from the consumer thread unless dev mode is on.
  const renderableToolNames: ReadonlySet<string> = new Set([
    ...renderSpecs.map((s) => s.toolName),
    ...hitlSpecs.map((s) => s.toolName),
  ])

  const [activeWorkflowId, setActiveWorkflowId] = useState(workflows[0].id)
  // The URL carries the open work item id so a reload re-attaches to the same thread.
  const [openId, setOpenId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('open')
  )
  const [openTypeId, setOpenTypeId] = useState<string | null>(null) // an agent id (no live item)
  const [openPickerId, setOpenPickerId] = useState<string | null>(null) // an agent id (≥2 items)
  // Observability drawer + Stop confirmation.
  const [activityOpen, setActivityOpen] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  // In-flight Stop state (per item + the two bulk scopes), for the stopping… spinner.
  const [stoppingItems, setStoppingItems] = useState<Record<string, boolean>>({})
  const [stoppingWorkflow, setStoppingWorkflow] = useState(false)
  const [stoppingAll, setStoppingAll] = useState(false)
  // Ids of cross-workflow children already seen (badge clears on switching to that workflow).
  const seenRef = useRef<Set<string>>(new Set())

  const activityFeed = useActivity(activityOpen)
  const health = useHealth()

  const itemById = (id: string): WorkItem | undefined => board.items.find((w) => w.id === id)
  const workflow = workflows.find((w) => w.id === activeWorkflowId) ?? workflows[0]

  // Persist the open id into the URL (so a reload re-attaches; survives the SSE re-subscribe).
  useEffect(() => {
    const url = new URL(window.location.href)
    if (openId) url.searchParams.set('open', openId)
    else url.searchParams.delete('open')
    window.history.replaceState(null, '', url)
  }, [openId])

  // Per-agent chrome lookups (by stripped agent id).
  const defOf = (wfId: string, agentId: string): AgentDefinition | undefined =>
    workflows.find((w) => w.id === wfId)?.agents.find((a) => a.agent.id === agentId)?.agent
  const roleOf = (agentId: string) => workflow.agents.find((a) => a.agent.id === agentId)?.role
  const nameOf = (agentId: string) => defOf(workflow.id, agentId)?.name ?? agentId
  const metaIcon = (agentId: string) => META[agentId]?.iconName ?? 'inbox'
  const stripAgent = (w: WorkItem) => w.agentId.slice(w.workflowId.length + 2)
  const labelOf = (w: WorkItem): string => {
    const p = w.payload as { number?: number; title?: string; subject?: string; from?: string }
    if (typeof p.number === 'number') return `#${p.number}${p.title ? ` · ${p.title}` : ''}`
    return p.from ?? p.subject ?? ''
  }
  // Board → pipeline (server-authoritative; cap/queue live server-side now).
  const pInstances = toPInstances(board.items, workflow.id, roleOf, metaIcon, nameOf, labelOf)
  const blocks = buildPipeline(pInstances, queuedByAgent(board.items, workflow.id))

  const canStart = (agentId: string) => roleOf(agentId) === 'input'
  const liveOf = (agentId: string) => pInstances.filter((p) => p.agentId === agentId)
  const aggOf = (agentId: string) => aggregateAgent(statusesOf(board.items, workflow.id, agentId))
  // Prefer the freshly-fetched health (updates on connect/disconnect); fall back to the
  // board snapshot's boot cache only until the first /api/health resolves.
  const healthOf = (agentId: string) =>
    health[instanceId(workflow.id, agentId)] ?? board.agentHealth[instanceId(workflow.id, agentId)]

  // Cross-workflow unread badges (count fresh cross-workflow children per non-active workflow).
  const unread: Record<string, number> = {}
  for (const w of board.items) {
    if (w.workflowId === activeWorkflowId) continue
    if (isCrossWorkflowChild(w, itemById) && !seenRef.current.has(w.id)) {
      unread[w.workflowId] = (unread[w.workflowId] ?? 0) + 1
    }
  }

  // Stop scope counts (queued/running/awaiting count as active).
  const globalActive = board.items.filter((w) => ACTIVE_SERVER.has(w.status)).length
  const workflowActiveCount = board.items.filter(
    (w) => w.workflowId === activeWorkflowId && ACTIVE_SERVER.has(w.status)
  ).length

  // Launch an input agent: dispatch a fresh run (it reads the inbox itself), open its thread.
  const startInput = (agentDef: AgentDefinition): void => {
    void start(instanceId(workflow.id, agentDef.id)).then((id) => {
      setOpenTypeId(null)
      setOpenId(id)
    })
  }

  // Open an agent by count of its visible items: 0 → type view (intro + START); 1 → its
  // thread; ≥2 → an instance picker (the human picks a copy).
  const openAgent = (agentId: string): void => {
    const live = liveOf(agentId)
    setOpenTypeId(null)
    setOpenPickerId(null)
    setOpenId(null)
    if (live.length === 0) setOpenTypeId(agentId)
    else if (live.length === 1) setOpenId(live[0].localId)
    else setOpenPickerId(agentId)
  }

  const switchWorkflow = (id: string): void => {
    // Mark this workflow's current cross-workflow children as seen (clears its badge).
    for (const w of board.items) {
      if (w.workflowId === id && isCrossWorkflowChild(w, itemById)) seenRef.current.add(w.id)
    }
    setOpenId(null)
    setOpenTypeId(null)
    setOpenPickerId(null)
    setActiveWorkflowId(id)
  }

  // --- Stop (all three scopes confirm first via the modal) ---
  const confirmStop = async (): Promise<void> => {
    if (!confirm) return
    if (confirm.kind === 'item') {
      const { id } = confirm
      setStoppingItems((m) => ({ ...m, [id]: true }))
      setConfirm(null)
      await cancel(id)
      setStoppingItems((m) => {
        const rest = { ...m }
        delete rest[id]
        return rest
      })
      return
    }
    if (confirm.kind === 'workflow') {
      setStoppingWorkflow(true)
      await cancelWorkflow(activeWorkflowId)
      setStoppingWorkflow(false)
    } else {
      setStoppingAll(true)
      await cancelAll()
      setStoppingAll(false)
    }
    setConfirm(null)
  }

  // Handoff notes for the open item, DERIVED from board topology (no client deliver state):
  // a 'received' note from the item's parent, a 'sent' note per child.
  const notesFor = (id: string): HandoffNote[] => {
    const item = itemById(id)
    if (!item) return []
    const notes: HandoffNote[] = []
    if (item.parentId) {
      const parent = itemById(item.parentId)
      if (parent)
        notes.push({
          dir: 'received',
          otherName: nameOf(parent.agentId.slice(parent.workflowId.length + 2)),
          label: labelOf(item),
        })
    }
    for (const child of board.items.filter((w) => w.parentId === id)) {
      const childAgent = child.agentId.slice(child.workflowId.length + 2)
      notes.push({
        dir: 'sent',
        otherName: nameOf(childAgent),
        label: labelOf(child),
        targetWorkflow: child.workflowId !== workflow.id ? child.workflowId : undefined,
        targetLocalId: child.workflowId === workflow.id ? child.id : undefined,
      })
    }
    return notes
  }

  // Resolve what the open id points at (it may have left the board after finishing).
  const openItem = openId ? itemById(openId) : undefined
  const openTypeAgent = openTypeId ? defOf(workflow.id, openTypeId) : undefined
  const pickerInstances = openPickerId ? liveOf(openPickerId) : []

  return (
    <div className='app'>
        <AppHeader
          workflows={workflows}
          activeId={activeWorkflowId}
          unread={unread}
          onSelect={switchWorkflow}
          globalActive={globalActive}
          stoppingAll={stoppingAll}
          onStopAll={() => setConfirm({ kind: 'all' })}
          activityOpen={activityOpen}
          onToggleActivity={() => setActivityOpen((v) => !v)}
          demo={demo}
        />

        <div className='workspace-body'>
          <PipelineColumn
            blocks={blocks}
            onOpen={setOpenId}
            onStopItem={(id) => setConfirm({ kind: 'item', id })}
            stoppingItems={stoppingItems}
            onStopWorkflow={() => setConfirm({ kind: 'workflow' })}
            workflowActiveCount={workflowActiveCount}
            stoppingWorkflow={stoppingWorkflow}
          />

          <div className='main'>
            <CompHeader
              icon='layers'
              label='Your agents'
              actions={
                <span className='legend'>
                  <span className='legend-item'>
                    <span className='dot idle' />
                    Idle
                  </span>
                  <span className='legend-item'>
                    <span className='dot done' />
                    Running / done
                  </span>
                  <span className='legend-item'>
                    <span className='dot awaiting_approval' />
                    Awaiting approval
                  </span>
                </span>
              }
            />
            <div className='main-scroll'>
              <div className='agent-grid'>
                {workflow.agents.map(({ agent }) => {
                  const agg = aggOf(agent.id)
                  // A singleton (maxInstances 1) blocks a second human START only while it has a
                  // genuinely ACTIVE item — matches the server's F6 409 (a done/idle copy is
                  // re-launchable). Derive from board status, NOT the kept-pipeline view (which
                  // forces a finished input agent to display as Working).
                  const singletonBusy =
                    agent.maxInstances === 1 &&
                    board.items.some(
                      (w) =>
                        w.workflowId === workflow.id &&
                        stripAgent(w) === agent.id &&
                        ACTIVE_SERVER.has(w.status)
                    )
                  return (
                    <AgentCard
                      key={agent.id}
                      name={agent.name}
                      subtitle={META[agent.id].subtitle}
                      iconName={META[agent.id].iconName}
                      status={agg.status}
                      aggregateLabel={aggregateLabel(agg)}
                      canStart={canStart(agent.id)}
                      health={healthOf(agent.id)}
                      startDisabled={singletonBusy}
                      startDisabledReason={singletonBusy ? 'Already running' : undefined}
                      onStart={() => startInput(agent)}
                      onOpen={() => openAgent(agent.id)}
                    />
                  )
                })}
              </div>
            </div>
          </div>

          {openItem && (
            <ThreadModal
              key={openItem.id}
              id={openItem.id}
              title={nameOf(stripAgent(openItem))}
              iconName={metaIcon(stripAgent(openItem))}
              intro={META[stripAgent(openItem)]?.intro ?? ''}
              canStart={canStart(stripAgent(openItem))}
              renderableToolNames={renderableToolNames}
              notes={notesFor(openItem.id)}
              deliver={deliver}
              onStop={(cid) => void cancel(cid)}
              onOpenWorkflow={switchWorkflow}
              onOpenInstance={setOpenId}
              onStart={() => {
                const def = defOf(workflow.id, stripAgent(openItem))
                if (def) startInput(def)
              }}
              onClose={() => setOpenId(null)}
            />
          )}

          {/* Type view: an idle agent (no live item) — its intro + START. */}
          {!openItem && openTypeAgent && (
            <AgentModal
              agent={{ messages: [] }}
              title={openTypeAgent.name}
              iconName={META[openTypeAgent.id].iconName}
              status='idle'
              renderToolCall={() => null}
              renderableToolNames={renderableToolNames}
              loading={false}
              canStart={canStart(openTypeAgent.id)}
              intro={META[openTypeAgent.id].intro}
              notes={[]}
              onStart={() => startInput(openTypeAgent)}
              onClose={() => setOpenTypeId(null)}
            />
          )}

          {/* Picker: an agent running ≥2 instances → a card per instance. */}
          {openPickerId && pickerInstances.length >= 2 && (
            <InstancePickerModal
              title={pickerInstances[0].name}
              iconName={pickerInstances[0].iconName}
              instances={pickerInstances.map((x) => ({
                localId: x.localId,
                label: x.label,
                name: x.name,
                status: x.status,
              }))}
              onOpenInstance={(localId) => {
                setOpenPickerId(null)
                setOpenId(localId)
              }}
              onClose={() => setOpenPickerId(null)}
            />
          )}
        </div>

        <ActivityPanel
          open={activityOpen}
          dev={isDevMode}
          feed={activityFeed}
          workflows={workflows.map((w) => ({ id: w.id, label: w.label }))}
          onClose={() => setActivityOpen(false)}
        />

        {confirm && (
          <ConfirmDialog
            title={
              confirm.kind === 'all'
                ? 'Stop all workflows?'
                : confirm.kind === 'workflow'
                  ? 'Stop this workflow?'
                  : 'Stop this item?'
            }
            message={
              confirm.kind === 'all'
                ? 'This halts every active item across all workflows. In-flight work is cancelled.'
                : confirm.kind === 'workflow'
                  ? `This halts every active item in ${workflow.label}. In-flight work is cancelled.`
                  : 'This halts this work item. In-flight work is cancelled.'
            }
            confirmLabel={
              confirm.kind === 'all'
                ? 'Stop all'
                : confirm.kind === 'workflow'
                  ? 'Stop workflow'
                  : 'Stop item'
            }
            onConfirm={() => void confirmStop()}
            onCancel={() => setConfirm(null)}
          />
        )}
      </div>
  )
}

export const WorkflowBoard = ({ config, demo }: { config: WorkflowsConfig; demo?: boolean }) => (
  <WorkflowsProvider config={config}>
    <BoardInner config={config} demo={demo} />
  </WorkflowsProvider>
)
