import type { WorkItem } from './serverTypes'
import { mapStatus, type Status } from './status'
import type { PInstance } from './pipelineModel'
import type { IconName } from './components/Icon/Icon'

// Map the server-authoritative board (WorkItem[]) onto the pure client pipeline model.
// The cap/queue is server-side now (WorkerPool); the board is the single source of truth.

const stripWf = (agentId: string, workflowId: string): string =>
  agentId.slice(workflowId.length + 2)
const isQueued = (w: WorkItem): boolean => w.status === 'queued'

// An item is shown in the pipeline once it is past `queued` AND still relevant: active
// (running/awaiting), an input agent (the pipeline root, kept after it finishes), errored,
// or carrying a result to show (a card, or a cancelled/rejected marker). A plain finished
// leaf worker with nothing to show drops out — matches the old "done workers torn down".
// A superseded root (WS1: status 'closed', resolution 'superseded') drops out of the LIVE
// column entirely — it lives on in Activity/trace (preserved, not destroyed — I12).
const isVisible = (w: WorkItem, isInput: boolean): boolean => {
  if (isQueued(w)) return false
  if (w.resolution === 'superseded') return false
  if (w.status !== 'finished' && w.status !== 'closed') return true
  return isInput || w.card !== null || w.resolution !== null
}

export const toPInstances = (
  items: WorkItem[],
  workflowId: string,
  roleOf: (agentId: string) => 'input' | 'worker' | undefined,
  metaIcon: (agentId: string) => string,
  nameOf: (agentId: string) => string,
  labelOf: (w: WorkItem) => string
): PInstance[] =>
  items
    .filter((w) => w.workflowId === workflowId)
    .map((w) => ({ w, agentId: stripWf(w.agentId, workflowId) }))
    .filter(({ w, agentId }) => isVisible(w, roleOf(agentId) === 'input'))
    .map(({ w, agentId }) => ({
      localId: w.id,
      runtimeKey: w.agentId,
      agentId,
      name: nameOf(agentId),
      iconName: metaIcon(agentId) as IconName,
      label: labelOf(w),
      status: mapStatus(w.status),
      parentLocalId: w.parentId ?? undefined,
      isInput: roleOf(agentId) === 'input',
    }))

export const queuedByAgent = (items: WorkItem[], workflowId: string): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const w of items) {
    if (w.workflowId !== workflowId || !isQueued(w)) continue
    const a = stripWf(w.agentId, workflowId)
    out[a] = (out[a] ?? 0) + 1
  }
  return out
}

export const statusesOf = (items: WorkItem[], workflowId: string, agentId: string): Status[] =>
  items
    .filter(
      (w) =>
        w.workflowId === workflowId && stripWf(w.agentId, workflowId) === agentId && !isQueued(w)
    )
    .map((w) => mapStatus(w.status))
