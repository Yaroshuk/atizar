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
// Headless hooks (the data layer — build your own UI without forking).
export { useBoard } from './hooks/useBoard.js'
export { useDispatch } from './hooks/useDispatch.js'
export { useGate } from './hooks/useGate.js'
export { useWorkItemThread } from './hooks/useWorkItemThread.js'
export { useConnections } from './hooks/useConnections.js'
export type { ConnectionStatus } from './hooks/useConnections.js'
export { Connections } from './components/Connections.js'
export { ConnectionChip } from './components/ConnectionChip.js'
