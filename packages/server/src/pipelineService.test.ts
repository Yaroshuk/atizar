import { randomUUID } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import {
  defineAgent,
  defineWorkflow,
  gateOpened,
  type EffectFn,
  type GateResolution,
  type Provider,
  type ResumeHandle,
} from '@platform/core'
import { db } from './db/client.js'
import { makePipelineService } from './pipelineService.js'
import type { AgentRuntime } from './runObserver.js'

const reachable = await db
  .execute(sql`select 1`)
  .then(() => true)
  .catch(() => false)

const ev = (e: Record<string, unknown>): BaseEvent => e as unknown as BaseEvent

// A gate-opening provider (run → gate; resume → finish).
function gateProvider(): Provider {
  return {
    async *run(_input: RunAgentInput) {
      yield ev({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm1', delta: 'work' })
      yield gateOpened({
        gateKind: 'approval',
        toolName: 'saveDraft',
        toolCallId: 'toolu_g',
        proposedArtifact: { body: 'draft' },
      })
    },
    async *resume(_h: ResumeHandle, _r: GateResolution) {
      yield ev({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm2', delta: 'saved' })
    },
  }
}

// A provider that never yields (occupies its slot forever) — for the cap test.
function blockingProvider(): Provider {
  return {
    async *run(_input: RunAgentInput) {
      await new Promise<void>(() => {})
      yield ev({ type: EventType.TEXT_MESSAGE_CHUNK }) // unreachable
    },
  }
}

async function waitFor(pred: () => Promise<boolean>, timeout = 4000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await pred()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('waitFor timed out')
}

const base = {
  workflowId: 'lead-inbox',
  agentId: 'lead-inbox__reply',
  origin: 'human' as const,
  payload: {},
}

describe.skipIf(!reachable)('PipelineService (real Postgres)', () => {
  it('dispatch → gate → resolve → finished, with a stitched trace', async () => {
    const runtime: AgentRuntime = {
      provider: gateProvider(),
      renderToolNames: [],
      maxInstances: 2,
      effects: { saveDraft: async () => ({}) },
    }
    const service = makePipelineService({ db, resolveAgent: () => runtime, descriptors: [] })

    const { id } = await service.dispatch(base)
    await waitFor(async () => (await service.getStatus(id))?.status === 'awaiting_approval')

    const board = await service.getBoard()
    const gate = board.gates.find((g) => g.workItemId === id)
    expect(gate).toBeDefined()

    await service.resolveGate(gate!.id, { gateId: gate!.id, decision: 'approved', formRev: 0 })
    await waitFor(async () => (await service.getStatus(id))?.status === 'finished')

    const trace = await service.getTrace(id, 0)
    expect(trace?.nextSeq).toBe(3) // text + gate (run) + text (resume)
    expect(trace?.done).toBe(true)
  })

  it('holds the per-agent cap (3 dispatched, 2 active + 1 queued)', async () => {
    const runtime: AgentRuntime = {
      provider: blockingProvider(),
      renderToolNames: [],
      maxInstances: 2,
      effects: {},
    }
    const service = makePipelineService({ db, resolveAgent: () => runtime, descriptors: [] })

    await service.dispatch({ ...base, agentId: 'cap-agent' })
    await service.dispatch({ ...base, agentId: 'cap-agent' })
    await service.dispatch({ ...base, agentId: 'cap-agent' })

    const stats = service.stats('cap-agent')
    expect(stats.active).toBe(2)
    expect(stats.queued).toBe(1)
  })

  // ── Gate-keyed resolveGate tests ───────────────────────────────────────────

  function makeService(opts: { effects: Record<string, EffectFn> }) {
    const runtime: AgentRuntime = {
      provider: gateProvider(),
      renderToolNames: [],
      maxInstances: 2,
      effects: opts.effects,
    }
    return makePipelineService({ db, resolveAgent: () => runtime, descriptors: [] })
  }

  async function seedGate(
    svc: ReturnType<typeof makeService>
  ): Promise<{ workItemId: string; gateId: string }> {
    const { id: workItemId } = await svc.dispatch(base)
    await waitFor(async () => (await svc.getStatus(workItemId))?.status === 'awaiting_approval')
    const board = await svc.getBoard()
    const gate = board.gates.find((g) => g.workItemId === workItemId)
    if (!gate) throw new Error('seedGate: no open gate found')
    return { workItemId, gateId: gate.id }
  }

  it('approve: wrong formRev → 409, no effect executed', async () => {
    const effect = vi.fn(async () => ({ draftId: 'd1' }))
    const svc = makeService({ effects: { saveDraft: effect } })
    const { gateId } = await seedGate(svc)
    const res = await svc.resolveGate(gateId, {
      gateId,
      decision: 'approved',
      formRev: 999,
      form: { threadId: 't', body: 'b' },
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(409)
    expect(effect).not.toHaveBeenCalled()
  })

  it('approve: executes the effect exactly once even on double-resolve', async () => {
    const effect = vi.fn(async () => ({ draftId: 'd1' }))
    const svc = makeService({ effects: { saveDraft: effect } })
    const { gateId } = await seedGate(svc)
    const a = await svc.resolveGate(gateId, {
      gateId,
      decision: 'approved',
      formRev: 0,
      form: { threadId: 't', body: 'edited' },
    })
    const b = await svc.resolveGate(gateId, {
      gateId,
      decision: 'approved',
      formRev: 0,
      form: { threadId: 't', body: 'edited' },
    })
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(effect).toHaveBeenCalledTimes(1)
    // vi.fn infers call args as a 0-length tuple — cast to access element 0
    expect((effect.mock.calls[0] as unknown[])[0]).toEqual({ threadId: 't', body: 'edited' })
  })

  it('reject: no effect, work item finished', async () => {
    const effect = vi.fn(async () => ({}))
    const svc = makeService({ effects: { saveDraft: effect } })
    const { gateId, workItemId } = await seedGate(svc)
    const res = await svc.resolveGate(gateId, {
      gateId,
      decision: 'rejected',
      formRev: 0,
      comment: 'no',
    })
    expect(res.ok).toBe(true)
    expect(effect).not.toHaveBeenCalled()
    await waitFor(async () => (await svc.getStatus(workItemId))?.status === 'finished')
    expect((await svc.getStatus(workItemId))?.status).toBe('finished')
  })

  it('approve: a failing effect fails the work item and does not resume as success', async () => {
    const effect = vi.fn(async () => ({ error: 'gmail boom' }))
    const svc = makeService({ effects: { saveDraft: effect } })
    const { gateId, workItemId } = await seedGate(svc)
    const res = await svc.resolveGate(gateId, {
      gateId,
      decision: 'approved',
      formRev: 0,
      form: { threadId: 't', body: 'b' },
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(502)
    await waitFor(async () => {
      const s = await svc.getStatus(workItemId)
      return s?.done === true
    })
    expect((await svc.getStatus(workItemId))?.status).toBe('error')
    expect(effect).toHaveBeenCalledTimes(1)
  })

  // NOTE: the "cancel of a running item starts exactly one queued sibling" cap-hold test is
  // deferred to browser E2E flow 3 (Stop button with a queued item visible in the pipeline
  // column). The blockingProvider's `await new Promise(() => {})` cannot be interrupted by
  // iterator.return() in a pure async generator — the pending await never resolves, so the
  // consume loop never exits and pool.release never fires in the test harness.
  // In production the provider generator runs a subprocess; iterator.return() triggers the
  // generator's finally block which calls child.kill(), immediately resolving the pending
  // read. The code fix (removing pool.release from cancelItem) is the correctness guarantee;
  // the runtime path is covered by the browser E2E.

  it('cancel on an already-finished item is a safe no-op', async () => {
    const svc = makeService({ effects: { saveDraft: async () => ({}) } })
    const { gateId, workItemId } = await seedGate(svc)
    // Reject the gate to move the item to finished
    await svc.resolveGate(gateId, { gateId, decision: 'rejected', formRev: 0 })
    await waitFor(async () => (await svc.getStatus(workItemId))?.status === 'finished')
    // Now cancel a work item that is already finished — must be a no-op
    await expect(svc.cancel(workItemId)).resolves.toBeUndefined()
    expect((await svc.getStatus(workItemId))?.status).toBe('finished')
  })
})

describe.skipIf(!reachable)('PipelineService.deliver (server-side handoff, real Postgres)', () => {
  const runtime: AgentRuntime = {
    provider: blockingProvider(), // occupies its slot; the test asserts rows, not completion
    renderToolNames: [],
    maxInstances: 2,
    effects: {},
  }
  // A descriptor with a published cross-workflow input contract (for the schema-reject case).
  const crossWf = defineWorkflow({
    id: 'lead-inbox',
    label: 'L',
    iconName: 'inbox',
    agents: [
      {
        agent: defineAgent({
          id: 'qualifier',
          name: 'q',
          provider: 'mock',
          instructions: 'x',
          tools: ['t'],
          approvals: [],
          renders: {},
        }),
        role: 'input',
      },
    ],
    entryAgentId: 'qualifier',
    inputs: [{ name: 'lead', schema: z.object({ threadId: z.string() }), agentId: 'qualifier' }],
  })

  it('intra-workflow deliver dispatches a CHILD with parentId, source, origin=agent', async () => {
    const svc = makePipelineService({ db, resolveAgent: () => runtime, descriptors: [] })
    const parentId = (await svc.dispatch({ ...base, agentId: 'lead-inbox__qualifier' })).id
    const threadId = `t-${randomUUID()}`
    const r = await svc.deliver({
      origin: 'lead-inbox',
      dest: { kind: 'agent', agentId: 'reply' },
      payload: { threadId, from: 'a@b.com', subject: 'Hi' },
      parentId,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.deduped).toBe(false)

    const board = await svc.getBoard()
    const child = board.items.find((i) => i.id === r.id)
    expect(child?.parentId).toBe(parentId)
    expect(child?.agentId).toBe('lead-inbox__reply')
    expect(child?.source).toBe(`thread:${threadId}`)
    expect(child?.origin).toBe('agent')
  })

  it('a repeated deliver on the same source dedups (no second child)', async () => {
    const svc = makePipelineService({ db, resolveAgent: () => runtime, descriptors: [] })
    const parentId = (await svc.dispatch({ ...base, agentId: 'lead-inbox__qualifier' })).id
    const threadId = `t-${randomUUID()}`
    const payload = { threadId, from: 'a@b.com', subject: 'Hi' }
    const first = await svc.deliver({
      origin: 'lead-inbox',
      dest: { kind: 'agent', agentId: 'reply' },
      payload,
      parentId,
    })
    const second = await svc.deliver({
      origin: 'lead-inbox',
      dest: { kind: 'agent', agentId: 'reply' },
      payload,
      parentId,
    })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.deduped).toBe(true)
    expect(second.id).toBe(first.id)
  })

  it('a cross-workflow payload that fails the contract schema returns ok:false', async () => {
    const svc = makePipelineService({ db, resolveAgent: () => runtime, descriptors: [crossWf] })
    const parentId = (await svc.dispatch({ ...base, agentId: 'lead-inbox__qualifier' })).id
    const r = await svc.deliver({
      origin: 'github-triage',
      dest: { kind: 'contract', workflow: 'lead-inbox', input: 'lead' },
      payload: { nope: 1 }, // missing threadId — fails the schema
      parentId,
    })
    expect(r.ok).toBe(false)
  })
})
