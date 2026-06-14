import type { AgentDefinition } from '@atizar/core'
import type { WorkItem } from './serverTypes'
import type { WorkflowsConfig } from './workflowsContext'

// Pure per-agent chrome lookups derived from the workflows config + the active workflow id.
// Extracted verbatim from WorkflowBoard.tsx:76,87-97 — behavior-identical, testable in isolation.
export const lookups = (config: WorkflowsConfig, activeWorkflowId: string) => {
  const { workflows, meta: META } = config
  const workflow = workflows.find((w) => w.id === activeWorkflowId) ?? workflows[0]

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

  return { workflow, defOf, roleOf, nameOf, metaIcon, stripAgent, labelOf }
}
