import { describe, it, expect } from 'vitest'
import { makeWorkerPool } from './workerPool.js'

// A fake DB backed by a per-agent counter Map. Because the pool calls activate(id) without the
// agentId, the harness tracks which agentId each item belongs to via a registration map so it can
// credit the right per-agent counter.
function harness(cap: number) {
  const counts = new Map<string, number>()
  // item id → agentId, populated when pool.enqueue is called via a wrapper
  const itemAgent = new Map<string, string>()
  const started: string[] = []

  const getCount = (agentId: string) => counts.get(agentId) ?? 0

  const pool = makeWorkerPool({
    run: (id) => started.push(id),
    activeCount: async (agentId) => getCount(agentId),
    activate: async (id) => {
      const agentId = itemAgent.get(id) ?? 'X'
      counts.set(agentId, getCount(agentId) + 1)
    },
  })

  // Wrap enqueue to register the item→agent mapping before delegating.
  const enqueue = (id: string, agentId: string, c = cap) => {
    itemAgent.set(id, agentId)
    pool.enqueue(id, agentId, c)
  }

  return {
    pool,
    enqueue,
    started,
    free: (agentId = 'X') => {
      counts.set(agentId, Math.max(0, getCount(agentId) - 1))
    },
    activeOf: (agentId: string) => getCount(agentId),
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('WorkerPool (DB-derived occupancy)', () => {
  it('starts up to the cap, queues the overflow', async () => {
    const h = harness(2)
    h.enqueue('a', 'X')
    h.enqueue('b', 'X')
    h.enqueue('c', 'X')
    await tick()
    expect(h.started).toEqual(['a', 'b'])
    expect(h.pool.queuedCount('X')).toBe(1)
  })

  it('reconcile starts the next queued id when a slot frees', async () => {
    const h = harness(2)
    h.enqueue('a', 'X')
    h.enqueue('b', 'X')
    h.enqueue('c', 'X')
    await tick()
    h.free() // a finished
    h.pool.reconcile('X')
    await tick()
    expect(h.started).toContain('c')
    expect(h.pool.queuedCount('X')).toBe(0)
  })

  it('dequeue removes a queued id before it starts', async () => {
    const h = harness(1)
    h.enqueue('a', 'X')
    h.enqueue('b', 'X')
    await tick()
    h.pool.dequeue('b', 'X')
    expect(h.pool.queuedCount('X')).toBe(0)
  })

  it('activate-throws: drops the failing id and starts the next queued id', async () => {
    // activate rejects for id 'b' (raced out of queued/cancelled); cap high enough all should start.
    const started: string[] = []
    let active = 0
    const pool = makeWorkerPool({
      run: (id) => started.push(id),
      activeCount: async () => active,
      activate: async (id) => {
        if (id === 'b') throw new Error('raced: already cancelled')
        active++
      },
    })

    pool.enqueue('a', 'X', 10)
    pool.enqueue('b', 'X', 10)
    pool.enqueue('c', 'X', 10)
    await tick()

    expect(started).toContain('a')
    expect(started).toContain('c')
    expect(started).not.toContain('b')
    expect(pool.queuedCount('X')).toBe(0)
  })

  it('caps are isolated per agent: each agent starts 1 and queues 1', async () => {
    const h = harness(1)
    h.enqueue('x1', 'X')
    h.enqueue('x2', 'X')
    h.enqueue('y1', 'Y')
    h.enqueue('y2', 'Y')
    await tick()

    // Each agent should have started exactly its first item; the second is queued
    expect(h.started).toContain('x1')
    expect(h.started).toContain('y1')
    expect(h.started).not.toContain('x2')
    expect(h.started).not.toContain('y2')
    expect(h.pool.queuedCount('X')).toBe(1)
    expect(h.pool.queuedCount('Y')).toBe(1)
  })
})
