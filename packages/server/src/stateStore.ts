import { randomUUID } from 'node:crypto'
import { and, asc, count, eq, gte, isNull } from 'drizzle-orm'
import type { BaseEvent } from '@ag-ui/client'
import type { Db } from './db/client.js'
import {
  actionLedger,
  auditLog,
  gates,
  trace,
  workItems,
  type AuditRow,
  type Gate,
  type OriginKind,
  type TraceRow,
  type WorkItem,
} from './db/schema.js'
import { ACTIVE, RESETTABLE } from './transition.js'

export interface InsertWorkItemInput {
  id?: string
  workflowId: string
  agentId: string
  origin: OriginKind
  payload: Record<string, unknown>
  parentId?: string | null
  source?: string | null
}

export interface InsertGateInput {
  workItemId: string
  toolName: string
  toolCallId: string
  proposedArtifact: Record<string, unknown>
}

export interface ResolveGateInput {
  resolvedBy?: string
  comment?: string
  form?: Record<string, unknown>
}

// Typed CRUD over the pipeline tables. The ONLY status writes go through transition()
// (this module just sets the INITIAL `queued` on insert — creation, not a transition).
// Takes the drizzle handle so a caller can pass a live transaction if needed.
export function makeStateStore(db: Db) {
  return {
    async insertWorkItem(input: InsertWorkItemInput): Promise<WorkItem> {
      const [row] = await db
        .insert(workItems)
        .values({
          id: input.id ?? randomUUID(),
          workflowId: input.workflowId,
          agentId: input.agentId,
          origin: input.origin,
          payload: input.payload,
          parentId: input.parentId ?? null,
          source: input.source ?? null,
          status: 'queued',
        })
        .returning()
      return row
    },

    async getWorkItem(id: string): Promise<WorkItem | undefined> {
      const [row] = await db.select().from(workItems).where(eq(workItems.id, id)).limit(1)
      return row
    },

    async appendTrace(
      workItemId: string,
      seq: number,
      event: BaseEvent,
      surfaced = true
    ): Promise<void> {
      await db.insert(trace).values({ workItemId, seq, event, surfaced })
    },

    async getTrace(workItemId: string, from: number): Promise<TraceRow[]> {
      return db
        .select()
        .from(trace)
        .where(and(eq(trace.workItemId, workItemId), gte(trace.seq, from)))
        .orderBy(asc(trace.seq))
    },

    // Total trace rows for a WorkItem = the next seq (rows are contiguous 0..n-1).
    async countTrace(workItemId: string): Promise<number> {
      const [row] = await db
        .select({ c: count() })
        .from(trace)
        .where(eq(trace.workItemId, workItemId))
      return row?.c ?? 0
    },

    // The board snapshot: all work items (newest first) + every OPEN gate.
    async getBoardSnapshot(): Promise<{ items: WorkItem[]; gates: Gate[] }> {
      const items = await db.select().from(workItems).orderBy(asc(workItems.createdAt))
      const openGates = await db.select().from(gates).where(eq(gates.status, 'open'))
      return { items, gates: openGates }
    },

    async insertGate(input: InsertGateInput): Promise<Gate> {
      const [row] = await db
        .insert(gates)
        .values({
          id: randomUUID(),
          workItemId: input.workItemId,
          kind: 'approval',
          status: 'open',
          form: input.proposedArtifact,
          proposedArtifact: input.proposedArtifact,
          toolName: input.toolName,
          toolCallId: input.toolCallId,
        })
        .returning()
      return row
    },

    async getOpenGate(workItemId: string): Promise<Gate | undefined> {
      const [row] = await db
        .select()
        .from(gates)
        .where(and(eq(gates.workItemId, workItemId), eq(gates.status, 'open')))
        .limit(1)
      return row
    },

    async resolveGateRow(gateId: string, input: ResolveGateInput): Promise<void> {
      await db
        .update(gates)
        .set({
          status: 'resolved',
          resolvedAt: new Date(),
          resolvedBy: input.resolvedBy ?? null,
          comment: input.comment ?? null,
          ...(input.form ? { form: input.form } : {}),
        })
        .where(eq(gates.id, gateId))
    },

    async setCard(id: string, card: Record<string, unknown>): Promise<void> {
      await db.update(workItems).set({ card, updatedAt: new Date() }).where(eq(workItems.id, id))
    },

    async setRunId(id: string, runId: string): Promise<void> {
      await db.update(workItems).set({ runId, updatedAt: new Date() }).where(eq(workItems.id, id))
    },

    async setError(id: string, error: string): Promise<void> {
      await db.update(workItems).set({ error, updatedAt: new Date() }).where(eq(workItems.id, id))
    },

    async getGate(gateId: string): Promise<Gate | undefined> {
      const [row] = await db.select().from(gates).where(eq(gates.id, gateId)).limit(1)
      return row
    },

    // One-time effect claim. INSERT … ON CONFLICT DO NOTHING; if the row already existed,
    // report alreadyClaimed with whatever result was recorded (null until setLedgerResult).
    async claimLedger(input: {
      key: string
      workItemId: string
      gateId: string
    }): Promise<{ alreadyClaimed: boolean; result: Record<string, unknown> | null }> {
      const inserted = await db
        .insert(actionLedger)
        .values({ key: input.key, workItemId: input.workItemId, gateId: input.gateId })
        .onConflictDoNothing()
        .returning()
      if (inserted.length > 0) return { alreadyClaimed: false, result: null }
      const [row] = await db
        .select()
        .from(actionLedger)
        .where(eq(actionLedger.key, input.key))
        .limit(1)
      return { alreadyClaimed: true, result: row?.result ?? null }
    },

    async setLedgerResult(key: string, result: Record<string, unknown>): Promise<void> {
      await db.update(actionLedger).set({ result }).where(eq(actionLedger.key, key))
    },

    async getActiveChildren(parentId: string): Promise<WorkItem[]> {
      const rows = await db.select().from(workItems).where(eq(workItems.parentId, parentId))
      return rows.filter((r) => ACTIVE.includes(r.status))
    },

    async getActiveByWorkflow(workflowId: string): Promise<WorkItem[]> {
      const rows = await db.select().from(workItems).where(eq(workItems.workflowId, workflowId))
      return rows.filter((r) => ACTIVE.includes(r.status))
    },

    // Resettable items = those in a TERMINAL status the `reset` edge accepts (finished / result
    // / error). A 'closed' item is already retired (skip — re-resetting it is a no-op and the
    // edge would reject anyway). Scoped to one workflow, or all when workflowId is omitted.
    async getResettable(workflowId?: string): Promise<WorkItem[]> {
      const rows = workflowId
        ? await db.select().from(workItems).where(eq(workItems.workflowId, workflowId))
        : await db.select().from(workItems)
      return rows.filter((r) => RESETTABLE.includes(r.status))
    },

    // The prior FINISHED, parentless scan roots of a given workflow × input-agent — the
    // candidates a fresh human START supersedes (WS1). Finished-but-open only: a 'closed'
    // (already-superseded) root, or one with a terminal resolution, is excluded. Children
    // (parentId != null) are never roots and are never superseded (I12 — they stay durable).
    async getFinishedInputRoots(workflowId: string, agentId: string): Promise<WorkItem[]> {
      return db
        .select()
        .from(workItems)
        .where(
          and(
            eq(workItems.workflowId, workflowId),
            eq(workItems.agentId, agentId),
            isNull(workItems.parentId),
            eq(workItems.status, 'finished'),
            isNull(workItems.resolution)
          )
        )
    },

    // True when this input agent (workflow × agentId) has at least one non-'closed' root whose
    // tree still contains an ACTIVE node (the root itself, or any transitive descendant). Under
    // Approach B a root finishes on its own run-end, so a 'finished' root with awaiting-approval
    // children still counts as a LIVE scan — this is the singleton-START gate's source of truth
    // (replaces the worker-pool process count, which is freed the moment the run/gate suspends).
    async hasLiveInputScan(workflowId: string, agentId: string): Promise<boolean> {
      const rows = await db.select().from(workItems).where(eq(workItems.workflowId, workflowId))
      const childrenOf = new Map<string, WorkItem[]>()
      for (const r of rows) {
        if (!r.parentId) continue
        const arr = childrenOf.get(r.parentId) ?? []
        arr.push(r)
        childrenOf.set(r.parentId, arr)
      }
      const subtreeLive = (id: string, seen = new Set<string>()): boolean => {
        if (seen.has(id)) return false
        seen.add(id)
        for (const kid of childrenOf.get(id) ?? []) {
          if (ACTIVE.includes(kid.status) || subtreeLive(kid.id, seen)) return true
        }
        return false
      }
      return rows.some(
        (r) =>
          r.agentId === agentId &&
          !r.parentId &&
          r.status !== 'closed' &&
          (ACTIVE.includes(r.status) || subtreeLive(r.id))
      )
    },

    // Append-only durable audit. One INSERT per recorded human decision / server effect.
    async appendAudit(input: {
      workItemId: string
      gateId: string | null
      workflowId: string
      agentId: string
      kind: string
      summary: string
      actor: string | null
    }): Promise<void> {
      await db.insert(auditLog).values({
        id: randomUUID(),
        workItemId: input.workItemId,
        gateId: input.gateId,
        workflowId: input.workflowId,
        agentId: input.agentId,
        kind: input.kind,
        summary: input.summary,
        actor: input.actor,
      })
    },

    async getAuditByWorkItem(workItemId: string): Promise<AuditRow[]> {
      return db
        .select()
        .from(auditLog)
        .where(eq(auditLog.workItemId, workItemId))
        .orderBy(asc(auditLog.createdAt))
    },
  }
}

export type StateStore = ReturnType<typeof makeStateStore>
