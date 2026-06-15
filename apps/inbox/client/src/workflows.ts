import {
  scope,
  type WorkflowsConfig,
  type AgentMeta,
  type RenderSpec,
  type HitlSpec,
} from '@atizar/react'
import { workflowDescriptors } from '../../workflows'
import {
  emailInboxMeta,
  emailInboxRenders,
  emailInboxHitl,
} from '../../workflows/email-inbox/client'
import { EMAIL_INBOX_ID } from '../../workflows/email-inbox/ids'

// The demo aggregator: merges every workflow client module into one WorkflowsConfig bundle
// (descriptors + per-agent chrome meta + render/HITL specs) and hands it to <BoardApp config={…} />.
// This is the userland injection point — the package holds no cards or workflow knowledge.
//
// Render/HITL resolution is scoped per workflow (WS2): each workflow's specs are stamped with
// that workflow's id, so two workflows registering the same tool name with DIFFERENT components
// both resolve correctly. Dedup is WITHIN a workflow only (a reused agent registers its render
// once per workflow) — the old global byName drop is gone (it silently lost a second workflow's
// same-named-but-different component).
const META: Record<string, AgentMeta> = { ...emailInboxMeta }

// `scope` (from @atizar/react) stamps a workflow's specs with its id, then drops duplicate tool
// names WITHIN that workflow.
const renderSpecs: RenderSpec[] = [...scope<RenderSpec>(EMAIL_INBOX_ID, emailInboxRenders)]
const hitlSpecs: HitlSpec[] = [...scope<HitlSpec>(EMAIL_INBOX_ID, emailInboxHitl)]

export const workflowsConfig: WorkflowsConfig = {
  workflows: workflowDescriptors,
  meta: META,
  renders: renderSpecs,
  hitl: hitlSpecs,
  // Build-time token (deploy sets it to match the server's ATIZAR_AUTH_TOKEN). Unset in
  // dev/demo ⇒ undefined ⇒ no header, which matches the fail-open / demo-disabled server.
  authToken: import.meta.env.VITE_ATIZAR_AUTH_TOKEN as string | undefined,
}
