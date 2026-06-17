// Central catalog of the E2E test ids emitted by @atizar/react UI components — ONE source of
// truth so specs and components never drift on a raw string and ids can't silently collide.
// (Mirrors the Magma teachers-web `shared/lib/testIds` registry.) Parameterized ids are builder
// functions keyed by the stable agent id. App-specific ids live in the app's own catalog
// (apps/inbox/client/src/testIds.ts), never here — keep the framework free of workflow literals.
export const testIds = {
  // The agent TYPE card (keyed by the bare agent id, e.g. 'sorter').
  agentCard: (agentId: string): string => `agent-${agentId}`,
  // The START button on an input agent's card. Suffix convention: `${agentCard}-start`.
  agentStart: (agentId: string): string => `agent-${agentId}-start`,
  // A pipeline instance row (keyed by the RUNTIME agent id, e.g. 'email-inbox__reply').
  pipelineRow: (runtimeAgentId: string): string => `pipeline-${runtimeAgentId}`,
  // The open instance thread modal + its close (X) control.
  instanceModal: 'instance-view',
  instanceClose: 'instance-close',
  // The "Open <agent>" link on a handoff note in a thread (keyed by the target agent id).
  handoffOpen: (targetAgentId: string): string => `handoff-open-${targetAgentId}`,
  // The instance picker modal (shown when an agent has ≥2 live instances).
  pickerModal: 'instance-picker',
  // The agent TYPE-view modal (idle agent, no live instance → intro + START).
  typeView: 'agent-type-view',
  // The "Reconnecting…" chip in the app header (board SSE dropped).
  reconnectChip: 'board-reconnecting',
  // The "← Received from <parent>" origin note at the top of a child thread.
  receivedNote: 'received-note',
  // The Stop control in an open instance thread (present only while the instance is live).
  instanceStop: 'instance-stop',
  // One row in the instance picker (same id on every row — count them / assert membership).
  pickerRow: 'picker-row',
  // Global "Stop all" brake (app header) + per-workflow Stop (pipeline header).
  stopAll: 'stop-all',
  stopWorkflow: 'stop-workflow',
  // Per-workflow Clear/Reset (pipeline header) — clears finished items off the live board.
  resetWorkflow: 'reset-workflow',
  // The danger/confirm button inside a ConfirmDialog (bulk Stop / Reset confirmation).
  confirmAction: 'confirm-action',
} as const
