import { useState } from 'react'
import { instanceId } from '@atizar/core'
import {
  AppHeader,
  PipelineColumn,
  AgentGrid,
  InstanceView,
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
  useResetController,
  buildPipeline,
  queuedByAgent,
  aggregateAgent,
  isDevMode,
  renderableNamesFor,
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
  const { deliver } = useDispatch()

  const sel = useWorkflowSelection(config)
  const nav = useBoardNavigation(config, sel.activeWorkflowId)
  const stop = useStopController(sel.activeWorkflowId)
  const reset = useResetController(sel.activeWorkflowId)

  // Observability drawer (mirrors WorkflowBoard.tsx:63,72,360-366) — one state, one feed.
  const [activityOpen, setActivityOpen] = useState(false)
  const feed = useActivity(activityOpen)

  // Tool names that render as generative-UI cards FOR THE ACTIVE WORKFLOW. Anything else is
  // plumbing, hidden from the consumer thread unless dev mode is on. Scoped per workflow so a
  // tool name owned by another workflow does not leak into this thread (registryScope).
  const renderableToolNames: ReadonlySet<string> = renderableNamesFor(config, nav.workflow.id)

  const blocks = buildPipeline(nav.pInstances, queuedByAgent(board.items, nav.workflow.id))
  // ONE source of truth for "how many active": both the pipeline group count and this type-card
  // aggregate collapse Runs into instances by (agentId, key). Aggregating raw work-items here
  // (the old entriesOf) counted Runs, so the card read "2 active" while the pipeline read "1" for
  // the same sender's two drafts. Now both count instances — represented by the head Run.
  const aggOf = (agentId: string) =>
    aggregateAgent(nav.instancesOf(agentId).map((h) => ({ status: h.status, outcome: h.outcome })))
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
        onResetAll={reset.requestResetAll}
        resettingAll={reset.resettingAll}
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
          onResetWorkflow={reset.requestResetWorkflow}
          resettingWorkflow={reset.resettingWorkflow}
        />

        <AgentGrid
          agents={nav.workflow.agents.map((a) => a.agent)}
          meta={config.meta}
          aggOf={aggOf}
          healthOf={healthOf}
          canStart={nav.canStart}
          onStart={nav.startInput}
          onOpen={nav.openAgent}
        />

        {/* Opening any work item opens its INSTANCE (all runs sharing agentId+key) — one
            InstanceView with one RunView per run, whether 1 or N. No count-based branching. */}
        {nav.openItem && (
          <InstanceView
            key={`inst-${nav.stripAgent(nav.openItem)}-${nav.openItem.key}`}
            title={nav.nameOf(nav.stripAgent(nav.openItem))}
            iconName={nav.metaIcon(nav.stripAgent(nav.openItem))}
            status={nav.openHead?.status ?? 'running'}
            outcome={nav.openHead?.outcome}
            description={config.meta[nav.stripAgent(nav.openItem)]?.intro ?? ''}
            workflowId={nav.openItem.workflowId}
            renderableToolNames={renderableToolNames}
            runs={nav.openRuns.map((r) => ({
              id: r.localId,
              notes: nav.notesFor(r.localId),
            }))}
            deliver={deliver}
            onStop={() =>
              nav.openRuns.forEach((r) => {
                if (r.status === 'running' || r.status === 'awaiting_approval')
                  void stop.stopInstance(r.localId)
              })
            }
            onOpenWorkflow={onSelectWorkflow}
            onOpenInstance={nav.setOpenId}
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
              outcome: x.outcome,
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
                : 'Stop this instance?'
          }
          message={
            stop.confirm.kind === 'all'
              ? 'This halts every active item across all workflows. In-flight work is cancelled.'
              : stop.confirm.kind === 'workflow'
                ? `This halts every active item in ${nav.workflow.label}. In-flight work is cancelled.`
                : 'This halts this instance and everything it spawned. In-flight work is cancelled.'
          }
          confirmLabel={
            stop.confirm.kind === 'all'
              ? 'Stop all'
              : stop.confirm.kind === 'workflow'
                ? 'Stop workflow'
                : 'Stop instance'
          }
          onConfirm={() => void stop.confirmStop()}
          onCancel={stop.cancelConfirm}
        />
      )}

      {reset.confirm && (
        <ConfirmDialog
          title={reset.confirm.kind === 'all' ? 'Reset all workflows?' : 'Reset this workflow?'}
          message={
            `This stops and clears all ${reset.confirm.count} ` +
            `item${reset.confirm.count === 1 ? '' : 's'} ` +
            `in ${reset.confirm.kind === 'all' ? 'all workflows' : nav.workflow.label}, ` +
            'including any that are still running. They move to Activity (nothing is deleted).'
          }
          confirmLabel={reset.confirm.kind === 'all' ? 'Reset all' : 'Reset workflow'}
          onConfirm={() => void reset.confirmReset()}
          onCancel={reset.cancelConfirm}
        />
      )}
    </div>
  )
}
