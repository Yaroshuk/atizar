import type { WorkItem } from './serverTypes'
import { mapStatus, type Status } from './status'
import type { PInstance } from './pipelineModel'
import type { IconName } from './components/Icon/Icon'

// Map the server-authoritative board (WorkItem[]) onto the pure client pipeline model.
// The cap/queue is server-side now (WorkerPool); the board is the single source of truth.

const stripWf = (agentId: string, workflowId: string): string =>
  agentId.slice(workflowId.length + 2)
const isQueued = (w: WorkItem): boolean => w.status === 'queued'

const ACTIVE_SERVER: ReadonlySet<WorkItem['status']> = new Set([
  'queued',
  'running',
  'awaiting_approval',
  'awaiting_input',
])

// An item is shown in the LIVE pipeline once it is past `queued` AND still relevant: active
// (running/awaiting), errored, carrying a result to show (a card, or a cancelled/rejected
// marker), OR still carrying live work below it (a terminal parent/input root whose subtree
// has an active descendant). A plain finished leaf — INCLUDING a finished input root — with
// nothing to show and no active descendant drops out of the LIVE column (it stays reachable in
// Activity/history; I12 — hidden, not destroyed). A superseded root (WS1: status 'closed',
// resolution 'superseded') always drops out of the LIVE column.
const isVisible = (w: WorkItem, hasActiveDescendant: boolean): boolean => {
  if (isQueued(w)) return false
  if (w.resolution === 'superseded') return false
  if (w.status !== 'finished' && w.status !== 'closed') return true
  return w.card !== null || w.resolution !== null || hasActiveDescendant
}

// Work-item ids that have ≥1 ACTIVE descendant (transitive). A finished parent/input root is
// kept in the LIVE column only while live work still hangs below it — mirrors buildPipeline's
// ancestor-promotion walk so the rows fed to it already include the kept parents.
const idsWithActiveDescendant = (items: WorkItem[]): Set<string> => {
  const childrenOf = new Map<string, WorkItem[]>()
  for (const w of items) {
    if (!w.parentId) continue
    const arr = childrenOf.get(w.parentId) ?? []
    arr.push(w)
    childrenOf.set(w.parentId, arr)
  }
  const memo = new Map<string, boolean>()
  const compute = (id: string): boolean => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    memo.set(id, false) // guard against cycles
    let live = false
    for (const kid of childrenOf.get(id) ?? []) {
      if (ACTIVE_SERVER.has(kid.status) || compute(kid.id)) live = true
    }
    memo.set(id, live)
    return live
  }
  const out = new Set<string>()
  for (const w of items) if (compute(w.id)) out.add(w.id)
  return out
}

export const toPInstances = (
  items: WorkItem[],
  workflowId: string,
  roleOf: (agentId: string) => 'input' | 'worker' | undefined,
  metaIcon: (agentId: string) => string,
  nameOf: (agentId: string) => string,
  labelOf: (w: WorkItem) => string
): PInstance[] => {
  const liveAncestors = idsWithActiveDescendant(items)
  return items
    .filter((w) => w.workflowId === workflowId)
    .map((w) => ({ w, agentId: stripWf(w.agentId, workflowId) }))
    .filter(({ w }) => isVisible(w, liveAncestors.has(w.id)))
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
}

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
