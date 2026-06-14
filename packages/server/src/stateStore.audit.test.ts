import { randomUUID } from 'node:crypto'
import { beforeAll, describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { makeStateStore } from './stateStore.js'

const store = makeStateStore(db)
const reachable = await db
  .execute(sql`select 1`)
  .then(() => true)
  .catch(() => false)

describe.skipIf(!reachable)('stateStore audit (real Postgres)', () => {
  beforeAll(async () => {
    // PGlite (DEMO=1) starts with an empty DB — apply migrations so the audit_log table exists.
    // Real Postgres test DB: globalSetup already migrated it; runMigrations() is idempotent.
    await runMigrations()
  })

  it('appends an audit row and reads it back by work item', async () => {
    const workItemId = randomUUID()
    const gateId = randomUUID()
    await store.appendAudit({
      workItemId,
      gateId,
      workflowId: 'lead-inbox',
      agentId: 'lead-inbox__reply',
      kind: 'resolved',
      summary: 'approved saveDraft',
      actor: 'shared-token',
    })
    const rows = await store.getAuditByWorkItem(workItemId)
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('resolved')
    expect(rows[0].actor).toBe('shared-token')
    expect(rows[0].gateId).toBe(gateId)
  })

  it('is append-only — two records for one work item read back in order', async () => {
    const workItemId = randomUUID()
    await store.appendAudit({
      workItemId,
      gateId: null,
      workflowId: 'lead-inbox',
      agentId: 'lead-inbox__reply',
      kind: 'resolved',
      summary: 'approved',
      actor: null,
    })
    await store.appendAudit({
      workItemId,
      gateId: null,
      workflowId: 'lead-inbox',
      agentId: 'lead-inbox__reply',
      kind: 'effect',
      summary: 'executed saveDraft',
      actor: null,
    })
    const rows = await store.getAuditByWorkItem(workItemId)
    expect(rows.map((r) => r.kind)).toEqual(['resolved', 'effect'])
  })
})
