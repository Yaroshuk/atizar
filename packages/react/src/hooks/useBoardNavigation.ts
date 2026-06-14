import { useEffect, useState } from 'react'
import { instanceId, type AgentDefinition } from '@atizar/core'
import { useBoard } from './useBoard'
import { useDispatch } from './useDispatch'
import { lookups } from '../lookups'
import { toPInstances } from '../boardModel'
import type { WorkItem } from '../serverTypes'
import type { WorkflowsConfig } from '../workflowsContext'

// Extracted from WorkflowBoard.tsx:56-61 (open/type/picker state), :79-84 (URL sync),
// :99-103 (pInstances/liveOf), :125-143 (startInput/openAgent), :183-214 (notesFor +
// openItem/openTypeAgent/pickerInstances resolution).
//
// HandoffNote mirrors the type in AgentModal; duplicated here so this hook (and any hook
// consumer) can type notes without importing a React component.
export type HandoffNote = {
  dir: 'received' | 'sent'
  otherName: string
  label: string
  targetWorkflow?: string // present on a cross-workflow 'sent' note
  targetLocalId?: string // the spawned target instance (intra-workflow jump), if it started
}

export function useBoardNavigation(config: WorkflowsConfig, activeWorkflowId: string) {
  const board = useBoard()
  const { start } = useDispatch()
  const { workflow, defOf, roleOf, nameOf, metaIcon, stripAgent, labelOf } = lookups(
    config,
    activeWorkflowId
  )

  // WorkflowBoard.tsx:57-61: open state (open item id, open type view, open picker).
  const [openId, setOpenId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('open')
  )
  const [openTypeId, setOpenTypeId] = useState<string | null>(null)
  const [openPickerId, setOpenPickerId] = useState<string | null>(null)

  // WorkflowBoard.tsx:79-84: persist the open id into the URL so a reload re-attaches
  // (survives the SSE re-subscribe).
  useEffect(() => {
    const url = new URL(window.location.href)
    if (openId) url.searchParams.set('open', openId)
    else url.searchParams.delete('open')
    window.history.replaceState(null, '', url)
  }, [openId])

  const itemById = (id: string): WorkItem | undefined => board.items.find((w) => w.id === id)

  // WorkflowBoard.tsx:99-103: board → pipeline instances + per-agent live slice.
  const pInstances = toPInstances(board.items, workflow.id, roleOf, metaIcon, nameOf, labelOf)
  const liveOf = (agentId: string) => pInstances.filter((p) => p.agentId === agentId)
  const canStart = (agentId: string) => roleOf(agentId) === 'input'

  // WorkflowBoard.tsx:126-131: launch an input agent — dispatch a fresh run, open its thread.
  const startInput = (agentDef: AgentDefinition): void => {
    void start(instanceId(workflow.id, agentDef.id)).then((id) => {
      setOpenTypeId(null)
      setOpenId(id)
    })
  }

  // WorkflowBoard.tsx:135-143: open an agent by count of its visible items.
  //   0 → type view (intro + START)
  //   1 → its thread
  //  ≥2 → instance picker (the human picks a copy)
  const openAgent = (agentId: string): void => {
    const live = liveOf(agentId)
    setOpenTypeId(null)
    setOpenPickerId(null)
    setOpenId(null)
    if (live.length === 0) setOpenTypeId(agentId)
    else if (live.length === 1) setOpenId(live[0].localId)
    else setOpenPickerId(agentId)
  }

  // Reset all open state (used when switching workflows).
  const reset = (): void => {
    setOpenId(null)
    setOpenTypeId(null)
    setOpenPickerId(null)
  }

  // WorkflowBoard.tsx:185-209: handoff notes for an open item, derived from board topology.
  // A 'received' note from the item's parent; a 'sent' note per child.
  const notesFor = (id: string): HandoffNote[] => {
    const item = itemById(id)
    if (!item) return []
    const notes: HandoffNote[] = []
    if (item.parentId) {
      const parent = itemById(item.parentId)
      if (parent)
        notes.push({
          dir: 'received',
          otherName: nameOf(stripAgent(parent)),
          label: labelOf(item),
        })
    }
    for (const child of board.items.filter((w) => w.parentId === id)) {
      notes.push({
        dir: 'sent',
        otherName: nameOf(stripAgent(child)),
        label: labelOf(child),
        targetWorkflow: child.workflowId !== workflow.id ? child.workflowId : undefined,
        targetLocalId: child.workflowId === workflow.id ? child.id : undefined,
      })
    }
    return notes
  }

  // WorkflowBoard.tsx:212-214: resolve what the open id / type / picker points at.
  const openItem = openId ? itemById(openId) : undefined
  const openTypeAgent = openTypeId ? defOf(workflow.id, openTypeId) : undefined
  const pickerInstances = openPickerId ? liveOf(openPickerId) : []

  return {
    openId,
    setOpenId,
    openTypeId,
    setOpenTypeId,
    openPickerId,
    setOpenPickerId,
    openItem,
    openTypeAgent,
    pickerInstances,
    pInstances,
    liveOf,
    canStart,
    openAgent,
    startInput,
    reset,
    notesFor,
    // Re-exported lookups the consuming blocks need.
    workflow,
    defOf,
    nameOf,
    metaIcon,
    stripAgent,
    labelOf,
  }
}
