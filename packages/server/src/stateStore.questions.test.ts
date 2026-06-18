import { randomUUID } from 'node:crypto'
import { beforeAll, describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { makeStateStore } from './stateStore.js'

const store = makeStateStore(db)
const reachable = await db
  .execute(sql`select 1`)
  .then(() => true)
  .catch(() => false)

describe.skipIf(!reachable)('stateStore questions (real Postgres)', () => {
  beforeAll(async () => {
    await runMigrations()
  })

  const newAsker = () => ({
    id: randomUUID(),
    workflowId: 'lead-inbox',
    agentId: 'lead-inbox__qualifier',
    origin: 'agent' as const,
    payload: { source: 'test' },
    key: randomUUID(),
  })

  it('insert → pending → answer transitions a question', async () => {
    const asker = await store.insertWorkItem(newAsker())
    const q = await store.insertQuestion({
      askerWorkItemId: asker.id,
      target: { agentId: 'x' },
      toolCallId: 'tc1',
      payload: { q: 'how?' },
    })
    expect(q.status).toBe('open')
    expect(q.askerWorkItemId).toBe(asker.id)

    expect((await store.getPendingQuestionsForAsker(asker.id)).length).toBe(1)

    await store.answerQuestion(q.id, { text: 'use X' })

    expect((await store.getPendingQuestionsForAsker(asker.id)).length).toBe(0)
  })

  it('failQuestion removes it from pending', async () => {
    const asker = await store.insertWorkItem(newAsker())
    const q = await store.insertQuestion({
      askerWorkItemId: asker.id,
      target: {},
      toolCallId: 'tc',
      payload: {},
    })
    await store.failQuestion(q.id, 'answerer crashed')
    expect((await store.getPendingQuestionsForAsker(asker.id)).length).toBe(0)
  })

  it('getExpiredQuestions returns open questions past the deadline', async () => {
    const asker = await store.insertWorkItem(newAsker())
    // Insert a question with a deadline in the past
    const q = await store.insertQuestion({
      askerWorkItemId: asker.id,
      target: { agentId: 'y' },
      toolCallId: 'tc-expired',
      payload: { q: 'expired?' },
      deadline: new Date(Date.now() - 5000), // 5 seconds ago
    })
    const expired = await store.getExpiredQuestions(Date.now())
    expect(expired.some((e) => e.id === q.id)).toBe(true)
  })

  it('getExpiredQuestions does not return answered questions', async () => {
    const asker = await store.insertWorkItem(newAsker())
    const q = await store.insertQuestion({
      askerWorkItemId: asker.id,
      target: {},
      toolCallId: 'tc-ans-exp',
      payload: {},
      deadline: new Date(Date.now() - 5000),
    })
    await store.answerQuestion(q.id, { text: 'answered' })
    const expired = await store.getExpiredQuestions(Date.now())
    expect(expired.some((e) => e.id === q.id)).toBe(false)
  })
})
