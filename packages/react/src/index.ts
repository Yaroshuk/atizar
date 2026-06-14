// @atizar/react — the server-driven board/thread UI machinery (chrome, hooks, render
// dispatch, theme). Vertical CARDS live in userland; this package never imports one — it
// receives them via the injected WorkflowsConfig (typed render/HITL specs that reference
// their card components directly).
// Side-effect import of the global stylesheet (reset + layout shells + token aliases; it in turn
// `@import`s ./tokens.css for the token defaults) so the published library build bundles it into
// the emitted dist CSS. The demo also imports `@atizar/react/styles.css` directly — a harmless,
// deduped double-import. Per-component `*.module.scss` is auto-collected by Vite.
import './styles.css'
export { WorkflowsProvider, useWorkflowsConfig } from './workflowsContext.js'
// Composition blocks — the board's panels, now exported so userland can compose its own
// board (see apps/inbox/client/src/BoardApp.tsx).
export { PipelineColumn } from './components/PipelineColumn.js'
export { AgentCard } from './components/AgentCard.js'
export { AgentGrid } from './components/AgentGrid.js'
export { AgentModal } from './components/AgentModal.js'
export { ThreadModal } from './components/ThreadModal.js'
export { InstancePickerModal } from './components/InstancePickerModal.js'
export { WorkflowSwitcher } from './components/WorkflowSwitcher.js'
// Orchestration hooks (board selection / navigation / stop) + pure helpers — extracted
// from the former monolith so a custom board reproduces its behavior.
export { useWorkflowSelection } from './hooks/useWorkflowSelection.js'
export { useBoardNavigation, type HandoffNote } from './hooks/useBoardNavigation.js'
export { useStopController } from './hooks/useStopController.js'
export { lookups } from './lookups.js'
export { buildPipeline } from './pipelineModel.js'
export { toPInstances, queuedByAgent, statusesOf } from './boardModel.js'
export { aggregateAgent, aggregateLabel } from './aggregate.js'
export { isDevMode } from './devMode.js'
export type { WorkflowsConfig } from './workflowsContext.js'
export type { AgentMeta, DeliverFn, RenderSpec, HitlSpec } from './renderSpecs.js'
export { buildRenderToolCall } from './buildRenderToolCall.js'
export { ThreadResultsContext, useThreadResult } from './threadResults.js'
export { authHeaders } from './authHeaders.js'
export { Icon } from './components/Icon.js'
export type { IconName } from './components/Icon.js'
// UI primitives (token-driven, extensible — spread native attrs + merge className).
export { Button, type ButtonVariant } from './primitives/Button/Button.js'
export { StopButton, type StopScope } from './primitives/StopButton/StopButton.js'
export { IconButton } from './primitives/IconButton/IconButton.js'
export { CompHeader } from './primitives/CompHeader/CompHeader.js'
export { Drawer } from './primitives/Drawer/Drawer.js'
export { Modal } from './primitives/Modal/Modal.js'
export { ConfirmDialog } from './primitives/ConfirmDialog/ConfirmDialog.js'
export { Segmented } from './primitives/Segmented/Segmented.js'
export { Switch } from './primitives/Switch/Switch.js'
// Chrome components.
export { AppHeader } from './components/AppHeader.js'
export { WorkflowTabs } from './components/WorkflowTabs.js'
export { ActivityPanel } from './components/ActivityPanel.js'
// Headless hooks (the data layer — build your own UI without forking).
export { useBoard } from './hooks/useBoard.js'
export { useDispatch } from './hooks/useDispatch.js'
export { useGate } from './hooks/useGate.js'
export { useWorkItemThread } from './hooks/useWorkItemThread.js'
export { useActivity, type ActivityFeed, type ConnState } from './hooks/useActivity.js'
export { useHealth } from './hooks/useHealth.js'
export { useConnections } from './hooks/useConnections.js'
export type { ConnectionStatus } from './hooks/useConnections.js'
export { Connections } from './components/Connections.js'
export { ConnectionChip } from './components/ConnectionChip.js'
