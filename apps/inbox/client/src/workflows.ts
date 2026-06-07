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

export type AgentMeta = { subtitle: string; iconName: IconName; intro: string }

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
  [qualifierAgent.id]: {
    subtitle: 'Reads inbox, qualifies the lead',
    iconName: 'inbox',
    intro: 'Reading your inbox and qualifying the latest lead…',
  },
  [replyAgent.id]: {
    subtitle: 'Drafts a reply for your approval',
    iconName: 'pen',
    intro: 'Drafting a reply to the qualified lead for your approval…',
  },
  [triageAgent.id]: {
    subtitle: 'Reads your board, recommends routing',
    iconName: 'git',
    intro: 'Reading your board and triaging your open tickets…',
  },
  [featureAgent.id]: {
    subtitle: 'Plans a routed feature ticket',
    iconName: 'wrench',
    intro: 'Analyzing the routed ticket as a feature and drafting a plan…',
  },
  [bugfixAgent.id]: {
    subtitle: 'Analyzes a routed bug ticket',
    iconName: 'bug',
    intro: 'Investigating the routed ticket as a bug…',
  },
  [replyDraftAgent.id]: {
    subtitle: 'Drafts a suggested reply (never posts)',
    iconName: 'pen',
    intro: 'Drafting a suggested reply to the routed ticket…',
  },
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
