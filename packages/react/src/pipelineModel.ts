import type { Status } from './status'
import type { IconName } from './components/Icon/Icon'

export type PInstance = {
  localId: string
  runtimeKey: string
  agentId: string
  name: string
  iconName: IconName
  label: string
  status: Status
  parentLocalId?: string
  isInput: boolean
}

export type AgentGroup = {
  agentId: string
  name: string
  iconName: IconName
  instances: PInstance[] // ≥1, all the same agentId, all shown
  queued: number
}

export type PipelineBlock = {
  parent: PInstance // the header instance
  groups: AgentGroup[] // children grouped by agentId; [] => lone header
}

const ACTIVE: ReadonlySet<Status> = new Set(['running', 'awaiting_approval', 'error'])

// Build the repeated depth-2 block model from the live instances of one workflow.
// queued: agentId -> count of items waiting for a free slot.
export function buildPipeline(
  instances: PInstance[],
  queued: Record<string, number>
): PipelineBlock[] {
  const childrenOf = new Map<string, PInstance[]>()
  for (const x of instances) {
    if (!x.parentLocalId) continue
    const arr = childrenOf.get(x.parentLocalId) ?? []
    arr.push(x)
    childrenOf.set(x.parentLocalId, arr)
  }

  // shown = active instances, then promote their ancestors (fixpoint). An input root is NO
  // longer force-shown once terminal: a finished input scan with no active descendant leaves
  // the LIVE column (Unit 4.1). A non-terminal input root is active and seeded here anyway; a
  // terminal one re-enters `shown` only via the ancestor-promotion walk below (a live child).
  const shown = new Set<string>()
  for (const x of instances) if (ACTIVE.has(x.status)) shown.add(x.localId)
  // Promote ancestors of shown nodes (a parent is kept because a child is shown).
  let changed = true
  while (changed) {
    changed = false
    for (const x of instances) {
      if (!shown.has(x.localId)) continue
      if (x.parentLocalId && !shown.has(x.parentLocalId)) {
        shown.add(x.parentLocalId)
        changed = true
      }
    }
  }

  // A "live descendant" exists if any node in the subtree rooted at x is ACTIVE (running /
  // awaiting_approval / error). Precompute per-localId so view() is O(1).
  const hasLiveDescendant = new Map<string, boolean>()
  const computeLive = (x: PInstance): boolean => {
    if (hasLiveDescendant.has(x.localId)) return hasLiveDescendant.get(x.localId)!
    let live = false
    for (const kid of childrenOf.get(x.localId) ?? []) {
      if (ACTIVE.has(kid.status) || computeLive(kid)) live = true
    }
    hasLiveDescendant.set(x.localId, live)
    return live
  }
  for (const x of instances) computeLive(x)

  // A parent is shown "Working" (running) ONLY while it has a live descendant; otherwise it
  // keeps its true status (a finished/closed root with no live child reads Done — WS1 label fix).
  // An already-active node keeps its own status as-is.
  const view = (x: PInstance): PInstance =>
    ACTIVE.has(x.status) || hasLiveDescendant.get(x.localId)
      ? ACTIVE.has(x.status)
        ? x
        : { ...x, status: 'running' as Status }
      : x

  const isShownChild = (x: PInstance) => shown.has(x.localId)
  const roots = instances.filter((x) => shown.has(x.localId) && (x.isInput || !x.parentLocalId))

  const blocks: PipelineBlock[] = []
  const emitted = new Set<string>()
  const queue = [...roots]
  while (queue.length) {
    const parent = queue.shift()!
    if (emitted.has(parent.localId)) continue
    emitted.add(parent.localId)

    const kids = (childrenOf.get(parent.localId) ?? []).filter(isShownChild)
    // group children by agentId, preserving first-seen order
    const order: string[] = []
    const groups = new Map<string, AgentGroup>()
    for (const k of kids) {
      if (!groups.has(k.agentId)) {
        order.push(k.agentId)
        groups.set(k.agentId, {
          agentId: k.agentId,
          name: k.name,
          iconName: k.iconName,
          instances: [],
          queued: queued[k.agentId] ?? 0,
        })
      }
      groups.get(k.agentId)!.instances.push(view(k))
      // a child that is itself a parent of shown instances gets its own block later
      if ((childrenOf.get(k.localId) ?? []).some(isShownChild)) queue.push(k)
    }
    blocks.push({ parent: view(parent), groups: order.map((id) => groups.get(id)!) })
  }
  return blocks
}
