import type { Status } from './status'
import type { IconName } from './components/Icon'

// A node in the live pipeline view (left panel). Display fields ride along so the
// PipelineColumn can render the mini card; `status` + `handoffsTo` drive the logic.
export type PipelineNode = {
  id: string
  name: string
  subtitle: string
  iconName: IconName
  status: Status
  handoffsTo: string[]
}

// Statuses that count as "actively working": running, awaiting_approval, error
// (needs attention). idle (not launched) and done (finished) are NOT active.
const ACTIVE_STATUSES = new Set<Status>(['running', 'awaiting_approval', 'error'])

// The pipeline shows an agent when it is either:
//   (a) itself active, OR
//   (b) a handoff ancestor of an active agent — the agent that launched a subagent
//       that is still working (e.g. the qualifier while its handoff reply runs).
// A done/idle ancestor shown only because a subagent is live is displayed as `running`
// ("Working") — the caller is considered working while its child works.
//
// Nodes are ordered so a handoff source precedes its target (qualifier before reply).
// Ancestor detection is transitive (handles chains); cycle-safe; stable for ties.
export function activePipeline(nodes: PipelineNode[]): PipelineNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))

  // shown = active nodes ∪ all handoff ancestors of an active node (fixpoint).
  const shownIds = new Set(
    nodes.filter((node) => ACTIVE_STATUSES.has(node.status)).map((n) => n.id)
  )
  let changed = true
  while (changed) {
    changed = false
    for (const node of nodes) {
      if (shownIds.has(node.id)) continue
      if (node.handoffsTo.some((target) => byId.has(target) && shownIds.has(target))) {
        shownIds.add(node.id)
        changed = true
      }
    }
  }

  // Active nodes keep their real status; ancestor-only nodes display as `running`.
  const shown = nodes
    .filter((node) => shownIds.has(node.id))
    .map((node) =>
      ACTIVE_STATUSES.has(node.status) ? node : { ...node, status: 'running' as Status }
    )
  const shownSet = new Set(shown.map((node) => node.id))

  // Topological order within the shown subgraph (source before target).
  const incoming = new Map<string, number>()
  for (const node of shown) incoming.set(node.id, 0)
  for (const node of shown) {
    for (const target of node.handoffsTo) {
      if (shownSet.has(target)) incoming.set(target, (incoming.get(target) ?? 0) + 1)
    }
  }

  const ordered: PipelineNode[] = []
  const remaining = [...shown]
  while (remaining.length > 0) {
    // First node with no remaining incoming edge; on a cycle, fall back to the first.
    const ready = remaining.findIndex((node) => (incoming.get(node.id) ?? 0) === 0)
    const [node] = remaining.splice(ready === -1 ? 0 : ready, 1)
    ordered.push(node)
    for (const target of node.handoffsTo) {
      if (incoming.has(target)) incoming.set(target, (incoming.get(target) ?? 0) - 1)
    }
  }
  return ordered
}
