import { useRef, useState } from 'react'
import { useBoard } from './useBoard'
import type { WorkItem } from '../serverTypes'
import type { WorkflowsConfig } from '../workflowsContext'

// "Active" = the item occupies the operator / a worker slot. The board ships only non-retired
// rows, so a non-terminal phase (queued / active / awaiting_human) is exactly the live set.
const isActive = (w: WorkItem): boolean => w.phase !== 'terminal'

// A cross-workflow child = a work item whose parent lives in a DIFFERENT workflow.
const isCrossWorkflowChild = (w: WorkItem, parentOf: (id: string) => WorkItem | undefined) => {
  if (!w.parentId) return false
  const parent = parentOf(w.parentId)
  return parent !== undefined && parent.workflowId !== w.workflowId
}

export function useWorkflowSelection(config: WorkflowsConfig) {
  const board = useBoard()
  const [activeWorkflowId, setActiveWorkflowId] = useState(config.workflows[0].id)
  const seenRef = useRef<Set<string>>(new Set())
  const itemById = (id: string) => board.items.find((w) => w.id === id)

  const unread: Record<string, number> = {}
  for (const w of board.items) {
    if (w.workflowId === activeWorkflowId) continue
    if (isCrossWorkflowChild(w, itemById) && !seenRef.current.has(w.id)) {
      unread[w.workflowId] = (unread[w.workflowId] ?? 0) + 1
    }
  }
  const globalActive = board.items.filter((w) => isActive(w)).length
  const workflowActiveCount = board.items.filter(
    (w) => w.workflowId === activeWorkflowId && isActive(w)
  ).length

  // Switch the active workflow; mark its current cross-workflow children seen (clears its badge).
  // The open-thread reset is the navigation hook's job — the demo calls nav.reset() alongside this.
  const switchWorkflow = (id: string): void => {
    for (const w of board.items) {
      if (w.workflowId === id && isCrossWorkflowChild(w, itemById)) seenRef.current.add(w.id)
    }
    setActiveWorkflowId(id)
  }

  return { activeWorkflowId, switchWorkflow, unread, globalActive, workflowActiveCount }
}
