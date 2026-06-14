// Per-workflow tool-name const map (as const → value IS the wire string, only the type
// narrows; not a TS enum — same rationale as PROVIDERS). Descriptors + render/HITL specs
// reference these instead of raw string literals: typo-safe + autocomplete, with the
// names owned in one place per workflow (the framework can't enumerate userland tools).
export const LEAD_INBOX_TOOLS = {
  renderLead: 'renderLead',
  saveDraft: 'saveDraft',
  renderVerdict: 'renderVerdict',
} as const

export type LeadInboxToolName = (typeof LEAD_INBOX_TOOLS)[keyof typeof LEAD_INBOX_TOOLS]
