import { describe, it, expect, vi } from 'vitest'
import { makeWorkerPool } from './workerPool.js'

describe('WorkerPool (cap + queue)', () => {
  it('starts up to the cap and queues the overflow', () => {
    const run = vi.fn()
    const pool = makeWorkerPool({ run })

    pool.enqueue('a', 'X', 2)
    pool.enqueue('b', 'X', 2)
    pool.enqueue('c', 'X', 2)

    expect(run.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
    expect(pool.activeCount('X')).toBe(2)
    expect(pool.queuedCount('X')).toBe(1)
  })

  it('drains the queue on release, oldest first', () => {
    const run = vi.fn()
    const pool = makeWorkerPool({ run })
    pool.enqueue('a', 'X', 2)
    pool.enqueue('b', 'X', 2)
    pool.enqueue('c', 'X', 2)
    pool.enqueue('d', 'X', 2)

    pool.release('X')
    expect(run).toHaveBeenLastCalledWith('c')
    pool.release('X')
    expect(run).toHaveBeenLastCalledWith('d')
    expect(pool.queuedCount('X')).toBe(0)
  })

  it('isolates caps per agent', () => {
    const run = vi.fn()
    const pool = makeWorkerPool({ run })
    pool.enqueue('a', 'X', 1)
    pool.enqueue('b', 'Y', 1)
    pool.enqueue('c', 'X', 1) // queued — X is full
    expect(pool.activeCount('X')).toBe(1)
    expect(pool.activeCount('Y')).toBe(1)
    expect(pool.queuedCount('X')).toBe(1)
  })

  it('resumeAcquire bypasses the queue (continuing work has priority)', () => {
    const run = vi.fn()
    const pool = makeWorkerPool({ run })
    pool.enqueue('a', 'X', 2)
    pool.enqueue('b', 'X', 2)
    pool.enqueue('c', 'X', 2) // queued

    pool.resumeAcquire('d', 'X')
    expect(run).toHaveBeenLastCalledWith('d') // ran immediately, ahead of c
    expect(pool.queuedCount('X')).toBe(1) // c still waiting
  })
})
