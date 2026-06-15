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
} from '@atizar/core'
import { db } from './db/client.js'
import { makePipelineService } from './pipelineService.js'
import type { AgentRuntime } from './runObserver.js'
import { ACTIVE } from './transition.js'

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
      dispatchToolNames: [],
      handoffs: [],
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
      dispatchToolNames: [],
      handoffs: [],
    }
    const service = makePipelineService({ db, resolveAgent: () => runtime, descriptors: [] })

    await service.dispatch({ ...base, agentId: 'cap-agent' })
    await service.dispatch({ ...base, agentId: 'cap-agent' })
    await service.dispatch({ ...base, agentId: 'cap-agent' })

    const stats = service.stats('cap-agent')
    expect(stats.active).toBe(2)
    expect(stats.queued).toBe(1)
  })

  it('rejects a duplicate human START of a singleton agent (maxInstances=1) with rejected=already_running', async () => {
    const runtime: AgentRuntime = {
      provider: blockingProvider(),
      renderToolNames: [],
      maxInstances: 1,
      effects: {},
      dispatchToolNames: [],
      handoffs: [],
    }
    const service = makePipelineService({ db, resolveAgent: () => runtime, descriptors: [] })

    // First human START: should succeed and occupy the sole slot.
    const first = await service.dispatch({
      ...base,
      agentId: 'singleton-agent',
      origin: 'human',
    })
    expect(first.rejected).toBeUndefined()

    // Second human START: maxInstances=1 and one already active → rejected.
    const second = await service.dispatch({
      ...base,
      agentId: 'singleton-agent',
      origin: 'human',
    })
    expect(second.rejected).toBe('already_running')

    // The second dispatch must NOT have been enqueued.
    const stats = service.stats('singleton-agent')
    expect(stats.active).toBe(1)
    expect(stats.queued).toBe(0)
  })

  it('machine dispatch (origin=agent) to a saturated singleton is NOT rejected by the START guard', async () => {
    const runtime: AgentRuntime = {
      provider: blockingProvider(),
      renderToolNames: [],
      maxInstances: 1,
      effects: {},
      dispatchToolNames: [],
      handoffs: [],
    }
    const service = makePipelineService({ db, resolveAgent: () => runtime, descriptors: [] })

    // First human START occupies the sole slot.
    const first = await service.dispatch({
      ...base,
      agentId: 'singleton-machine-agent',
      origin: 'human',
    })
    expect(first.rejected).toBeUndefined()

    // Machine dispatch (origin='agent', e.g. F2 child dispatch) to the same saturated singleton
    // must NOT be rejected — it goes to the chokepoint cap/queue instead of the human guard.
    const machine = await service.dispatch({
      ...base,
      agentId: 'singleton-machine-agent',
      origin: 'agent',
    })
    expect(machine.rejected).toBeUndefined()

    // The machine dispatch was accepted: 1 active (blocking) + 1 queued.
    const stats = service.stats('singleton-machine-agent')
    expect(stats.active).toBe(1)
    expect(stats.queued).toBe(1)
  })

  // ── Gate-keyed resolveGate tests ───────────────────────────────────────────

  function makeService(opts: { effects: Record<string, EffectFn> }) {
    const runtime: AgentRuntime = {
      provider: gateProvider(),
      renderToolNames: [],
      maxInstances: 2,
      effects: opts.effects,
      dispatchToolNames: [],
      handoffs: [],
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

  it('dispatch records a queued activity entry retrievable via getActivity()', async () => {
    const runtime: AgentRuntime = {
      provider: blockingProvider(),
      renderToolNames: [],
      maxInstances: 2,
      effects: {},
      dispatchToolNames: [],
      handoffs: [],
    }
    const svc = makePipelineService({ db, resolveAgent: () => runtime, descriptors: [] })
    const req = { ...base, agentId: 'lead-inbox__qualifier', origin: 'human' as const }
    const { id } = await svc.dispatch(req)
    const entries = svc.getActivity()
    const entry = entries.find((e) => e.workItemId === id)
    expect(entry).toBeDefined()
    expect(entry?.kind).toBe('queued')
    expect(entry?.agentId).toBe('lead-inbox__qualifier')
  })
})

describe.skipIf(!reachable)('PipelineService.getBoard agentHealth', () => {
  it('includes agentHealth from getAgentHealth when provided', async () => {
    const runtime: AgentRuntime = {
      provider: blockingProvider(),
      renderToolNames: [],
      maxInstances: 1,
      effects: {},
      dispatchToolNames: [],
      handoffs: [],
    }
    const agentHealth = { 'lead-inbox__reply': { ok: true as const } }
    const svc = makePipelineService({
      db,
      resolveAgent: () => runtime,
      descriptors: [],
      getAgentHealth: () => agentHealth,
    })
    const board = await svc.getBoard()
    expect(board.agentHealth).toEqual(agentHealth)
  })

  it('returns empty agentHealth when getAgentHealth is not provided', async () => {
    const runtime: AgentRuntime = {
      provider: blockingProvider(),
      renderToolNames: [],
      maxInstances: 1,
      effects: {},
      dispatchToolNames: [],
      handoffs: [],
    }
    const svc = makePipelineService({
      db,
      resolveAgent: () => runtime,
      descriptors: [],
      // getAgentHealth intentionally omitted
    })
    const board = await svc.getBoard()
    expect(board.agentHealth).toEqual({})
  })
})

describe.skipIf(!reachable)('PipelineService.cancelAll', () => {
  it('stops every active item across two distinct workflows', async () => {
    const runtime: AgentRuntime = {
      provider: blockingProvider(),
      renderToolNames: [],
      maxInstances: 2,
      effects: {},
      dispatchToolNames: [],
      handoffs: [],
    }
    const svc = makePipelineService({ db, resolveAgent: () => runtime, descriptors: [] })

    // Dispatch two items into two different workflows (agent key = wf__agent).
    // Items are written to DB as 'queued' synchronously inside dispatch().
    const { id: id1 } = await svc.dispatch({
      workflowId: 'wf-alpha',
      agentId: 'wf-alpha__agent',
      origin: 'human',
      payload: {},
    })
    const { id: id2 } = await svc.dispatch({
      workflowId: 'wf-beta',
      agentId: 'wf-beta__agent',
      origin: 'human',
      payload: {},
    })

    // Items are in the DB (queued or running) — cancel everything.
    await svc.cancelAll()

    // Both items must now be terminal (done). cancelItem transitions queued/running → finished.
    const s1 = await svc.getStatus(id1)
    const s2 = await svc.getStatus(id2)
    expect(s1?.done).toBe(true)
    expect(s2?.done).toBe(true)

    // Board must have zero active items belonging to these two workflows.
    const board = await svc.getBoard()
    const stillActive = board.items
      .filter((i) => i.id === id1 || i.id === id2)
      .filter((i) => ACTIVE.includes(i.status))
    expect(stillActive).toHaveLength(0)
  }, 10_000)
})

describe.skipIf(!reachable)('PipelineService reset (Unit 4.3)', () => {
  // A provider that finishes immediately so the item reaches a terminal (finished) status.
  function quickProvider(): Provider {
    return {
      async *run(_input: RunAgentInput) {
        yield ev({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm1', delta: 'done' })
      },
    }
  }

  function makeResetService() {
    const runtime: AgentRuntime = {
      provider: quickProvider(),
      renderToolNames: [],
      maxInstances: 2,
      effects: {},
      dispatchToolNames: [],
      handoffs: [],
    }
    return makePipelineService({ db, resolveAgent: () => runtime, descriptors: [] })
  }

  it('resetWorkflow closes a finished item (resolution reset), preserving the row (I12)', async () => {
    const svc = makeResetService()
    const wf = `reset-wf-${randomUUID().slice(0, 8)}`
    const { id } = await svc.dispatch({
      workflowId: wf,
      agentId: `${wf}__sorter`,
      origin: 'human',
      payload: {},
    })
    await waitFor(async () => (await svc.getStatus(id))?.status === 'finished')

    const res = await svc.resetWorkflow(wf)
    expect(res.reset).toBe(1)
    expect(res.active).toBe(0)

    const status = await svc.getStatus(id)
    expect(status?.status).toBe('closed') // hidden from the live column, not deleted
    const board = await svc.getBoard()
    const row = board.items.find((i) => i.id === id)
    expect(row).toBeDefined() // row preserved (openable via Activity/trace)
    expect(row?.resolution).toBe('reset')
  })

  it('resetWorkflow does NOT close an active item and reports it in `active`', async () => {
    const runtime: AgentRuntime = {
      provider: blockingProvider(), // stays running, occupies its slot
      renderToolNames: [],
      maxInstances: 2,
      effects: {},
      dispatchToolNames: [],
      handoffs: [],
    }
    const svc = makePipelineService({ db, resolveAgent: () => runtime, descriptors: [] })
    const wf = `reset-active-${randomUUID().slice(0, 8)}`
    const { id } = await svc.dispatch({
      workflowId: wf,
      agentId: `${wf}__sorter`,
      origin: 'human',
      payload: {},
    })
    // queued or running — either way it is ACTIVE, so reset must leave it alone.
    const res = await svc.resetWorkflow(wf)
    expect(res.reset).toBe(0)
    expect(res.active).toBe(1)
    expect((await svc.getStatus(id))?.done).toBe(false)
  })

  it('resetAll closes finished items across multiple workflows', async () => {
    const svc = makeResetService()
    const wfA = `reset-all-a-${randomUUID().slice(0, 8)}`
    const wfB = `reset-all-b-${randomUUID().slice(0, 8)}`
    const a = await svc.dispatch({
      workflowId: wfA,
      agentId: `${wfA}__sorter`,
      origin: 'human',
      payload: {},
    })
    const b = await svc.dispatch({
      workflowId: wfB,
      agentId: `${wfB}__sorter`,
      origin: 'human',
      payload: {},
    })
    await waitFor(async () => (await svc.getStatus(a.id))?.status === 'finished')
    await waitFor(async () => (await svc.getStatus(b.id))?.status === 'finished')

    const res = await svc.resetAll()
    expect(res.reset).toBeGreaterThanOrEqual(2)
    expect((await svc.getStatus(a.id))?.status).toBe('closed')
    expect((await svc.getStatus(b.id))?.status).toBe('closed')
  }, 15_000)

  it('reset records a `reset` activity entry', async () => {
    const svc = makeResetService()
    const wf = `reset-act-${randomUUID().slice(0, 8)}`
    const { id } = await svc.dispatch({
      workflowId: wf,
      agentId: `${wf}__sorter`,
      origin: 'human',
      payload: {},
    })
    await waitFor(async () => (await svc.getStatus(id))?.status === 'finished')
    await svc.resetWorkflow(wf)
    const entry = svc.getActivity().find((e) => e.workItemId === id && e.kind === 'reset')
    expect(entry).toBeDefined()
  })
})

describe.skipIf(!reachable)('PipelineService.deliver (server-side handoff, real Postgres)', () => {
  const runtime: AgentRuntime = {
    provider: blockingProvider(), // occupies its slot; the test asserts rows, not completion
    renderToolNames: [],
    maxInstances: 2,
    effects: {},
    dispatchToolNames: [],
    handoffs: [],
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

describe.skipIf(!reachable)('PipelineService re-run supersede (WS1)', () => {
  // A provider that finishes immediately (one text chunk, no gate) — the scan goes
  // queued → running → finished, freeing the singleton slot for a sequential re-START.
  function quickProvider(): Provider {
    return {
      async *run(_input: RunAgentInput) {
        yield ev({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm1', delta: 'scanned' })
      },
    }
  }

  const inputWf = defineWorkflow({
    id: 'rerun-wf',
    label: 'R',
    iconName: 'inbox',
    agents: [
      {
        agent: defineAgent({
          id: 'sorter',
          name: 's',
          provider: 'mock',
          instructions: 'x',
          tools: ['t'],
          approvals: [],
          renders: {},
        }),
        role: 'input',
      },
    ],
    entryAgentId: 'sorter',
    inputs: [],
  })

  function makeReRunService() {
    const runtime: AgentRuntime = {
      provider: quickProvider(),
      renderToolNames: [],
      maxInstances: 1,
      effects: {},
      dispatchToolNames: [],
      handoffs: [],
    }
    return makePipelineService({ db, resolveAgent: () => runtime, descriptors: [inputWf] })
  }

  it('a sequential human re-START supersedes the prior finished root and mints a new one', async () => {
    const svc = makeReRunService()
    const agentId = 'rerun-wf__sorter'
    const first = await svc.dispatch({
      workflowId: 'rerun-wf',
      agentId,
      origin: 'human',
      payload: {},
    })
    await waitFor(async () => (await svc.getStatus(first.id))?.status === 'finished')

    const second = await svc.dispatch({
      workflowId: 'rerun-wf',
      agentId,
      origin: 'human',
      payload: {},
    })
    expect(second.rejected).toBeUndefined()
    expect(second.id).not.toBe(first.id)

    // the prior finished root is now closed + superseded (preserved, not destroyed — I12)
    const firstStatus = await svc.getStatus(first.id)
    expect(firstStatus?.status).toBe('closed')
    const board = await svc.getBoard()
    const firstRow = board.items.find((i) => i.id === first.id)
    expect(firstRow?.resolution).toBe('superseded')
    // the prior row still exists (openable via Activity/trace) — not deleted
    expect(firstRow).toBeDefined()
  })

  it('the supersede is recorded in the Activity log', async () => {
    const svc = makeReRunService()
    const agentId = 'rerun-wf__sorter'
    const first = await svc.dispatch({
      workflowId: 'rerun-wf',
      agentId,
      origin: 'human',
      payload: {},
    })
    await waitFor(async () => (await svc.getStatus(first.id))?.status === 'finished')
    await svc.dispatch({ workflowId: 'rerun-wf', agentId, origin: 'human', payload: {} })
    const entry = svc
      .getActivity()
      .find((e) => e.workItemId === first.id && e.kind === 'superseded')
    expect(entry).toBeDefined()
  })

  it('a 2nd CONCURRENT human START of the singleton input still 409s (supersede does not change concurrency)', async () => {
    // blockingProvider keeps the first scan RUNNING (slot occupied) — the concurrency guard fires
    // before any supersede; the prior root is not finished, so there is nothing to supersede.
    const runtime: AgentRuntime = {
      provider: blockingProvider(),
      renderToolNames: [],
      maxInstances: 1,
      effects: {},
      dispatchToolNames: [],
      handoffs: [],
    }
    const svc = makePipelineService({ db, resolveAgent: () => runtime, descriptors: [inputWf] })
    const agentId = 'rerun-wf__sorter'
    const first = await svc.dispatch({
      workflowId: 'rerun-wf',
      agentId,
      origin: 'human',
      payload: {},
    })
    expect(first.rejected).toBeUndefined()
    const second = await svc.dispatch({
      workflowId: 'rerun-wf',
      agentId,
      origin: 'human',
      payload: {},
    })
    expect(second.rejected).toBe('already_running')
  })

  it('a non-input agent human START does NOT supersede (only input roots refresh)', async () => {
    // dispatch a worker-role agent directly (origin human) twice; finishing the first should
    // NOT close it — refresh applies only to input agents.
    const runtime: AgentRuntime = {
      provider: quickProvider(),
      renderToolNames: [],
      maxInstances: 2,
      effects: {},
      dispatchToolNames: [],
      handoffs: [],
    }
    const svc = makePipelineService({ db, resolveAgent: () => runtime, descriptors: [inputWf] })
    const first = await svc.dispatch({
      workflowId: 'rerun-wf',
      agentId: 'rerun-wf__worker-x', // not a declared input agent in inputWf
      origin: 'human',
      payload: {},
    })
    await waitFor(async () => (await svc.getStatus(first.id))?.status === 'finished')
    await svc.dispatch({
      workflowId: 'rerun-wf',
      agentId: 'rerun-wf__worker-x',
      origin: 'human',
      payload: {},
    })
    expect((await svc.getStatus(first.id))?.status).toBe('finished') // NOT closed
  })
})
