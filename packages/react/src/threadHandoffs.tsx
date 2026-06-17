import { createContext, useContext } from 'react'

// The open agent thread's handoff events (Plan 1: a server-emitted CUSTOM 'handoff' folded to a
// role:'handoff' message). Generic — a card reads its thread's handoffs from here to project a
// workflow-specific summary, the same way ThreadResultsContext exposes data-tool results. No
// workflow fields live here.
export type ThreadHandoff = { targetAgentId: string; childWorkItemId: string; deduped: boolean }

export const ThreadHandoffsContext = createContext<ThreadHandoff[]>([])

export function useThreadHandoffs(): ThreadHandoff[] {
  return useContext(ThreadHandoffsContext)
}
