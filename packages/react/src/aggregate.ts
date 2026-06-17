import type { Outcome } from '@atizar/core'
import type { Status } from './status'
import { DISTINCT_TERMINAL } from './statusDisplay'

// "Busy" = an instance is actively holding the agent's slot: running or awaiting a human.
// `error` is deliberately NOT busy (Unit 4.2): an agent whose only instance errored has a
// FREE slot, so START must stay available — the error shows as a badge alongside the button.
const BUSY: ReadonlySet<Status> = new Set(['running', 'awaiting_approval'])
// Worst-meaningful-first; the human must not miss an approval. The ONE status-priority order —
// reused by the pipeline model's pickHead (do NOT redeclare elsewhere).
export const PRIORITY: Status[] = ['awaiting_approval', 'error', 'running', 'done', 'idle']

export type AgentAggregate = {
  activeCount: number
  awaitingCount: number
  status: Status
  // The terminal outcome the type card displays WHEN nothing is live (status === 'done'):
  // a distinct terminal (stopped/rejected) wins over a clean done so a Stopped agent reads
  // "Stopped" not "Done". `null` when the headline is a live/idle/error status (the card then
  // shows the status label, unchanged).
  outcome: Outcome | null
}

// One contributing instance: its display Status plus the raw terminal outcome (the latter
// carries the distinct-terminal flavour displayStatus collapses into the 'done' lane).
export type AgentEntry = { status: Status; outcome: Outcome }

// Reduce an agent's live instance entries to a single headline for its "type" card.
// `activeCount` counts only BUSY instances (running/awaiting) — an errored-only agent reads
// 0 active so its headline label is empty and START remains exposed.
export const aggregateAgent = (entries: AgentEntry[]): AgentAggregate => {
  const statuses = entries.map((e) => e.status)
  const activeCount = statuses.filter((s) => BUSY.has(s)).length
  const awaitingCount = statuses.filter((s) => s === 'awaiting_approval').length
  const status = PRIORITY.find((p) => statuses.includes(p)) ?? 'idle'
  // Only a settled-done headline carries a terminal outcome; a live/idle/error one shows its
  // status label (outcome = null). Among the terminal entries prefer a distinct terminal
  // (stopped/rejected) — the notable state — over a clean done; all clean → 'done'.
  const terminals = entries.filter((e) => e.status === 'done').map((e) => e.outcome)
  const outcome: Outcome | null =
    status === 'done' ? (terminals.find((o) => DISTINCT_TERMINAL.has(o)) ?? 'done') : null
  return { activeCount, awaitingCount, status, outcome }
}

// The headline text for the type card, e.g. "2 active · 1 awaiting approval". Empty for an
// idle / done / error-only agent (no BUSY instances) so it never hides the START button.
export const aggregateLabel = (a: AgentAggregate): string => {
  if (a.activeCount === 0) return ''
  const head = `${a.activeCount} active`
  return a.awaitingCount > 0 ? `${head} · ${a.awaitingCount} awaiting approval` : head
}
