import type { WorkflowsConfig, AgentMeta, RenderSpec, HitlSpec } from '@platform/react'
import { workflowDescriptors } from '../../workflows'
import { leadInboxMeta, leadInboxRenders, leadInboxHitl } from '../../workflows/lead-inbox/client'
import { githubTriageMeta, githubTriageRenders } from '../../workflows/github-triage/client'

// The demo aggregator: merges every workflow client module into one WorkflowsConfig bundle
// (descriptors + per-agent chrome meta + render/HITL specs), deduped by tool name (a reused
// agent registers its render only once), and hands it to <WorkflowBoard config={…} />. This
// is the userland injection point — the package holds no cards or workflow knowledge.
const META: Record<string, AgentMeta> = { ...leadInboxMeta, ...githubTriageMeta }
const byName = <T extends { toolName: string }>(specs: T[]): T[] => {
  const seen = new Set<string>()
  return specs.filter((s) => (seen.has(s.toolName) ? false : (seen.add(s.toolName), true)))
}
const renderSpecs: RenderSpec[] = byName<RenderSpec>([...leadInboxRenders, ...githubTriageRenders])
const hitlSpecs: HitlSpec[] = byName<HitlSpec>([...leadInboxHitl])

export const workflowsConfig: WorkflowsConfig = {
  workflows: workflowDescriptors,
  meta: META,
  renders: renderSpecs,
  hitl: hitlSpecs,
}
