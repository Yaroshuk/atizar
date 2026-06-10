import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import { gateOpened, type GateResolution, type Provider, type ResumeHandle } from '@platform/core'
import { db } from './db/client.js'
import { makePipelineService } from './pipelineService.js'
import type { AgentRuntime } from './runObserver.js'

const reachable = await db
  .execute(sql`select 1`)
  .then(() => true)
  .catch(() => false)

const ev = (e: Record<string, unknown>): BaseEvent => e as unknown as BaseEvent

// A gate-opening provider (run → gate; resume → finish).
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

// A provider that never yields (occupies its slot forever) — for the cap test.
function blockingProvider(): Provider {
  return {
    async *run(_input: RunAgentInput) {
      await new Promise<void>(() => {})
      yield ev({ type: EventType.TEXT_MESSAGE_CHUNK }) // unreachable
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

describe.skipIf(!reachable)('PipelineService (real Postgres)', () => {
  it('dispatch → gate → resolve → finished, with a stitched trace', async () => {
    const runtime: AgentRuntime = {
      provider: gateProvider(),
      renderToolNames: [],
      maxInstances: 2,
    }
    const service = makePipelineService({ db, resolveAgent: () => runtime })

    const { id } = await service.dispatch(base)
    await waitFor(async () => (await service.getStatus(id))?.status === 'awaiting_approval')

    const board = await service.getBoard()
    const gate = board.gates.find((g) => g.workItemId === id)
    expect(gate).toBeDefined()

    await service.resolveGate(id, { gateId: gate!.id, decision: 'approved' })
    await waitFor(async () => (await service.getStatus(id))?.status === 'finished')

    const trace = await service.getTrace(id, 0)
    expect(trace?.nextSeq).toBe(3) // text + gate (run) + text (resume)
    expect(trace?.done).toBe(true)
  })

  it('holds the per-agent cap (3 dispatched, 2 active + 1 queued)', async () => {
    const runtime: AgentRuntime = {
      provider: blockingProvider(),
      renderToolNames: [],
      maxInstances: 2,
    }
    const service = makePipelineService({ db, resolveAgent: () => runtime })

    await service.dispatch({ ...base, agentId: 'cap-agent' })
    await service.dispatch({ ...base, agentId: 'cap-agent' })
    await service.dispatch({ ...base, agentId: 'cap-agent' })

    const stats = service.stats('cap-agent')
    expect(stats.active).toBe(2)
    expect(stats.queued).toBe(1)
  })
})
