import type { WorkflowsConfig, AgentMeta, RenderSpec, HitlSpec } from '@atizar/react'
import { workflowDescriptors } from '../../workflows'
import { leadInboxMeta, leadInboxRenders, leadInboxHitl } from '../../workflows/lead-inbox/client'
import { githubTriageMeta, githubTriageRenders } from '../../workflows/github-triage/client'
import {
  emailInboxMeta,
  emailInboxRenders,
  emailInboxHitl,
} from '../../workflows/email-inbox/client'

// The demo aggregator: merges every workflow client module into one WorkflowsConfig bundle
// (descriptors + per-agent chrome meta + render/HITL specs), deduped by tool name (a reused
// agent registers its render only once), and hands it to <BoardApp config={…} />. This
// is the userland injection point — the package holds no cards or workflow knowledge.
const META: Record<string, AgentMeta> = { ...leadInboxMeta, ...githubTriageMeta, ...emailInboxMeta }
const byName = <T extends { toolName: string }>(specs: T[]): T[] => {
  const seen = new Set<string>()
  return specs.filter((s) => (seen.has(s.toolName) ? false : (seen.add(s.toolName), true)))
}
const renderSpecs: RenderSpec[] = byName<RenderSpec>([
  ...leadInboxRenders,
  ...githubTriageRenders,
  ...emailInboxRenders,
])
const hitlSpecs: HitlSpec[] = byName<HitlSpec>([...leadInboxHitl, ...emailInboxHitl])

export const workflowsConfig: WorkflowsConfig = {
  workflows: workflowDescriptors,
  meta: META,
  renders: renderSpecs,
  hitl: hitlSpecs,
  // Build-time token (deploy sets it to match the server's ATIZAR_AUTH_TOKEN). Unset in
  // dev/demo ⇒ undefined ⇒ no header, which matches the fail-open / demo-disabled server.
  authToken: import.meta.env.VITE_ATIZAR_AUTH_TOKEN as string | undefined,
}
