import type { Status } from './status'

const ACTIVE: ReadonlySet<Status> = new Set(['running', 'awaiting_approval', 'error'])
// Worst-meaningful-first; the human must not miss an approval.
const PRIORITY: Status[] = ['awaiting_approval', 'error', 'running', 'done', 'idle']

export type AgentAggregate = { activeCount: number; awaitingCount: number; status: Status }

// Reduce an agent's live instance statuses to a single headline for its "type" card.
export const aggregateAgent = (statuses: Status[]): AgentAggregate => {
  const activeCount = statuses.filter((s) => ACTIVE.has(s)).length
  const awaitingCount = statuses.filter((s) => s === 'awaiting_approval').length
  const status = PRIORITY.find((p) => statuses.includes(p)) ?? 'idle'
  return { activeCount, awaitingCount, status }
}

// The headline text for the type card, e.g. "2 active · 1 awaiting approval".
export const aggregateLabel = (a: AgentAggregate): string => {
  if (a.activeCount === 0) return ''
  const head = `${a.activeCount} active`
  return a.awaitingCount > 0 ? `${head} · ${a.awaitingCount} awaiting approval` : head
}
