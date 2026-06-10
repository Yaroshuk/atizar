import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import type { BaseEvent } from '@ag-ui/client'

// The ONLY place the pipeline DDL is expressed (design §3). drizzle-kit reads this to
// generate migrations. Postgres is THE backend, dev included (docs/pipeline-updated-3.md §1.7).

// WorkItem status — the full §5 union. Step 3 wires only
// queued → running → awaiting_approval → running → finished | error; the rest
// (awaiting_input, result, closed) are defined for forward-compat (step 4 / P1).
export const workItemStatus = pgEnum('work_item_status', [
  'queued',
  'running',
  'awaiting_approval',
  'awaiting_input',
  'result',
  'finished',
  'error',
  'closed',
])

// A terminal *outcome* marker, orthogonal to status (NOT a status — honest audit trail).
export const resolutionKind = pgEnum('resolution_kind', ['cancelled', 'rejected'])

// How a WorkItem was minted. `inbound` is reserved (machine dispatch) — no producer ships
// in the beta (spec §1.8); machine *action* is forbidden, machine *dispatch* is legitimate.
export const originKind = pgEnum('origin_kind', ['human', 'agent', 'inbound'])

export const gateKind = pgEnum('gate_kind', ['approval'])
export const gateStatus = pgEnum('gate_status', ['open', 'resolved'])

// Single app-readable schema version row (drizzle-kit's own journal tracks application).
export const schemaMeta = pgTable('schema_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const workItems = pgTable('work_items', {
  id: uuid('id').primaryKey(),
  workflowId: text('workflow_id').notNull(),
  agentId: text('agent_id').notNull(),
  parentId: uuid('parent_id'),
  origin: originKind('origin').notNull(),
  // Dedup key (deliveryKey-style); null ⇒ never deduped.
  source: text('source'),
  payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
  status: workItemStatus('status').notNull(),
  resolution: resolutionKind('resolution'),
  // Filled by a registered render tool (the generative-UI card the consumer acts on).
  card: jsonb('card').$type<Record<string, unknown>>(),
  // The provider runId (the workItemId ↔ runId map; belief #2 — engine step-state stays
  // in the provider, NOT here).
  runId: text('run_id'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const gates = pgTable('gates', {
  id: uuid('id').primaryKey(),
  workItemId: uuid('work_item_id')
    .notNull()
    .references(() => workItems.id),
  kind: gateKind('kind').notNull(),
  status: gateStatus('status').notNull(),
  // The editable artifact; seeded = proposedArtifact. Becomes the effect args at step 4.
  form: jsonb('form').notNull().$type<Record<string, unknown>>(),
  // Optimistic-lock seam (step 4: resolve must carry the rendered rev; mismatch → 409).
  formRev: integer('form_rev').notNull().default(0),
  // The agent's original proposal, kept ALONGSIDE the edited form (audit).
  proposedArtifact: jsonb('proposed_artifact').notNull().$type<Record<string, unknown>>(),
  toolName: text('tool_name').notNull(),
  toolCallId: text('tool_call_id').notNull(),
  comment: text('comment'),
  // First multi-user primitive (restored from v2); one nullable column.
  assignee: text('assignee'),
  resolvedBy: text('resolved_by'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  // Expiry = a visible stale badge; NEVER auto-resolves (locked decision 5).
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// Append-only; per-WorkItem monotonic seq. RunObserver is the single writer per WorkItem,
// so seq comes from an in-memory counter — no SELECT max(seq) race. Lossless: ALL events
// recorded; `surfaced` is a UI filter, not a recording filter.
export const trace = pgTable(
  'trace',
  {
    workItemId: uuid('work_item_id').notNull(),
    seq: integer('seq').notNull(),
    event: jsonb('event').notNull().$type<BaseEvent>(),
    surfaced: boolean('surfaced').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.workItemId, t.seq] })]
)

// Created now (HANDOFF: "from the very first table"); written at step 4 (server-executed
// effects). Key = `workItemId:gateId` — one resolved gate licenses exactly one execution.
export const actionLedger = pgTable('action_ledger', {
  key: text('key').primaryKey(),
  workItemId: uuid('work_item_id').notNull(),
  gateId: uuid('gate_id').notNull(),
  result: jsonb('result').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export type WorkItem = typeof workItems.$inferSelect
export type NewWorkItem = typeof workItems.$inferInsert
export type Gate = typeof gates.$inferSelect
export type NewGate = typeof gates.$inferInsert
export type TraceRow = typeof trace.$inferSelect
export type WorkItemStatus = WorkItem['status']
export type ResolutionKind = (typeof resolutionKind.enumValues)[number]
export type OriginKind = (typeof originKind.enumValues)[number]
