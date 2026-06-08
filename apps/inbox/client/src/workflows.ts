import type { ComponentType } from 'react'
import type { WorkflowDescriptor } from '@platform/core'
import { workflowDescriptors } from '../../workflows'
import type { AgentMeta, RenderSpec, HitlSpec } from './renderSpecs'
import { leadInboxMeta, leadInboxRenders, leadInboxHitl } from '../../workflows/lead-inbox/client'
import { githubTriageMeta, githubTriageRenders } from '../../workflows/github-triage/client'

export type { AgentMeta }

// Optional per-workflow view override; default shell view is used when absent.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WorkflowView = ComponentType<any>

export const workflows: WorkflowDescriptor[] = workflowDescriptors

// Client chrome, keyed by agent id, merged across modules (ids are globally unique).
export const META: Record<string, AgentMeta> = { ...leadInboxMeta, ...githubTriageMeta }

// Render specs, deduped by tool name (a reused agent registers its render only once).
const allRenders: RenderSpec[] = [...leadInboxRenders, ...githubTriageRenders]
const allHitl: HitlSpec[] = [...leadInboxHitl]
const byName = <T extends { toolName: string }>(specs: T[]): T[] => {
  const seen = new Set<string>()
  return specs.filter((s) => (seen.has(s.toolName) ? false : (seen.add(s.toolName), true)))
}
export const renderSpecs: RenderSpec[] = byName(allRenders)
export const hitlSpecs: HitlSpec[] = byName(allHitl)

// Optional view overrides per workflow id (none yet — all use the shared two-panel view).
export const workflowViews: Record<string, WorkflowView> = {}
