import { useState } from 'react'
import { instanceId } from '@atizar/core'
import {
  AppHeader,
  PipelineColumn,
  AgentGrid,
  ThreadModal,
  AgentModal,
  InstancePickerModal,
  ActivityPanel,
  ConfirmDialog,
  useBoard,
  useBoardConnection,
  useHealth,
  useActivity,
  useDispatch,
  useWorkflowSelection,
  useBoardNavigation,
  useStopController,
  buildPipeline,
  queuedByAgent,
  statusesOf,
  aggregateAgent,
  isDevMode,
  type WorkflowsConfig,
} from '@atizar/react'

type BoardInnerProps = {
  config: WorkflowsConfig
  demo?: boolean
}

// BoardApp is the reference composition: the former WorkflowBoard monolith, now assembled
// in userland from @atizar/react blocks + orchestration hooks. Behavior- and DOM-identical
// to the old board — the only change is that orchestration comes from the three hooks
// (useWorkflowSelection / useBoardNavigation / useStopController) and the JSX lives here.
export const BoardInner = ({ config, demo }: BoardInnerProps) => {
  const board = useBoard()
  const boardConnection = useBoardConnection()
  const health = useHealth()
  const { deliver, cancel } = useDispatch()

  const sel = useWorkflowSelection(config)
  const nav = useBoardNavigation(config, sel.activeWorkflowId)
  const stop = useStopController(sel.activeWorkflowId)

  // Observability drawer (mirrors WorkflowBoard.tsx:63,72,360-366) — one state, one feed.
  const [activityOpen, setActivityOpen] = useState(false)
  const feed = useActivity(activityOpen)

  // Tool names that render as generative-UI cards. Anything else is plumbing, hidden from
  // the consumer thread unless dev mode is on.
  const renderableToolNames: ReadonlySet<string> = new Set([
    ...config.renders.map((s) => s.toolName),
    ...config.hitl.map((s) => s.toolName),
  ])

  const blocks = buildPipeline(nav.pInstances, queuedByAgent(board.items, nav.workflow.id))
  const aggOf = (agentId: string) =>
    aggregateAgent(statusesOf(board.items, nav.workflow.id, agentId))
  // Prefer the freshly-fetched health (updates on connect/disconnect); fall back to the
  // board snapshot's boot cache only until the first /api/health resolves.
  const healthOf = (agentId: string) =>
    health[instanceId(nav.workflow.id, agentId)] ??
    board.agentHealth[instanceId(nav.workflow.id, agentId)]

  const onSelectWorkflow = (id: string) => {
    sel.switchWorkflow(id)
    nav.reset()
  }

  return (
    <div className='app'>
      <AppHeader
        workflows={config.workflows}
        activeId={sel.activeWorkflowId}
        unread={sel.unread}
        onSelect={onSelectWorkflow}
        globalActive={sel.globalActive}
        stoppingAll={stop.stoppingAll}
        onStopAll={stop.requestStopAll}
        activityOpen={activityOpen}
        onToggleActivity={() => setActivityOpen((v) => !v)}
        demo={demo}
        boardConnection={boardConnection}
      />

      <div className='workspace-body'>
        <PipelineColumn
          blocks={blocks}
          onOpen={nav.setOpenId}
          onStopItem={stop.requestStopItem}
          stoppingItems={stop.stoppingItems}
          onStopWorkflow={stop.requestStopWorkflow}
          workflowActiveCount={sel.workflowActiveCount}
          stoppingWorkflow={stop.stoppingWorkflow}
        />

        <AgentGrid
          agents={nav.workflow.agents.map((a) => a.agent)}
          meta={config.meta}
          items={board.items}
          activeWorkflowId={sel.activeWorkflowId}
          aggOf={aggOf}
          healthOf={healthOf}
          canStart={nav.canStart}
          onStart={nav.startInput}
          onOpen={nav.openAgent}
        />

        {nav.openItem && (
          <ThreadModal
            key={nav.openItem.id}
            id={nav.openItem.id}
            title={nav.nameOf(nav.stripAgent(nav.openItem))}
            iconName={nav.metaIcon(nav.stripAgent(nav.openItem))}
            intro={config.meta[nav.stripAgent(nav.openItem)]?.intro ?? ''}
            canStart={nav.canStart(nav.stripAgent(nav.openItem))}
            renderableToolNames={renderableToolNames}
            notes={nav.notesFor(nav.openItem.id)}
            deliver={deliver}
            onStop={(cid) => void cancel(cid)}
            onOpenWorkflow={onSelectWorkflow}
            onOpenInstance={nav.setOpenId}
            onStart={() => {
              const def = nav.defOf(nav.workflow.id, nav.stripAgent(nav.openItem!))
              if (def) nav.startInput(def)
            }}
            onClose={() => nav.setOpenId(null)}
          />
        )}

        {/* Type view: an idle agent (no live item) — its intro + START. */}
        {!nav.openItem && nav.openTypeAgent && (
          <AgentModal
            agent={{ messages: [] }}
            title={nav.openTypeAgent.name}
            iconName={config.meta[nav.openTypeAgent.id].iconName}
            status='idle'
            renderToolCall={() => null}
            renderableToolNames={renderableToolNames}
            loading={false}
            canStart={nav.canStart(nav.openTypeAgent.id)}
            intro={config.meta[nav.openTypeAgent.id].intro}
            notes={[]}
            onStart={() => nav.startInput(nav.openTypeAgent!)}
            onClose={() => nav.setOpenTypeId(null)}
          />
        )}

        {/* Picker: an agent running ≥2 instances → a card per instance. */}
        {nav.openPickerId && nav.pickerInstances.length >= 2 && (
          <InstancePickerModal
            title={nav.pickerInstances[0].name}
            iconName={nav.pickerInstances[0].iconName}
            instances={nav.pickerInstances.map((x) => ({
              localId: x.localId,
              label: x.label,
              name: x.name,
              status: x.status,
            }))}
            onOpenInstance={(localId) => {
              nav.setOpenPickerId(null)
              nav.setOpenId(localId)
            }}
            onClose={() => nav.setOpenPickerId(null)}
          />
        )}
      </div>

      <ActivityPanel
        open={activityOpen}
        dev={isDevMode}
        feed={feed}
        workflows={config.workflows.map((w) => ({ id: w.id, label: w.label }))}
        onClose={() => setActivityOpen(false)}
      />

      {stop.confirm && (
        <ConfirmDialog
          title={
            stop.confirm.kind === 'all'
              ? 'Stop all workflows?'
              : stop.confirm.kind === 'workflow'
                ? 'Stop this workflow?'
                : 'Stop this item?'
          }
          message={
            stop.confirm.kind === 'all'
              ? 'This halts every active item across all workflows. In-flight work is cancelled.'
              : stop.confirm.kind === 'workflow'
                ? `This halts every active item in ${nav.workflow.label}. In-flight work is cancelled.`
                : 'This halts this work item. In-flight work is cancelled.'
          }
          confirmLabel={
            stop.confirm.kind === 'all'
              ? 'Stop all'
              : stop.confirm.kind === 'workflow'
                ? 'Stop workflow'
                : 'Stop item'
          }
          onConfirm={() => void stop.confirmStop()}
          onCancel={stop.cancelConfirm}
        />
      )}
    </div>
  )
}
