// Single source of truth for the AgentCard status values.
//
// A string literal union (NOT a TS enum — see CLAUDE.md Decisions): zero runtime
// cost, the value IS the wire string, plays nice with `Record<Status, …>`
// exhaustiveness. The `as const` array also gives a runtime list for iteration.
//
// Client-only: the server/provider never references status — it lives here, not
// in `core/` (which is shared and React/runtime-free).
export const STATUSES = [
  "idle",
  "running",
  "awaiting_approval",
  "done",
  "error",
] as const;

export type Status = (typeof STATUSES)[number];

// The subset that comes from the agent run lifecycle. `awaiting_approval` is
// derived from message state (hasPendingApproval), never a lifecycle event.
export type Lifecycle = Exclude<Status, "awaiting_approval">;
