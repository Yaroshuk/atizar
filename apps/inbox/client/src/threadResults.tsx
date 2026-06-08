import { createContext, useContext } from 'react'

// Parsed tool RESULTS of the currently-open agent's thread, keyed by tool name.
// AgentModal builds this from `agent.messages` (the provider surfaces tool results as
// ToolMessages — see claude-stream `TOOL_CALL_RESULT`). Generative-UI cards read their
// data tool's result from here instead of the model re-emitting it into a render tool
// (which is slow and can hit the run timeout for large lists).
export const ThreadResultsContext = createContext<Record<string, unknown>>({})

export function useThreadResult<T = unknown>(toolName: string): T | undefined {
  return useContext(ThreadResultsContext)[toolName] as T | undefined
}
