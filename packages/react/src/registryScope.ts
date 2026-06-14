import type { WorkflowsConfig } from './workflowsContext'

// Render/HITL resolution is scoped by (workflowId, toolName), mirroring how the SERVER scopes
// effects per agent-runtime. The package holds no card knowledge — these are pure filters over
// the userland-injected, workflow-keyed specs.

// The specs belonging to one workflow (a render OR hitl list filtered by workflowId).
export const byWorkflow = <T extends { workflowId: string }>(specs: T[], workflowId: string): T[] =>
  specs.filter((s) => s.workflowId === workflowId)

// The tool names that render as generative-UI cards FOR ONE WORKFLOW (render + HITL union).
// AgentModal hides any tool not in this set (unless dev mode). Scoped so a tool name owned by
// a different workflow does not leak into this workflow's thread.
export const renderableNamesFor = (
  config: Pick<WorkflowsConfig, 'renders' | 'hitl'>,
  workflowId: string
): ReadonlySet<string> =>
  new Set<string>([
    ...byWorkflow(config.renders, workflowId).map((s) => s.toolName),
    ...byWorkflow(config.hitl, workflowId).map((s) => s.toolName),
  ])
