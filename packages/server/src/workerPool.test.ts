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

  it('resumeAcquire reserves a slot ahead of the queue WITHOUT starting the run', () => {
    // The resume stream is driven by runObserver.resume → consume(), not by opts.run.
    // resumeAcquire only reserves the concurrency slot; calling run here would re-issue a
    // transition('start') on an already-running item (the IllegalTransition log we fixed).
    const run = vi.fn()
    const pool = makeWorkerPool({ run })
    pool.enqueue('a', 'X', 2)
    pool.enqueue('b', 'X', 2) // active = 2 (cap)
    pool.enqueue('c', 'X', 2) // queued

    pool.resumeAcquire('d', 'X')
    expect(run).not.toHaveBeenCalledWith('d') // resume is driven by the caller, not the pool
    expect(run.mock.calls.map((c) => c[0])).toEqual(['a', 'b']) // only the two admitted runs
    expect(pool.activeCount('X')).toBe(3) // slot reserved ahead of the queue (may exceed cap)
    expect(pool.queuedCount('X')).toBe(1) // c still waiting
  })

  it('dequeue removes a queued id without starting it', () => {
    const started: string[] = []
    const pool = makeWorkerPool({ run: (id) => started.push(id) })
    pool.enqueue('a', 'agent', 1) // starts a (cap 1)
    pool.enqueue('b', 'agent', 1) // queued
    pool.enqueue('c', 'agent', 1) // queued
    expect(pool.queuedCount('agent')).toBe(2)
    pool.dequeue('b', 'agent')
    expect(pool.queuedCount('agent')).toBe(1)
    pool.release('agent') // frees a → next in queue is c (b was removed)
    expect(started).toEqual(['a', 'c'])
  })
})
