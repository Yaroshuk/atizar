import { createContext, useContext, type ReactNode } from 'react'
import type { WorkflowDescriptor } from '@atizar/core'
import type { AgentMeta, RenderSpec, HitlSpec } from './renderSpecs'

// The userland-supplied bundle: descriptors + per-agent chrome meta + render/HITL specs.
// Injected once at the board root; RunView + buildRenderToolCall read it from context.
export type WorkflowsConfig = {
  workflows: WorkflowDescriptor[]
  meta: Record<string, AgentMeta>
  renders: RenderSpec[]
  hitl: HitlSpec[]
  // Optional shared bearer token; merged into every mutation fetch. Unset in dev/demo. The
  // demo app sources it from VITE_ATIZAR_AUTH_TOKEN — the package stays env-agnostic.
  authToken?: string
}

const WorkflowsContext = createContext<WorkflowsConfig | null>(null)

export const WorkflowsProvider = ({
  config,
  children,
}: {
  config: WorkflowsConfig
  children: ReactNode
}) => <WorkflowsContext.Provider value={config}>{children}</WorkflowsContext.Provider>

export const useWorkflowsConfig = (): WorkflowsConfig => {
  const ctx = useContext(WorkflowsContext)
  if (!ctx) throw new Error('useWorkflowsConfig must be used within a WorkflowsProvider')
  return ctx
}
