import { randomUUID } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from './db/client.js'
import { makeStateStore } from './stateStore.js'
import { makeEventBus } from './eventBus.js'
import { settle } from './settle.js'

const store = makeStateStore(db)
const reachable = await db
  .execute(sql`select 1`)
  .then(() => true)
  .catch(() => false)

const newActive = async () => {
  const row = await store.insertWorkItem({
    id: randomUUID(),
    workflowId: 'lead-inbox',
    agentId: 'lead-inbox__reply',
    origin: 'human',
    payload: {},
  })
  const { transition } = await import('./transition.js')
  await transition(db, row.id, 'start')
  return row.id
}

describe.skipIf(!reachable)('settle() — the one terminal writer', () => {
  it('cancel: terminal/stopped + a lifecycle trace note + an audit row', async () => {
    const id = await newActive()
    const bus = makeEventBus()
    const seen: unknown[] = []
    bus.subscribe(`workitem:${id}`, (m) => seen.push(m))
    await settle({ db, store, bus, reconcile: () => {} }, id, 'cancel', 'tester')

    const wi = await store.getWorkItem(id)
    expect(wi?.phase).toBe('terminal')
    expect(wi?.outcome).toBe('stopped')

    const trace = await store.getTrace(id, 0)
    const note = trace.find((t) => (t.event as any).name === 'lifecycle')
    expect(note).toBeTruthy()
    expect((note?.event as any).value.outcome).toBe('stopped')

    const audit = await store.getAuditByWorkItem(id)
    expect(audit.some((a) => a.kind === 'lifecycle')).toBe(true)
  })

  it('appends the note BEFORE the terminal status publish (no SSE race)', async () => {
    const id = await newActive()
    const bus = makeEventBus()
    const order: string[] = []
    bus.subscribe(`workitem:${id}`, (m: any) => {
      if (m.event?.name === 'lifecycle') order.push('note')
      if (m.kind === 'status') order.push('status')
    })
    await settle({ db, store, bus, reconcile: () => {} }, id, 'finish', null)
    expect(order.indexOf('note')).toBeLessThan(order.indexOf('status'))
  })
})
