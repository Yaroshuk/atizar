import { hasPendingApproval, type Message } from '@platform/core'
import type { Status, Lifecycle } from './status'

// Pure status derivation shared by the useAgentStatus hook and the instance manager.
// `awaiting_approval` (from message state) wins over running/done but never over a
// terminal error — mirrors the rule documented in CLAUDE.md / status.ts.
export const statusFrom = (
  lifecycle: Lifecycle,
  messages: Message[],
  approvals: readonly string[]
): Status => {
  if (lifecycle === 'error') return 'error'
  if (hasPendingApproval(messages, approvals)) return 'awaiting_approval'
  return lifecycle
}
