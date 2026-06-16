import { describe, it, expect } from 'vitest'
import { makeWorkerPool } from './workerPool.js'

// A fake DB count: `activate` flips an id to active (++) — the pool now owns the flip, committed
// before run() — and the test flips it back to free a slot. `run` only records the start.
function harness(cap: number) {
  let active = 0
  const started: string[] = []
  const pool = makeWorkerPool({
    run: (id) => {
      started.push(id)
    },
    activeCount: async () => active,
    activate: async (_id) => {
      active++
    },
  })
  return {
    pool,
    started,
    free: () => {
      active = Math.max(0, active - 1)
    },
    get active() {
      return active
    },
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('WorkerPool (DB-derived occupancy)', () => {
  it('starts up to the cap, queues the overflow', async () => {
    const h = harness(2)
    h.pool.enqueue('a', 'X', 2)
    h.pool.enqueue('b', 'X', 2)
    h.pool.enqueue('c', 'X', 2)
    await tick()
    expect(h.started).toEqual(['a', 'b'])
    expect(h.pool.queuedCount('X')).toBe(1)
  })

  it('reconcile starts the next queued id when a slot frees', async () => {
    const h = harness(2)
    h.pool.enqueue('a', 'X', 2)
    h.pool.enqueue('b', 'X', 2)
    h.pool.enqueue('c', 'X', 2)
    await tick()
    h.free() // a finished
    h.pool.reconcile('X')
    await tick()
    expect(h.started).toContain('c')
    expect(h.pool.queuedCount('X')).toBe(0)
  })

  it('dequeue removes a queued id before it starts', async () => {
    const h = harness(1)
    h.pool.enqueue('a', 'X', 1)
    h.pool.enqueue('b', 'X', 1)
    await tick()
    h.pool.dequeue('b', 'X')
    expect(h.pool.queuedCount('X')).toBe(0)
  })
})
