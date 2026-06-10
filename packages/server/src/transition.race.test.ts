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

async function running(parentId: string | null = null) {
  const { id } = await store.insertWorkItem({
    id: randomUUID(),
    workflowId: 'lead-inbox',
    agentId: 'lead-inbox__reply',
    origin: 'agent',
    payload: {},
    parentId,
  })
  await transition(db, id, 'start')
  return id
}

describe.skipIf(!reachable)('transition race (real Postgres, FOR UPDATE)', () => {
  it('two siblings finishing concurrently auto-finish the parent exactly once', async () => {
    // Repeat a few times to shake out interleavings.
    for (let i = 0; i < 5; i++) {
      const parent = await running()
      const a = await running(parent)
      const b = await running(parent)

      // No throw, no lost update: the parent ends finished exactly once.
      await Promise.all([transition(db, a, 'finish'), transition(db, b, 'finish')])

      expect((await store.getWorkItem(parent))?.status).toBe('finished')
      expect((await store.getWorkItem(a))?.status).toBe('finished')
      expect((await store.getWorkItem(b))?.status).toBe('finished')
    }
  })
})
