import { randomUUID } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import { gateOpened, type GateResolution, type Provider, type ResumeHandle } from '@platform/core'
import { db } from './db/client.js'
import { makeStateStore } from './stateStore.js'
import { makeRunObserver } from './runObserver.js'
import type { WorkerPool } from './workerPool.js'

const store = makeStateStore(db)
const reachable = await db
  .execute(sql`select 1`)
  .then(() => true)
  .catch(() => false)

const ev = (e: Record<string, unknown>): BaseEvent => e as unknown as BaseEvent

// A fake provider: run() emits a render-tool call + text, then opens a gate, then ends
// (mimicking the claude-cli kill at the approval point). resume() emits two more events.
function fakeProvider(): Provider {
  return {
    async *run(_input: RunAgentInput) {
      yield ev({ type: EventType.TOOL_CALL_START, toolCallId: 'tc1', toolCallName: 'renderLead' })
      yield ev({ type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc1', delta: '{"name":"Acme"}' })
      yield ev({ type: EventType.TOOL_CALL_END, toolCallId: 'tc1' })
      yield ev({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm2', delta: 'drafting' })
      yield gateOpened({
        gateKind: 'approval',
        toolName: 'saveDraft',
        toolCallId: 'toolu_g',
        proposedArtifact: { to: 'a@b.c', body: 'hi' },
      })
    },
    async *resume(_handle: ResumeHandle, _resolution: GateResolution) {
      yield ev({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm3', delta: 'saved' })
      yield ev({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm3', delta: '!' })
    },
  }
}

function fakePool() {
  const release = vi.fn<(agentId: string) => void>()
  const pool: WorkerPool = {
    enqueue: vi.fn(),
    release,
    resumeAcquire: vi.fn(),
    activeCount: () => 0,
    queuedCount: () => 0,
  }
  return { pool, release }
}

describe.skipIf(!reachable)('RunObserver (real Postgres, fake provider)', () => {
  it('runs to a gate, fills the card, then resumes to finished', async () => {
    const { id } = await store.insertWorkItem({
      id: randomUUID(),
      workflowId: 'lead-inbox',
      agentId: 'lead-inbox__reply',
      origin: 'human',
      payload: {},
    })
    const { pool, release } = fakePool()
    const observer = makeRunObserver({
      db,
      store,
      pool,
      bus: { publish: vi.fn(), subscribe: () => () => {} },
      resolveAgent: () => ({
        provider: fakeProvider(),
        renderToolNames: ['renderLead'],
        maxInstances: 2,
      }),
    })

    await observer.run(id)

    const afterRun = await store.getWorkItem(id)
    expect(afterRun?.status).toBe('awaiting_approval')
    expect(afterRun?.card).toEqual({ tool: 'renderLead', props: { name: 'Acme' } })

    const trace = await store.getTrace(id, 0)
    expect(trace.length).toBe(5) // 3 tool-call events + 1 text + 1 gate
    expect(trace.map((r) => r.seq)).toEqual([0, 1, 2, 3, 4])

    const gate = await store.getOpenGate(id)
    expect(gate?.proposedArtifact).toEqual({ to: 'a@b.c', body: 'hi' })
    expect(release).toHaveBeenCalledWith('lead-inbox__reply')

    // Resume across the gate.
    await observer.resume(id, { gateId: gate!.id, decision: 'approved' })

    const afterResume = await store.getWorkItem(id)
    expect(afterResume?.status).toBe('finished')
    expect(await store.getOpenGate(id)).toBeUndefined()

    const stitched = await store.getTrace(id, 0)
    expect(stitched.map((r) => r.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]) // seq continues
  })
})
