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
    key: 'lead-inbox__reply',
    parentId: over.parentId ?? null,
  })

describe.skipIf(!reachable)('transition() edge guards (real Postgres)', () => {
  it('walks queued → active → awaiting_human → active → terminal/done', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    expect((await store.getWorkItem(id))?.phase).toBe('active')
    await transition(db, id, 'gate')
    expect((await store.getWorkItem(id))?.phase).toBe('awaiting_human')
    await transition(db, id, 'resume')
    expect((await store.getWorkItem(id))?.phase).toBe('active')
    await transition(db, id, 'finish')
    const done = await store.getWorkItem(id)
    expect(done?.phase).toBe('terminal')
    expect(done?.outcome).toBe('done')
  })

  it('rejects an illegal edge and leaves the row unchanged', async () => {
    const { id } = await newQueued()
    await expect(transition(db, id, 'gate')).rejects.toBeInstanceOf(IllegalTransition)
    expect((await store.getWorkItem(id))?.phase).toBe('queued')
  })

  it('cancel stamps outcome=stopped', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await transition(db, id, 'cancel')
    const w = await store.getWorkItem(id)
    expect(w?.phase).toBe('terminal')
    expect(w?.outcome).toBe('stopped')
  })

  it('reopen lifts a finished item back to active (finish-vs-dispatch race)', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await transition(db, id, 'finish')
    await transition(db, id, 'reopen')
    expect((await store.getWorkItem(id))?.phase).toBe('active')
  })

  it('reopen is illegal from a human-terminal outcome (only a clean done reopens)', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await transition(db, id, 'cancel') // outcome=stopped
    await expect(transition(db, id, 'reopen')).rejects.toBeInstanceOf(IllegalTransition)
  })

  it('fail sets the error column and phase/outcome', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await transition(db, id, 'fail', { error: 'boom' })
    const row = await store.getWorkItem(id)
    expect(row?.phase).toBe('terminal')
    expect(row?.outcome).toBe('error')
    expect(row?.error).toBe('boom')
  })

  it('cancel from active → terminal with outcome stopped', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await transition(db, id, 'cancel')
    const row = await store.getWorkItem(id)
    expect(row?.phase).toBe('terminal')
    expect(row?.outcome).toBe('stopped')
  })

  it('cancel is legal from queued and from awaiting_human', async () => {
    const { id: qId } = await newQueued()
    await transition(db, qId, 'cancel')
    const qRow = await store.getWorkItem(qId)
    expect(qRow?.phase).toBe('terminal')
    expect(qRow?.outcome).toBe('stopped')

    const { id: gId } = await newQueued()
    await transition(db, gId, 'start')
    await transition(db, gId, 'gate')
    await transition(db, gId, 'cancel')
    const gRow = await store.getWorkItem(gId)
    expect(gRow?.phase).toBe('terminal')
    expect(gRow?.outcome).toBe('stopped')
  })

  it('reject from awaiting_human → terminal with outcome rejected', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await transition(db, id, 'gate')
    await transition(db, id, 'reject')
    const row = await store.getWorkItem(id)
    expect(row?.phase).toBe('terminal')
    expect(row?.outcome).toBe('rejected')
  })

  it('reject is illegal from active', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await expect(transition(db, id, 'reject')).rejects.toThrow(/cannot "reject"/)
  })

  it('supersede from terminal → terminal with outcome superseded', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await transition(db, id, 'finish')
    await transition(db, id, 'supersede')
    const row = await store.getWorkItem(id)
    expect(row?.phase).toBe('terminal')
    expect(row?.outcome).toBe('superseded')
  })

  it('supersede is illegal from active (only a terminal root can be superseded)', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await expect(transition(db, id, 'supersede')).rejects.toThrow(/cannot "supersede"/)
  })

  it('reset from terminal → terminal with outcome reset', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await transition(db, id, 'finish')
    await transition(db, id, 'reset')
    const row = await store.getWorkItem(id)
    expect(row?.phase).toBe('terminal')
    expect(row?.outcome).toBe('reset')
  })

  it('reset from terminal/error → terminal with outcome reset', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await transition(db, id, 'fail', { error: 'boom' })
    await transition(db, id, 'reset')
    const row = await store.getWorkItem(id)
    expect(row?.phase).toBe('terminal')
    expect(row?.outcome).toBe('reset')
  })

  it('reset is illegal from active (must cancel first)', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await expect(transition(db, id, 'reset')).rejects.toThrow(/cannot "reset"/)
    expect((await store.getWorkItem(id))?.phase).toBe('active')
  })

  it('reset is illegal from awaiting_human (must cancel first)', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await transition(db, id, 'gate')
    await expect(transition(db, id, 'reset')).rejects.toThrow(/cannot "reset"/)
    expect((await store.getWorkItem(id))?.phase).toBe('awaiting_human')
  })

  it('a parent finishes on its OWN finish edge regardless of live children (Approach B)', async () => {
    const { id: root } = await newQueued()
    const { id: child } = await newQueued({ parentId: root })
    await transition(db, root, 'start')
    await transition(db, child, 'start')
    await transition(db, child, 'gate') // child awaiting
    await transition(db, root, 'finish')
    expect((await store.getWorkItem(root))?.phase).toBe('terminal') // NOT deferred to active
    expect((await store.getWorkItem(child))?.phase).toBe('awaiting_human') // child untouched
  })

  it('a child reaching terminal does NOT change its parent (no auto-finish walk)', async () => {
    const { id: root } = await newQueued()
    const { id: child } = await newQueued({ parentId: root })
    await transition(db, root, 'start') // parent still active (its own run in flight)
    await transition(db, child, 'start')
    await transition(db, child, 'gate')
    await transition(db, child, 'reject')
    expect((await store.getWorkItem(root))?.phase).toBe('active') // parent unaffected by the child
  })

  it('acknowledge moves terminal/error → terminal/dismissed', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await transition(db, id, 'fail', { error: 'boom' }) // terminal/error
    await transition(db, id, 'acknowledge')
    const w = await store.getWorkItem(id)
    expect(w?.phase).toBe('terminal')
    expect(w?.outcome).toBe('dismissed')
  })

  it('acknowledge is illegal from a non-error terminal (only an error acknowledges)', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await transition(db, id, 'finish') // terminal/done
    await expect(transition(db, id, 'acknowledge')).rejects.toBeInstanceOf(IllegalTransition)
  })

  it('acknowledge is illegal from a live phase', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start') // active
    await expect(transition(db, id, 'acknowledge')).rejects.toBeInstanceOf(IllegalTransition)
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
    expect((await store.getWorkItem(child))?.phase).toBe('active')
    expect((await store.getWorkItem(parent))?.phase).toBe('terminal')
    expect((await store.getWorkItem(parent))?.outcome).toBe('superseded')
  })

  it('ask suspends an active item into awaiting_agent', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await transition(db, id, 'ask')
    const wi = await store.getWorkItem(id)
    expect(wi?.phase).toBe('awaiting_agent')
    expect(wi?.outcome).toBe('running')
  })

  it('answered resumes an awaiting_agent item to active', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await transition(db, id, 'ask')
    await transition(db, id, 'answered')
    const wi = await store.getWorkItem(id)
    expect(wi?.phase).toBe('active')
    expect(wi?.outcome).toBe('running')
  })

  it('ask is illegal from a terminal item', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await transition(db, id, 'finish')
    await expect(transition(db, id, 'ask')).rejects.toThrow(/cannot "ask"/)
  })

  it('cancel is legal from awaiting_agent', async () => {
    const { id } = await newQueued()
    await transition(db, id, 'start')
    await transition(db, id, 'ask')
    await transition(db, id, 'cancel')
    const wi = await store.getWorkItem(id)
    expect(wi?.phase).toBe('terminal')
    expect(wi?.outcome).toBe('stopped')
  })
})
