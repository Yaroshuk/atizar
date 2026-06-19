import { randomUUID } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { EventType, type BaseEvent } from '@ag-ui/client'
import { db } from './db/client.js'
import { makeStateStore } from './stateStore.js'
import { transition } from './transition.js'

// Real-PG integration tests. They share ONE database with the other pipeline test files,
// so every test mints UNIQUE uuids/sources and asserts only on its own rows (no global
// truncate — that would clobber a parallel test file). Skips with a clear log when the
// container is unreachable so core-only `yarn test` still runs.
const store = makeStateStore(db)

const reachable = await db
  .execute(sql`select 1`)
  .then(() => true)
  .catch(() => false)

const textEvent = (text: string): BaseEvent =>
  ({ type: EventType.TEXT_MESSAGE_CHUNK, delta: text }) as unknown as BaseEvent

describe.skipIf(!reachable)('StateStore (real Postgres)', () => {
  if (!reachable) console.warn('[stateStore.test] DATABASE_URL unreachable — skipping')

  const newItem = () => ({
    id: randomUUID(),
    workflowId: 'lead-inbox',
    agentId: 'lead-inbox__reply',
    origin: 'human' as const,
    payload: { hello: 'world' },
    key: 'lead-inbox__reply',
  })

  it('inserts a queued WorkItem and reads it back', async () => {
    const input = newItem()
    const inserted = await store.insertWorkItem(input)
    expect(inserted.phase).toBe('queued')
    expect(inserted.id).toBe(input.id)

    const read = await store.getWorkItem(input.id)
    expect(read?.payload).toEqual({ hello: 'world' })
    expect(read?.workflowId).toBe('lead-inbox')
  })

  it('appends trace rows and reads them back from a cursor, ordered', async () => {
    const { id } = await store.insertWorkItem(newItem())
    await store.appendTrace(id, 0, textEvent('a'))
    await store.appendTrace(id, 1, textEvent('b'))
    await store.appendTrace(id, 2, textEvent('c'))

    const all = await store.getTrace(id, 0)
    expect(all.map((r) => r.seq)).toEqual([0, 1, 2])

    const fromOne = await store.getTrace(id, 1)
    expect(fromOne.map((r) => r.seq)).toEqual([1, 2])
  })

  it('surfaces the item in the board snapshot', async () => {
    const { id } = await store.insertWorkItem(newItem())
    const { items } = await store.getBoardSnapshot()
    expect(items.some((i) => i.id === id)).toBe(true)
  })

  it('inserts a gate and finds the open one for a work item', async () => {
    const { id } = await store.insertWorkItem(newItem())
    const gate = await store.insertGate({
      workItemId: id,
      toolName: 'saveDraft',
      toolCallId: 'toolu_x',
      proposedArtifact: { to: 'a@b.c', body: 'draft' },
    })
    expect(gate.status).toBe('open')
    expect(gate.form).toEqual({ to: 'a@b.c', body: 'draft' })

    const open = await store.getOpenGate(id)
    expect(open?.id).toBe(gate.id)

    await store.resolveGateRow(gate.id, { resolvedBy: 'tester' })
    expect(await store.getOpenGate(id)).toBeUndefined()
  })

  it('claimLedger is idempotent — second claim reports alreadyClaimed with the prior result', async () => {
    const store = makeStateStore(db)
    const wi = await store.insertWorkItem({
      workflowId: 'wf',
      agentId: 'wf__a',
      origin: 'human',
      payload: {},
      key: 'wf__a',
    })
    const gateId = randomUUID()
    const key = `${wi.id}:${gateId}`
    const first = await store.claimLedger({ key, workItemId: wi.id, gateId })
    expect(first.alreadyClaimed).toBe(false)
    await store.setLedgerResult(key, { draftId: 'd1' })
    const second = await store.claimLedger({ key, workItemId: wi.id, gateId })
    expect(second.alreadyClaimed).toBe(true)
    expect(second.result).toEqual({ draftId: 'd1' })
  })

  it('getGate returns a gate by id', async () => {
    const store = makeStateStore(db)
    const wi = await store.insertWorkItem({
      workflowId: 'wf',
      agentId: 'wf__a',
      origin: 'human',
      payload: {},
      key: 'wf__a',
    })
    const gate = await store.insertGate({
      workItemId: wi.id,
      toolName: 'saveDraft',
      toolCallId: 'tc1',
      proposedArtifact: { threadId: 't', body: 'b' },
    })
    expect((await store.getGate(gate.id))?.id).toBe(gate.id)
  })

  it('countActiveByAgent counts only active-phase rows of that agent', async () => {
    const store = makeStateStore(db)
    // Unique per run so parallel/re-runs don't accumulate stale rows (shared DB, no truncate).
    const a = `lead-inbox__countA-${randomUUID()}`
    const mk = async () =>
      (
        await store.insertWorkItem({
          workflowId: 'lead-inbox',
          agentId: a,
          origin: 'human',
          payload: {},
          key: a,
        })
      ).id
    const id1 = await mk()
    await transition(db, id1, 'start') // active
    const id2 = await mk()
    await transition(db, id2, 'start')
    await transition(db, id2, 'finish') // terminal
    expect(await store.countActiveByAgent(a)).toBe(1)
  })

  it('hasLiveInputScan: true when a root has an awaiting-approval descendant, false when all settled', async () => {
    const store = makeStateStore(db)
    const workflowId = `wf-${randomUUID()}`
    const agentId = `${workflowId}__sorter`
    const root = await store.insertWorkItem({
      workflowId,
      agentId,
      origin: 'human',
      payload: {},
      key: agentId,
    })
    const child = await store.insertWorkItem({
      workflowId,
      agentId: `${workflowId}__reply`,
      origin: 'agent',
      parentId: root.id,
      payload: {},
      key: `${workflowId}__reply`,
    })
    // root finished (Approach B: finishes on its own run-end), child still awaiting → scan is LIVE
    await transition(db, root.id, 'start')
    await transition(db, root.id, 'finish')
    await transition(db, child.id, 'start')
    await transition(db, child.id, 'gate')
    expect(await store.hasLiveInputScan(workflowId, agentId)).toBe(true)
    // child settles → scan no longer live
    await transition(db, child.id, 'reject')
    expect(await store.hasLiveInputScan(workflowId, agentId)).toBe(false)
  })
})

describe.skipIf(!reachable)('session isolation (tenant scoping)', () => {
  it('getBoardSnapshot returns only the tenant’s items', async () => {
    const wf = `wf-${randomUUID()}`
    const a = await store.insertWorkItem({
      workflowId: wf,
      agentId: `${wf}__sorter`,
      origin: 'human',
      payload: {},
      key: 'k',
      sessionId: 'aaa',
    })
    const b = await store.insertWorkItem({
      workflowId: wf,
      agentId: `${wf}__sorter`,
      origin: 'human',
      payload: {},
      key: 'k',
      sessionId: 'bbb',
    })
    const ids = (await store.getBoardSnapshot('aaa')).items.map((i) => i.id)
    expect(ids).toContain(a.id)
    expect(ids).not.toContain(b.id)
  })

  it('getActiveByWorkflow + hasLiveInputScan are tenant-scoped', async () => {
    const wf = `wf-${randomUUID()}`
    const agent = `${wf}__sorter`
    const a = await store.insertWorkItem({
      workflowId: wf,
      agentId: agent,
      origin: 'human',
      payload: {},
      key: agent,
      sessionId: 'aaa',
    })
    await transition(db, a.id, 'start')
    expect((await store.getActiveByWorkflow(wf, 'aaa')).map((i) => i.id)).toContain(a.id)
    expect(await store.getActiveByWorkflow(wf, 'bbb')).toHaveLength(0)
    expect(await store.hasLiveInputScan(wf, agent, 'aaa')).toBe(true)
    expect(await store.hasLiveInputScan(wf, agent, 'bbb')).toBe(false)
  })

  it('defaults to global when no sessionId (non-demo unchanged)', async () => {
    const wf = `wf-${randomUUID()}`
    const g = await store.insertWorkItem({
      workflowId: wf,
      agentId: `${wf}__sorter`,
      origin: 'human',
      payload: {},
      key: 'k',
    })
    expect((await store.getBoardSnapshot('global')).items.map((i) => i.id)).toContain(g.id)
  })
})
