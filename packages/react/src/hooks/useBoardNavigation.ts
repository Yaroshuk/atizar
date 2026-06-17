import { useEffect, useState } from 'react'
import { instanceId, type AgentDefinition } from '@atizar/core'
import { useBoard } from './useBoard'
import { useDispatch } from './useDispatch'
import { lookups } from '../lookups'
import { toPInstances } from '../boardModel'
import { pickHead, type PInstance } from '../pipelineModel'
import { isLive } from '../liveness'
import { latestScanRuns } from '../latestScanRuns'
import type { WorkItem } from '../serverTypes'
import type { WorkflowsConfig } from '../workflowsContext'

// Extracted from WorkflowBoard.tsx:56-61 (open/type/picker state), :79-84 (URL sync),
// :99-103 (pInstances/liveOf), :125-143 (startInput/openAgent), :183-214 (notesFor +
// openItem/openTypeAgent/pickerInstances resolution).
//
// HandoffNote mirrors the type in AgentModal; duplicated here so this hook (and any hook
// consumer) can type notes without importing a React component.
// Only 'received' notes are emitted by notesFor — 'sent' notes were removed in Task 5
// (the "Handed to X" line is now rendered inline via the trace handoff event).
export type HandoffNote = {
  dir: 'received'
  otherName: string
  label: string
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
  const doStart = (agentDef: AgentDefinition): void => {
    void start(instanceId(workflow.id, agentDef.id)).then((id) => {
      setOpenTypeId(null)
      setOpenId(id)
    })
  }

  // START = a plain dispatch. The server handles re-scan safety (supersede-prior + one-live gate);
  // no client-side wipe confirm. (Clear stays separate, via useResetController.)
  const startInput = (agentDef: AgentDefinition): void => doStart(agentDef)

  // Distinct visible instances of an agent = one head Run per unique key among its shown Runs.
  // Identity is the stored `key`; the representative Run is the SAME head-selection the pipeline
  // uses (pickHead — one source, no second priority derivation).
  const instancesOf = (agentId: string): PInstance[] => {
    const byKey = new Map<string, PInstance[]>()
    for (const p of liveOf(agentId)) {
      const arr = byKey.get(p.key) ?? []
      arr.push(p)
      byKey.set(p.key, arr)
    }
    // One head Run per key; KEEP only instances whose head is live (running/awaiting/error).
    // A done/stopped/rejected instance recedes from the card overlay, the picker, and the
    // open-routing count — but stays in `openRuns` (the open thread is unfiltered) and in the
    // board data (tree/dedup). One source: pickHead for the head, isLive for the live filter.
    return [...byKey.values()].map(pickHead).filter((h) => isLive(h.status))
  }

  // Open an agent by count of its distinct INSTANCES (grouped by key).
  //   0 → type view (intro + START)
  //   1 → the single instance's head run
  //  ≥2 → instance list (variant B — one row per instance)
  const openAgent = (agentId: string): void => {
    setOpenTypeId(null)
    setOpenPickerId(null)
    setOpenId(null)
    const insts = instancesOf(agentId)
    if (insts.length === 0) setOpenTypeId(agentId)
    else if (insts.length === 1) setOpenId(insts[0].localId)
    else setOpenPickerId(agentId)
  }

  // Reset all open state (used when switching workflows).
  const reset = (): void => {
    setOpenId(null)
    setOpenTypeId(null)
    setOpenPickerId(null)
  }

  // WorkflowBoard.tsx:185-209: handoff notes for an open item, derived from board topology.
  // Only 'received' notes are emitted (from the item's parent). 'Sent' notes (→ Handed to X)
  // are now rendered inline from the trace handoff event (Task 5).
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
    return notes
  }

  // WorkflowBoard.tsx:212-214: resolve what the open id / type / picker points at.
  const openItem = openId ? itemById(openId) : undefined
  const openTypeAgent = openTypeId ? defOf(workflow.id, openTypeId) : undefined
  // ≥2 → one row per distinct instance (variant B), each represented by its head Run.
  const pickerInstances = openPickerId ? instancesOf(openPickerId) : []

  // All visible Runs of the OPEN item's instance (same agentId + key), in board/creation order.
  // For an INPUT agent (constant key → every scan collapses into one instance) the open thread
  // renders ONLY the latest scan — older kept-for-children scans host their children in the
  // pipeline tree, not as a repeated scan card here (see latestScanRuns). A WORKER keeps all of
  // its runs (a sender's several drafts). openHead/onStop derive from this — the latest scan is
  // the correct head to represent and to stop.
  const openRuns: PInstance[] = openItem
    ? latestScanRuns(
        pInstances.filter((p) => p.agentId === stripAgent(openItem) && p.key === openItem.key),
        roleOf(stripAgent(openItem)) === 'input'
      )
    : []
  const openHead: PInstance | undefined = openRuns.length ? pickHead(openRuns) : undefined

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
    openRuns,
    openHead,
    pInstances,
    liveOf,
    instancesOf,
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
