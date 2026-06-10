import { randomUUID } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from './db/client.js'
import { makeStateStore } from './stateStore.js'
import { transition, IllegalTransition } from './transition.js'

const store = makeStateStore(db)
const reachable = await db
  .execute(sql`select 1`)
  .then(() => true)
  .catch(() => false)

const newQueued = (over: Partial<{ parentId: string | null }> = {}) =>
  store.insertWorkItem({
    id: randomUUID(),
    workflowId: 'lead-inbox',
    agentId: 'lead-inbox__reply',
    origin: 'human',
    payload: {},
    parentId: over.parentId ?? null,
  })

describe.skipIf(!reachable)('transition() edge guards (real Postgres)', () => {
  it('walks the happy path queued → running → awaiting_approval → running → finished', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    expect((await store.getWorkItem(id))?.status).toBe('running')
    await transition(db, id, 'gate')
    expect((await store.getWorkItem(id))?.status).toBe('awaiting_approval')
    await transition(db, id, 'resume')
    expect((await store.getWorkItem(id))?.status).toBe('running')
    await transition(db, id, 'finish')
    expect((await store.getWorkItem(id))?.status).toBe('finished')
  })

  it('rejects an illegal edge and leaves the status unchanged', async () => {
    const { id } = await newQueued()
    await expect(transition(db, id, 'gate')).rejects.toBeInstanceOf(IllegalTransition)
    expect((await store.getWorkItem(id))?.status).toBe('queued')
  })

  it('fail sets the error column and status', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await transition(db, id, 'fail', { error: 'boom' })
    const row = await store.getWorkItem(id)
    expect(row?.status).toBe('error')
    expect(row?.error).toBe('boom')
  })
})
