// App-specific E2E test ids for the inbox demo's workflow CARDS (ApprovalDialog, EmailBatchCard,
// SortSummaryCard). Workflow-policy ids live HERE, not in @atizar/react — the framework catalog
// (testIds in @atizar/react) carries only generic UI ids. One source of truth, collision-safe.
export const appTestIds = {
  // SortSummaryCard headline ("N read · M new · K already handled").
  sortHeadline: 'sort-summary-headline',
  // The reply draft card (LeadCard) — one per reply RUN in an instance thread.
  replyDraftCard: 'reply-draft-card',
  // ApprovalDialog (reply HITL).
  approvalBody: 'approval-body',
  approvalSave: 'approval-save',
  approvalReject: 'approval-reject',
  // EmailBatchCard (reader/spam/important HITL).
  batchApply: 'batch-apply',
  batchReject: 'batch-reject',
  // Per-row action toggle (repeats once per row — select with .first() in specs).
  batchAction: (action: 'trash' | 'read' | 'star' | 'keep'): string => `batch-action-${action}`,
} as const
