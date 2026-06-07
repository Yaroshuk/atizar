import type { AgentDefinition } from '@platform/core'
import type { IconName } from './components/Icon'
import { agents as inboxAgents, qualifierAgent, replyAgent } from '../../agents/inbox.agent'
import {
  githubAgents,
  triageAgent,
  featureAgent,
  bugfixAgent,
  replyDraftAgent,
} from '../../agents/github.agent'

export type AgentMeta = { subtitle: string; iconName: IconName }

export type Workflow = {
  id: string
  label: string
  iconName: IconName
  agents: AgentDefinition[]
  entryAgentId: string
}

// Per-agent display chrome (icon + one-line subtitle), keyed by agent id. Lives
// client-side for now (adding it to the core passport is deferred to the framework phase).
export const META: Record<string, AgentMeta> = {
  [qualifierAgent.id]: { subtitle: 'Reads inbox, qualifies the lead', iconName: 'inbox' },
  [replyAgent.id]: { subtitle: 'Drafts a reply for your approval', iconName: 'pen' },
  [triageAgent.id]: { subtitle: 'Reads your board, recommends routing', iconName: 'git' },
  [featureAgent.id]: { subtitle: 'Plans a routed feature ticket', iconName: 'wrench' },
  [bugfixAgent.id]: { subtitle: 'Analyzes a routed bug ticket', iconName: 'bug' },
  [replyDraftAgent.id]: { subtitle: 'Drafts a suggested reply (never posts)', iconName: 'pen' },
}

export const workflows: Workflow[] = [
  {
    id: 'lead-inbox',
    label: 'Lead inbox',
    iconName: 'inbox',
    agents: inboxAgents,
    entryAgentId: qualifierAgent.id,
  },
  {
    id: 'github-triage',
    label: 'GitHub triage',
    iconName: 'git',
    agents: githubAgents,
    entryAgentId: triageAgent.id,
  },
]
