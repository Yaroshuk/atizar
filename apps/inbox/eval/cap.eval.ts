import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import type { BaseEvent } from '@ag-ui/client'
import type { Provider } from '@atizar/core'
import { runMigrations, resetDb, db, makePipelineService, type AgentRuntime } from '@atizar/server'

beforeAll(async () => {
  await runMigrations()
})
beforeEach(async () => {
  await resetDb()
})

// A provider whose run() parks until `release` is called, holding its pool slot.
function blockingProvider(gate: Promise<void>): Provider {
  return {
    // Intentionally yields nothing: an empty stream is the test mechanism — once `gate`
    // resolves the run finishes cleanly, the RunObserver transitions running → finished and
    // releases the pool slot. It must stay a generator so the observer consumes it via `for await`.
    // eslint-disable-next-line require-yield
    async *run(): AsyncIterable<BaseEvent> {
      await gate
    },
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('worker cap (F1)', () => {
  it('admits maxInstances=2 and queues the 3rd, then auto-starts it on release', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const AGENT = 'cap-wf__blocker'
    const runtime: AgentRuntime = {
      provider: blockingProvider(gate),
      renderToolNames: [],
      maxInstances: 2,
      effects: {},
      dispatchToolNames: [],
      handoffs: [],
    }
    const service = makePipelineService({
      db,
      resolveAgent: (id) => (id === AGENT ? runtime : undefined),
      descriptors: [],
      instanceKeyOf: (agentId) => agentId,
      sourceOf: () => null,
    })

    const dispatch = () =>
      service.dispatch({
        workflowId: 'cap-wf',
        agentId: AGENT,
        origin: 'agent',
        payload: {},
        source: null,
        parentId: null,
      })
    await dispatch()
    await dispatch()
    await dispatch()

    // wait until the pool has started the 2 admitted runs
    const startedAt = Date.now()
    while ((await service.stats(AGENT)).active < 2 && Date.now() - startedAt < 5000) await sleep(10)

    expect(await service.stats(AGENT)).toEqual({ active: 2, queued: 1 })

    release()

    // the parked runs finish, freeing slots; the queued 3rd auto-starts and (also released) finishes
    const drainAt = Date.now()
    while (Date.now() - drainAt < 5000) {
      const s = await service.stats(AGENT)
      if (s.active + s.queued === 0) break
      await sleep(10)
    }

    expect(await service.stats(AGENT)).toEqual({ active: 0, queued: 0 })
  })
})
