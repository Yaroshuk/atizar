import { lifecycle, hasLiveDescendant, type Phase } from '@atizar/core'
import type { WorkItem } from './serverTypes'
import { displayStatus } from './lifecycleDisplay'
import type { Status } from './status'
import type { PInstance } from './pipelineModel'
import type { IconName } from './components/Icon/Icon'

// Map the server-authoritative board (WorkItem[]) onto the pure client pipeline model.
// The cap/queue is server-side now (WorkerPool); the board is the single source of truth.
// Visibility + the live-descendant walk are the SHARED core lifecycle() / hasLiveDescendant —
// the client cannot disagree with the server about which items are shown.

const stripWf = (agentId: string, workflowId: string): string =>
  agentId.slice(workflowId.length + 2)

export const toPInstances = (
  items: WorkItem[],
  workflowId: string,
  roleOf: (agentId: string) => 'input' | 'worker' | undefined,
  metaIcon: (agentId: string) => string,
  nameOf: (agentId: string) => string,
  labelOf: (w: WorkItem) => string
): PInstance[] => {
  const liveAncestors = hasLiveDescendant(
    items.map((w) => ({ id: w.id, parentId: w.parentId, phase: w.phase as Phase }))
  )
  return items
    .filter((w) => w.workflowId === workflowId)
    .map((w) => ({ w, agentId: stripWf(w.agentId, workflowId) }))
    .filter(
      ({ w }) => lifecycle(w.phase, w.outcome, w.card !== null, liveAncestors.has(w.id)).isVisible
    )
    .map(({ w, agentId }) => ({
      localId: w.id,
      runtimeKey: w.agentId,
      agentId,
      key: w.key,
      name: nameOf(agentId),
      iconName: metaIcon(agentId) as IconName,
      label: labelOf(w),
      status: displayStatus(w.phase, w.outcome),
      outcome: w.outcome,
      parentLocalId: w.parentId ?? undefined,
      isInput: roleOf(agentId) === 'input',
    }))
}

export const queuedByAgent = (items: WorkItem[], workflowId: string): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const w of items) {
    if (w.workflowId !== workflowId || w.phase !== 'queued') continue
    const a = stripWf(w.agentId, workflowId)
    out[a] = (out[a] ?? 0) + 1
  }
  return out
}

// Retired items (superseded/reset) have LEFT the board — the server drops them, so they never
// reach this filter and cannot colour the agent's type card. A queued item carries no settled
// status yet, so it is excluded too; everything past queued maps via displayStatus.
export const statusesOf = (items: WorkItem[], workflowId: string, agentId: string): Status[] =>
  items
    .filter(
      (w) =>
        w.workflowId === workflowId &&
        stripWf(w.agentId, workflowId) === agentId &&
        w.phase !== 'queued' &&
        w.outcome !== 'superseded' &&
        w.outcome !== 'reset'
    )
    .map((w) => displayStatus(w.phase, w.outcome))
