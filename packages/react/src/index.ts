// @platform/react — the server-driven board/thread UI machinery (chrome, hooks, render
// dispatch, theme). Vertical CARDS live in userland; this package never imports one — it
// receives them via the injected WorkflowsConfig (typed render/HITL specs that reference
// their card components directly).
export { WorkflowBoard } from './WorkflowBoard.js'
export { WorkflowsProvider, useWorkflowsConfig } from './workflowsContext.js'
export type { WorkflowsConfig } from './workflowsContext.js'
export type { AgentMeta, DeliverFn, RenderSpec, HitlSpec } from './renderSpecs.js'
export { buildRenderToolCall } from './buildRenderToolCall.js'
export { ThreadResultsContext, useThreadResult } from './threadResults.js'
export { Icon } from './components/Icon.js'
export type { IconName } from './components/Icon.js'
// UI primitives (token-driven, extensible — spread native attrs + merge className).
export { Button, type ButtonVariant } from './primitives/Button.js'
export { StopButton, type StopScope } from './primitives/StopButton.js'
export { IconButton } from './primitives/IconButton.js'
export { CompHeader } from './primitives/CompHeader.js'
export { Drawer } from './primitives/Drawer.js'
export { Modal } from './primitives/Modal.js'
export { ConfirmDialog } from './primitives/ConfirmDialog.js'
export { Segmented } from './primitives/Segmented.js'
export { Switch } from './primitives/Switch.js'
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
