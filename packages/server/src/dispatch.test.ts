import { randomUUID } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from './db/client.js'
import { makeStateStore } from './stateStore.js'
import { transition } from './transition.js'
import { dispatch, DepthExceeded, DEPTH_CAP } from './dispatch.js'
import type { WorkerPool } from './workerPool.js'

const store = makeStateStore(db)
const reachable = await db
  .execute(sql`select 1`)
  .then(() => true)
  .catch(() => false)

function fakePool() {
  const enqueue = vi.fn<(id: string, agentId: string, cap: number) => void>()
  const pool: WorkerPool = {
    enqueue,
    dequeue: vi.fn(),
    reconcile: vi.fn(),
    activeCount: async () => 0,
    queuedCount: () => 0,
  }
  return { pool, enqueue }
}

const base = {
  workflowId: 'lead-inbox',
  agentId: 'lead-inbox__reply',
  origin: 'human' as const,
  payload: {},
  maxInstances: 2,
  key: 'lead-inbox__reply',
}

describe.skipIf(!reachable)('dispatch() chokepoint (real Postgres)', () => {
  it('mints a queued WorkItem and enqueues it', async () => {
    const { pool, enqueue } = fakePool()
    const source = `thread:${randomUUID()}`
    const { id, deduped } = await dispatch(db, pool, { ...base, source })
    expect(deduped).toBe(false)
    expect((await store.getWorkItem(id))?.phase).toBe('queued')
    expect(enqueue).toHaveBeenCalledWith(id, 'lead-inbox__reply', 2)
  })

  it('dedups a repeated source while the first is live (no second row, no enqueue)', async () => {
    const { pool, enqueue } = fakePool()
    const source = `thread:${randomUUID()}`
    const first = await dispatch(db, pool, { ...base, source })
    enqueue.mockClear()

    const second = await dispatch(db, pool, { ...base, source })
    expect(second).toEqual({ id: first.id, deduped: true })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('does NOT dedup when source is absent', async () => {
    const { pool } = fakePool()
    const a = await dispatch(db, pool, base)
    const b = await dispatch(db, pool, base)
    expect(a.id).not.toBe(b.id)
  })

  it('throws DepthExceeded past the depth cap', async () => {
    const { pool } = fakePool()
    let parentId: string | null = null
    // Build a legal chain up to the cap.
    for (let depth = 0; depth < DEPTH_CAP; depth++) {
      const r: { id: string } = await dispatch(db, pool, { ...base, origin: 'agent', parentId })
      parentId = r.id
    }
    // One more exceeds it.
    await expect(dispatch(db, pool, { ...base, origin: 'agent', parentId })).rejects.toBeInstanceOf(
      DepthExceeded
    )
  })

  it('finish-vs-dispatch race: a new child keeps the parent active', async () => {
    const { pool } = fakePool()
    for (let i = 0; i < 5; i++) {
      const { id: parent } = await dispatch(db, pool, { ...base })
      await transition(db, parent, 'start')
      const { id: a } = await dispatch(db, pool, { ...base, origin: 'agent', parentId: parent })
      await transition(db, a, 'start')

      await Promise.all([
        transition(db, a, 'finish'),
        dispatch(db, pool, { ...base, origin: 'agent', parentId: parent }),
      ])

      // The parent must NOT be terminal — a freshly dispatched child is active under it.
      expect((await store.getWorkItem(parent))?.phase).not.toBe('terminal')
    }
  })

  it('re-surfaces a source whose prior item is superseded (un-actioned terminal)', async () => {
    const { pool } = fakePool()
    const source = `thread:${randomUUID()}`
    const first = await dispatch(db, pool, { ...base, source })
    // drive the first item to terminal+superseded (a stale scan's leaf)
    await transition(db, first.id, 'start')
    await transition(db, first.id, 'finish')
    await transition(db, first.id, 'supersede')

    const second = await dispatch(db, pool, { ...base, source })
    expect(second.deduped).toBe(false)
    expect(second.id).not.toBe(first.id)
  })

  it('still dedups a source whose prior item is DONE (terminal/done covers)', async () => {
    const { pool } = fakePool()
    const source = `thread:${randomUUID()}`
    const first = await dispatch(db, pool, { ...base, source })
    await transition(db, first.id, 'start')
    await transition(db, first.id, 'finish')

    const second = await dispatch(db, pool, { ...base, source })
    expect(second).toEqual({ id: first.id, deduped: true })
  })

  it('still dedups a source whose prior item is live (running)', async () => {
    const { pool } = fakePool()
    const source = `thread:${randomUUID()}`
    const first = await dispatch(db, pool, { ...base, source })
    await transition(db, first.id, 'start')
    const second = await dispatch(db, pool, { ...base, source })
    expect(second).toEqual({ id: first.id, deduped: true })
  })

  it('a stopped same-source item COVERS (no phantom twin)', async () => {
    const { pool } = fakePool()
    const src = `cover-${randomUUID()}`
    const first = await dispatch(db, pool, { ...base, source: src })
    await transition(db, first.id, 'start')
    await transition(db, first.id, 'cancel') // outcome=stopped → covers
    const second = await dispatch(db, pool, { ...base, source: src })
    expect(second.deduped).toBe(true)
    expect(second.id).toBe(first.id)
  })

  it('a rejected same-source item COVERS (declining the action is handled — no re-offer)', async () => {
    const { pool } = fakePool()
    const src = `cover-rej-${randomUUID()}`
    const first = await dispatch(db, pool, { ...base, source: src })
    await transition(db, first.id, 'start')
    await transition(db, first.id, 'gate')
    await transition(db, first.id, 'reject') // outcome=rejected → COVERS (handled, do not re-surface)
    const second = await dispatch(db, pool, { ...base, source: src })
    expect(second.deduped).toBe(true)
    expect(second.id).toBe(first.id)
  })

  it('stores the caller-supplied key on the work item', async () => {
    const { pool } = fakePool()
    const { id } = await dispatch(db, pool, { ...base, key: 'alice@example.com' })
    expect((await store.getWorkItem(id))?.key).toBe('alice@example.com')
  })

  it('stamps episodeSeq: first run = 1, live sibling inherits, fully-receded restart bumps', async () => {
    const { pool } = fakePool()
    const key = `sender-${randomUUID()}@x.com`
    const episodeOf = async (id: string) => (await store.getWorkItem(id))?.episodeSeq

    // first run for the key → episode 1
    const a = await dispatch(db, pool, { ...base, key })
    expect(await episodeOf(a.id)).toBe(1)

    // a SECOND run while the first is still live (queued) → same episode
    const b = await dispatch(db, pool, { ...base, key })
    expect(await episodeOf(b.id)).toBe(1)

    // drive BOTH to terminal (instance fully receded)
    await transition(db, a.id, 'start')
    await transition(db, a.id, 'finish')
    await transition(db, b.id, 'start')
    await transition(db, b.id, 'finish')

    // a NEW run after full recede → fresh episode 2
    const c = await dispatch(db, pool, { ...base, key })
    expect(await episodeOf(c.id)).toBe(2)
  })
})
