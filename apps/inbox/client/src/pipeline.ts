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

// The pipeline shows ONLY agents that are actively working: running, awaiting_approval,
// or error (needs attention). `idle` agents (not launched) and `done` agents (finished,
// nothing left to watch) drop out. Ordered so a handoff source precedes its target
// (qualifier before reply). Stable for ties (preserves input order) and cycle-safe.
//
// NOTE: "done drops out" assumes no active subagents. When a fan-out agent model lands
// (e.g. Lead Manager with per-lead instances), a `done` parent with live children should
// stay — extend the predicate then.
const PIPELINE_STATUSES = new Set<Status>(['running', 'awaiting_approval', 'error'])

export function activePipeline(nodes: PipelineNode[]): PipelineNode[] {
  const active = nodes.filter((node) => PIPELINE_STATUSES.has(node.status))
  const activeIds = new Set(active.map((node) => node.id))

  const incoming = new Map<string, number>()
  for (const node of active) incoming.set(node.id, 0)
  for (const node of active) {
    for (const target of node.handoffsTo) {
      if (activeIds.has(target)) incoming.set(target, (incoming.get(target) ?? 0) + 1)
    }
  }

  const ordered: PipelineNode[] = []
  const remaining = [...active]
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
