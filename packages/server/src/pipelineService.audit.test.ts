import { beforeAll, describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import { gateOpened, type GateResolution, type Provider, type ResumeHandle } from '@atizar/core'
import { db } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { makePipelineService } from './pipelineService.js'
import type { AgentRuntime } from './runObserver.js'

const reachable = await db
  .execute(sql`select 1`)
  .then(() => true)
  .catch(() => false)

const ev = (e: Record<string, unknown>): BaseEvent => e as unknown as BaseEvent

function gateProvider(): Provider {
  return {
    async *run(_input: RunAgentInput) {
      yield ev({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm1', delta: 'work' })
      yield gateOpened({
        gateKind: 'approval',
        toolName: 'saveDraft',
        toolCallId: 'toolu_g',
        proposedArtifact: { body: 'draft' },
      })
    },
    async *resume(_h: ResumeHandle, _r: GateResolution) {
      yield ev({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm2', delta: 'saved' })
    },
  }
}

async function waitFor(pred: () => Promise<boolean>, timeout = 4000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await pred()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('waitFor timed out')
}

const base = {
  workflowId: 'lead-inbox',
  agentId: 'lead-inbox__reply',
  origin: 'human' as const,
  payload: {},
}

describe.skipIf(!reachable)('PipelineService durable audit (real Postgres)', () => {
  beforeAll(async () => {
    // PGlite (DEMO=1) starts with an empty DB — apply migrations so the audit_log table exists.
    // Real Postgres test DB: globalSetup already migrated it; runMigrations() is idempotent.
    await runMigrations()
  })

  it('records resolved + effect rows with the actor on an approval', async () => {
    const runtime: AgentRuntime = {
      provider: gateProvider(),
      renderToolNames: [],
      maxInstances: 2,
      effects: { saveDraft: async () => ({}) },
      dispatchToolNames: [],
      handoffs: [],
    }
    const service = makePipelineService({ db, resolveAgent: () => runtime, descriptors: [] })

    const { id } = await service.dispatch(base)
    await waitFor(async () => (await service.getStatus(id))?.status === 'awaiting_human')
    const gate = (await service.getBoard()).gates.find((g) => g.workItemId === id)!

    await service.resolveGate(gate.id, {
      gateId: gate.id,
      decision: 'approved',
      formRev: 0,
      actor: 'tester',
    })
    await waitFor(async () => (await service.getStatus(id))?.status === 'terminal')

    const audit = await service.getAudit(id)
    const kinds = audit.map((a) => a.kind)
    expect(kinds).toContain('resolved')
    expect(kinds).toContain('effect')
    // The human-decision rows carry the actor; the observer's own finish note (kind 'lifecycle')
    // is actor-null (the run, not the human, ends the scan).
    expect(audit.filter((a) => a.kind === 'resolved' || a.kind === 'effect').every((a) => a.actor === 'tester')).toBe(true)
  })
})
