import { randomUUID } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from './db/client.js'
import { makeStateStore } from './stateStore.js'
import { transition } from './transition.js'

const store = makeStateStore(db)
const reachable = await db
  .execute(sql`select 1`)
  .then(() => true)
  .catch(() => false)

const child = (parentId: string | null) =>
  store.insertWorkItem({
    id: randomUUID(),
    workflowId: 'lead-inbox',
    agentId: 'lead-inbox__reply',
    origin: 'agent',
    payload: {},
    parentId,
  })

// Start a fresh running item (optionally under a parent).
async function running(parentId: string | null = null) {
  const { id } = await child(parentId)
  await transition(db, id, 'start')
  return id
}

describe.skipIf(!reachable)('auto-finish parent walk (real Postgres)', () => {
  it('finishes the parent only once ALL children are terminal', async () => {
    const parent = await running()
    const a = await running(parent)
    const b = await running(parent)

    await transition(db, a, 'finish')
    expect((await store.getWorkItem(parent))?.status).toBe('running') // b still active

    await transition(db, b, 'finish')
    expect((await store.getWorkItem(parent))?.status).toBe('finished') // now auto-finished
  })

  it('does NOT auto-finish a parent with a queued child', async () => {
    const parent = await running()
    const a = await running(parent)
    await child(parent) // queued, never started

    await transition(db, a, 'finish')
    expect((await store.getWorkItem(parent))?.status).toBe('running')
  })

  it('walks to the root (grandparent auto-finishes)', async () => {
    const root = await running()
    const mid = await running(root)
    const leaf = await running(mid)

    await transition(db, leaf, 'finish')
    expect((await store.getWorkItem(mid))?.status).toBe('finished')
    expect((await store.getWorkItem(root))?.status).toBe('finished')
  })
})
