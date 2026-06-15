import type { Status } from './status'

// "Busy" = an instance is actively holding the agent's slot: running or awaiting a human.
// `error` is deliberately NOT busy (Unit 4.2): an agent whose only instance errored has a
// FREE slot, so START must stay available — the error shows as a badge alongside the button.
const BUSY: ReadonlySet<Status> = new Set(['running', 'awaiting_approval'])
// Worst-meaningful-first; the human must not miss an approval.
const PRIORITY: Status[] = ['awaiting_approval', 'error', 'running', 'done', 'idle']

export type AgentAggregate = { activeCount: number; awaitingCount: number; status: Status }

// Reduce an agent's live instance statuses to a single headline for its "type" card.
// `activeCount` counts only BUSY instances (running/awaiting) — an errored-only agent reads
// 0 active so its headline label is empty and START remains exposed.
export const aggregateAgent = (statuses: Status[]): AgentAggregate => {
  const activeCount = statuses.filter((s) => BUSY.has(s)).length
  const awaitingCount = statuses.filter((s) => s === 'awaiting_approval').length
  const status = PRIORITY.find((p) => statuses.includes(p)) ?? 'idle'
  return { activeCount, awaitingCount, status }
}

// The headline text for the type card, e.g. "2 active · 1 awaiting approval". Empty for an
// idle / done / error-only agent (no BUSY instances) so it never hides the START button.
export const aggregateLabel = (a: AgentAggregate): string => {
  if (a.activeCount === 0) return ''
  const head = `${a.activeCount} active`
  return a.awaitingCount > 0 ? `${head} · ${a.awaitingCount} awaiting approval` : head
}
