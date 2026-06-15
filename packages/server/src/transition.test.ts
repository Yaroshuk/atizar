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

  it('cancel from running → finished with resolution cancelled', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await transition(db, id, 'cancel')
    const row = await store.getWorkItem(id)
    expect(row?.status).toBe('finished')
    expect(row?.resolution).toBe('cancelled')
  })

  it('cancel is legal from queued and from awaiting_approval', async () => {
    const { id: qId } = await newQueued()
    await transition(db, qId, 'cancel')
    const qRow = await store.getWorkItem(qId)
    expect(qRow?.status).toBe('finished')
    expect(qRow?.resolution).toBe('cancelled')

    const { id: gId } = await newQueued()
    await transition(db, gId, 'start')
    await transition(db, gId, 'gate')
    await transition(db, gId, 'cancel')
    const gRow = await store.getWorkItem(gId)
    expect(gRow?.status).toBe('finished')
    expect(gRow?.resolution).toBe('cancelled')
  })

  it('reject from awaiting_approval → finished with resolution rejected', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await transition(db, id, 'gate')
    await transition(db, id, 'reject')
    const row = await store.getWorkItem(id)
    expect(row?.status).toBe('finished')
    expect(row?.resolution).toBe('rejected')
  })

  it('reject is illegal from running', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await expect(transition(db, id, 'reject')).rejects.toThrow(/cannot "reject"/)
  })

  it('supersede from finished → closed with resolution superseded', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await transition(db, id, 'finish')
    await transition(db, id, 'supersede')
    const row = await store.getWorkItem(id)
    expect(row?.status).toBe('closed')
    expect(row?.resolution).toBe('superseded')
  })

  it('supersede is illegal from running (only a finished/result root can be superseded)', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await expect(transition(db, id, 'supersede')).rejects.toThrow(/cannot "supersede"/)
  })

  it('supersede does NOT cascade to the parent (children stay durable, I12)', async () => {
    const { id: parent } = await newQueued()
    await transition(db, parent, 'start')
    await transition(db, parent, 'finish')
    // a child still active under the parent
    const { id: child } = await newQueued({ parentId: parent })
    await transition(db, child, 'start')
    await transition(db, parent, 'supersede')
    // the child is untouched by the parent's supersede
    expect((await store.getWorkItem(child))?.status).toBe('running')
    expect((await store.getWorkItem(parent))?.status).toBe('closed')
  })
})
