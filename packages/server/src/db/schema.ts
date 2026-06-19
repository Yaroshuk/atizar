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

// WorkItem phase — the collapsed 4-value lifecycle (spec 2026-06-16). awaiting_human merges
// the old awaiting_approval + awaiting_input; queued/active/terminal complete the alphabet.
// The classifier lives in @atizar/core (lifecycle.ts) — this enum is just its persisted form.
export const workItemPhase = pgEnum('work_item_phase', [
  'queued',
  'active',
  'awaiting_human',
  'awaiting_agent',
  'terminal',
])

// WorkItem outcome — first-class now (was the orthogonal `resolution`). `running` = not yet
// terminal; the seven terminal flavours match @atizar/core Outcome exactly.
// `dismissed` = an acknowledged error; retired (leaves the board), non-covering (re-scan ok).
export const workItemOutcome = pgEnum('work_item_outcome', [
  'running',
  'done',
  'stopped',
  'rejected',
  'error',
  'superseded',
  'reset',
  'dismissed',
])

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
  // Tenant key for multi-tenant scoping (e.g. per-browser demo isolation). The client sends it via
  // the X-Atizar-Session header; absent ⇒ 'global' (single-operator / shared, the default). A root
  // is stamped from the request; a child inherits its parent's sessionId at dispatch.
  sessionId: text('session_id').notNull().default('global'),
  origin: originKind('origin').notNull(),
  // Dedup key (app-supplied via sourceOf at dispatch); null ⇒ never deduped.
  source: text('source'),
  // Instance identity (spec 2026-06-16). Caller-supplied at dispatch; same key → same instance.
  // NOT derivable from `source` (reply: key=sender, source=email; spam: key='spam', source=email).
  key: text('key').notNull(),
  // Episode = a contiguous live span of a keyed instance. Stamped at dispatch: a new run inherits
  // the max episodeSeq of its (workflowId, agentId, key) siblings if any is still live, else max+1
  // (a fresh episode after the instance fully receded). The open thread shows only the latest episode
  // so a reactivated keyed instance does NOT resurrect a prior episode's done runs.
  episodeSeq: integer('episode_seq').notNull().default(1),
  payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
  phase: workItemPhase('phase').notNull(),
  outcome: workItemOutcome('outcome').notNull().default('running'),
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

// Agent-to-agent return channel (spec Plan 2). An asker suspends (awaiting_agent) and links here;
// when answered/failed the asker is woken. One row per ask; status drives the lifecycle.
export const questionStatus = pgEnum('question_status', ['open', 'answered', 'failed'])

export const questions = pgTable('questions', {
  id: uuid('id').primaryKey(),
  askerWorkItemId: uuid('asker_work_item_id')
    .notNull()
    .references(() => workItems.id),
  answererWorkItemId: uuid('answerer_work_item_id'),
  target: jsonb('target').notNull().$type<Record<string, unknown>>(),
  toolCallId: text('tool_call_id').notNull(),
  payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
  status: questionStatus('status').notNull().default('open'),
  answer: jsonb('answer').$type<Record<string, unknown>>(),
  reason: text('reason'),
  round: integer('round').notNull().default(1),
  retries: integer('retries').notNull().default(0),
  deadline: timestamp('deadline', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  answeredAt: timestamp('answered_at', { withTimezone: true }),
})

// Durable, attributed audit of human decisions + server-executed effects. Append-only (one row
// per recorded action), so it survives restart — UNLIKE the in-memory activity ring buffer
// (which stays the live-UI tail). `actor` is the resolver identity (connection label or
// 'shared-token' under the bearer-token auth; null in fail-open dev). `kind` mirrors the
// activity kinds we care to persist (resolved | effect | error). Reinforces I1: every human
// START/approval leaves a durable, attributable trace.
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey(),
  workItemId: uuid('work_item_id').notNull(),
  gateId: uuid('gate_id'),
  workflowId: text('workflow_id').notNull(),
  agentId: text('agent_id').notNull(),
  kind: text('kind').notNull(),
  summary: text('summary').notNull(),
  actor: text('actor'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// Encrypted per-connection credentials (integration auth, spec 2026-06-11 §3). PK
// (connection_id, integration): connection_id is a developer-chosen LABEL ('default'|'home'|…),
// NOT a user account. `secret` is the AES-256-GCM blob (oauth2 token JSON or an apiKey) — plaintext
// NEVER hits the DB. `kind` is the open AuthSpec kind (plain text, not an enum). expires_at drives
// the oauth2 refresh-on-resolve.
export const credentials = pgTable(
  'credentials',
  {
    connectionId: text('connection_id').notNull(),
    integration: text('integration').notNull(),
    kind: text('kind').notNull(),
    secret: text('secret').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    connectedAt: timestamp('connected_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.integration] })]
)

export type WorkItem = typeof workItems.$inferSelect
export type NewWorkItem = typeof workItems.$inferInsert
export type Credential = typeof credentials.$inferSelect
export type NewCredential = typeof credentials.$inferInsert
export type Gate = typeof gates.$inferSelect
export type NewGate = typeof gates.$inferInsert
export type TraceRow = typeof trace.$inferSelect
export type WorkItemPhase = WorkItem['phase']
export type WorkItemOutcome = (typeof workItemOutcome.enumValues)[number]
export type OriginKind = (typeof originKind.enumValues)[number]
export type AuditRow = typeof auditLog.$inferSelect
export type NewAuditRow = typeof auditLog.$inferInsert
export type Question = typeof questions.$inferSelect
export type NewQuestion = typeof questions.$inferInsert
export type QuestionStatus = (typeof questionStatus.enumValues)[number]
