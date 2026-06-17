import type { ThreadHandoff } from '@atizar/react'

export type Dest = 'reply' | 'reader' | 'spam' | 'important'
export type ScanResult = {
  read: number
  new: Record<Dest, number>
  alreadyHandled: Record<Dest, number>
}

const DESTS: Dest[] = ['reply', 'reader', 'spam', 'important']
const zero = (): Record<Dest, number> => ({ reply: 0, reader: 0, spam: 0, important: 0 })
const bare = (agentId: string): string =>
  agentId.includes('__') ? agentId.slice(agentId.indexOf('__') + 2) : agentId

// Count emails a child carries: a reply child has one `email`; a batch child has `emails: [...]`.
const emailCount = (payload: Record<string, unknown>): number => {
  if (Array.isArray((payload as { emails?: unknown[] }).emails)) {
    return (payload as { emails: unknown[] }).emails.length
  }
  return (payload as { email?: unknown }).email ? 1 : 0
}

// Project this scan run's handoff events into the email ScanResult. WINDOW SEMANTICS: we read only
// the handoffs of the OPEN scan run, so `alreadyHandled` is the intersection (read now) ∩ (covered)
// — scoped to the current read set, never cumulative. A handoff whose child isn't in `items`
// (aged out / cleared) contributes nothing.
export function projectScanResult(
  handoffs: ThreadHandoff[],
  items: { id: string; payload: Record<string, unknown> }[]
): ScanResult {
  const byId = new Map(items.map((i) => [i.id, i]))
  const result: ScanResult = { read: 0, new: zero(), alreadyHandled: zero() }
  for (const h of handoffs) {
    const dest = bare(h.targetAgentId) as Dest
    if (!DESTS.includes(dest)) continue
    const child = byId.get(h.childWorkItemId)
    if (!child) continue // aged out of the current window / cleared
    const n = emailCount(child.payload)
    ;(h.deduped ? result.alreadyHandled : result.new)[dest] += n
    result.read += n
  }
  return result
}
