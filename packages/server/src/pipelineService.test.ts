import { randomUUID } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import {
  defineAgent,
  defineWorkflow,
  gateOpened,
  lifecycle,
  type EffectFn,
  type GateResolution,
  type Provider,
  type ResumeHandle,
} from '@atizar/core'
import { db } from './db/client.js'
import { makePipelineService } from './pipelineService.js'
import { makeStateStore } from './stateStore.js'
import { transition } from './transition.js'
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

// A per-test dispatch request with a UNIQUE workflow id (→ unique `wf__reply` agentId). The
// per-agent cap is keyed on agentId and the test DB is SHARED across parallel test files, so a
// shared `lead-inbox__reply` would let concurrent files contend the global cap=2 and starve each
// other's `waitFor`. A fresh agentId per test isolates the cap. (Tests that assert the literal
// `lead-inbox` agentId — the deliver/activity cases — keep `base`.)
function freshBase() {
  const wf = `pls-${randomUUID().slice(0, 8)}`
  return { workflowId: wf, agentId: `${wf}__reply`, origin: 'human' as const, payload: {} }
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
    const service = makePipelineService({
      db,
      resolveAgent: () => runtime,
      descriptors: [],
      instanceKeyOf: (agentId) => agentId,
      sourceOf: () => null,
    })

    const { id } = await service.dispatch(freshBase())
    await waitFor(async () => (await service.getStatus(id))?.status === 'awaiting_human')

    const board = await service.getBoard()
    const gate = board.gates.find((g) => g.workItemId === id)
    expect(gate).toBeDefined()

    await service.resolveGate(gate!.id, { gateId: gate!.id, decision: 'approved', formRev: 0 })
    await waitFor(async () => (await service.getStatus(id))?.status === 'terminal')

    const trace = await service.getTrace(id, 0)
    // text + gate (run) + text (resume) + lifecycle note (settle finish)
    expect(trace?.nextSeq).toBe(4)
    expect(trace?.done).toBe(true)
    expect(trace?.outcome).toBe('done')
  })

  it('getBoard excludes retired items — a Reset-retired item leaves the live board', async () => {
    const runtime: AgentRuntime = {
      provider: gateProvider(),
      renderToolNames: [],
      maxInstances: 2,
      effects: { saveDraft: async () => ({}) },
      dispatchToolNames: [],
      handoffs: [],
    }
    const wf = `closed-board-${randomUUID().slice(0, 8)}`
    const service = makePipelineService({
      db,
      resolveAgent: () => runtime,
      descriptors: [],
      instanceKeyOf: (agentId) => agentId,
      sourceOf: () => null,
    })

    const { id } = await service.dispatch({ ...base, workflowId: wf, agentId: `${wf}__reply` })
    await waitFor(async () => (await service.getStatus(id))?.status === 'awaiting_human')
    const gate = (await service.getBoard()).gates.find((g) => g.workItemId === id)
    await service.resolveGate(gate!.id, { gateId: gate!.id, decision: 'approved', formRev: 0 })
    await waitFor(async () => (await service.getStatus(id))?.status === 'terminal')

    // Finished item is still on the live board (kept result, I12)…
    expect((await service.getBoard()).items.some((w) => w.id === id)).toBe(true)
    // …Reset retires it (outcome 'reset') → it must DISAPPEAR from the live board (history only).
    await service.resetWorkflow(wf)
    const board = await service.getBoard()
    expect(board.items.some((w) => w.id === id)).toBe(false)
    expect(board.items.every((w) => w.outcome !== 'reset' && w.outcome !== 'superseded')).toBe(true)
    // The item still exists in the store (durable, I12) — just not on the live board.
    const status = await service.getStatus(id)
    expect(status?.status).toBe('terminal')
    expect(status?.outcome).toBe('reset')
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
    const service = makePipelineService({
      db,
      resolveAgent: () => runtime,
      descriptors: [],
      instanceKeyOf: (agentId) => agentId,
      sourceOf: () => null,
    })

    await service.dispatch({ ...base, agentId: 'cap-agent' })
    await service.dispatch({ ...base, agentId: 'cap-agent' })
    await service.dispatch({ ...base, agentId: 'cap-agent' })

    await waitFor(async () => (await service.stats('cap-agent')).active === 2)
    const stats = await service.stats('cap-agent')
    expect(stats.active).toBe(2)
    expect(stats.queued).toBe(1)
  })

  // Build a one-input-agent workflow descriptor + a singleton runtime. The Start-over path applies
  // to a SINGLETON INPUT agent, so the agent under test must be a declared input agent
  // (isInputAgent true) of a loaded descriptor.
  function makeSingletonInputService(prefix: string) {
    const wf = `${prefix}-${randomUUID().slice(0, 8)}`
    const inputWf = defineWorkflow({
      id: wf,
      label: 'S',
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
      descriptors: [inputWf],
      instanceKeyOf: (agentId) => agentId,
      sourceOf: () => null,
    })
    return { svc, workflowId: wf, agentId: `${wf}__sorter` }
  }

  it('a second human START while a singleton input scan is LIVE returns the live scan (one-open gate)', async () => {
    const { svc, workflowId, agentId } = makeSingletonInputService('singleton')

    // First human START: should succeed and (with blockingProvider) stay running → tree live.
    const first = await svc.dispatch({ workflowId, agentId, origin: 'human', payload: {} })
    await waitFor(async () => (await svc.getStatus(first.id))?.status === 'active')

    // Second human START while the scan is LIVE: no second scan — the live scan is returned
    // (one-open gate; B1 supersede-prior + one-live-gate, replacing wipe-on-START).
    const second = await svc.dispatch({ workflowId, agentId, origin: 'human', payload: {} })
    expect(second.id).toBe(first.id)
    expect(second.deduped).toBe(true)

    // The prior root is untouched (still live) and holds the sole singleton slot.
    const firstStatus = await svc.getStatus(first.id)
    expect(firstStatus?.status).toBe('active')
    const stats = await svc.stats(agentId)
    expect(stats.active).toBe(1)
    expect(stats.queued).toBe(0)
  })

  it('stamps the instanceKeyOf result on a human START', async () => {
    const wf = `keyed-${randomUUID().slice(0, 8)}`
    const agentId = `${wf}__sorter`
    const inputWf = defineWorkflow({
      id: wf,
      label: 'S',
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
    const runtime: AgentRuntime = {
      provider: blockingProvider(),
      renderToolNames: [],
      maxInstances: 1,
      effects: {},
      dispatchToolNames: [],
      handoffs: [],
    }
    const service = makePipelineService({
      db,
      resolveAgent: () => runtime,
      descriptors: [inputWf],
      instanceKeyOf: (id) => `key:${id}`,
      sourceOf: () => null,
    })
    const { id } = await service.dispatch({ workflowId: wf, agentId, origin: 'human', payload: {} })
    expect((await makeStateStore(db).getWorkItem(id))?.key).toBe(`key:${agentId}`)
  })

  it('machine dispatch (origin=agent) to a saturated singleton queues (not wiped by Start-over)', async () => {
    const { svc, workflowId, agentId } = makeSingletonInputService('singleton-machine')

    // First human START occupies the sole slot (running, tree live).
    const first = await svc.dispatch({ workflowId, agentId, origin: 'human', payload: {} })
    await waitFor(async () => (await svc.getStatus(first.id))?.status === 'active')

    // Machine dispatch (origin='agent', e.g. F2 child dispatch) to the same saturated singleton
    // goes to the chokepoint cap/queue — it does NOT trigger the human Start-over wipe.
    await svc.dispatch({ workflowId, agentId, origin: 'agent', payload: {} })

    // The first run is still active; the machine dispatch was accepted and queued behind it.
    const stats = await svc.stats(agentId)
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
    return makePipelineService({
      db,
      resolveAgent: () => runtime,
      descriptors: [],
      instanceKeyOf: (agentId) => agentId,
      sourceOf: () => null,
    })
  }

  async function seedGate(
    svc: ReturnType<typeof makeService>
  ): Promise<{ workItemId: string; gateId: string }> {
    const { id: workItemId } = await svc.dispatch(freshBase())
    await waitFor(async () => (await svc.getStatus(workItemId))?.status === 'awaiting_human')
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

  it('reject: no effect, work item terminal/rejected', async () => {
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
    await waitFor(async () => (await svc.getStatus(workItemId))?.status === 'terminal')
    const status = await svc.getStatus(workItemId)
    expect(status?.status).toBe('terminal')
    expect(status?.outcome).toBe('rejected')
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
    const status = await svc.getStatus(workItemId)
    expect(status?.status).toBe('terminal')
    expect(status?.outcome).toBe('error')
    expect(effect).toHaveBeenCalledTimes(1)
  })

  // NOTE: the "cancel of a running item starts exactly one queued sibling" cap-hold test is
  // deferred to browser E2E flow 3 (Stop button with a queued item visible in the pipeline
  // column). The blockingProvider's `await new Promise(() => {})` cannot be interrupted by
  // iterator.return() in a pure async generator — the pending await never resolves, so the
  // consume loop never exits in the test harness. In production the provider generator runs a
  // subprocess; iterator.return() triggers the generator's finally → child.kill(), resolving the
  // pending read. The runtime path is covered by the browser E2E.

  it('cancel on an already-terminal item is a safe no-op', async () => {
    const svc = makeService({ effects: { saveDraft: async () => ({}) } })
    const { gateId, workItemId } = await seedGate(svc)
    // Reject the gate to move the item to terminal
    await svc.resolveGate(gateId, { gateId, decision: 'rejected', formRev: 0 })
    await waitFor(async () => (await svc.getStatus(workItemId))?.status === 'terminal')
    const before = await svc.getStatus(workItemId)
    // Now cancel a work item that is already terminal — must be a no-op
    await expect(svc.cancel(workItemId)).resolves.toBeUndefined()
    const after = await svc.getStatus(workItemId)
    expect(after?.status).toBe('terminal')
    expect(after?.outcome).toBe(before?.outcome) // unchanged (still rejected)
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
    const svc = makePipelineService({
      db,
      resolveAgent: () => runtime,
      descriptors: [],
      instanceKeyOf: (agentId) => agentId,
      sourceOf: () => null,
    })
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
      instanceKeyOf: (agentId) => agentId,
      sourceOf: () => null,
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
      instanceKeyOf: (agentId) => agentId,
      sourceOf: () => null,
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
    const svc = makePipelineService({
      db,
      resolveAgent: () => runtime,
      descriptors: [],
      instanceKeyOf: (agentId) => agentId,
      sourceOf: () => null,
    })

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

    // Items are in the DB (queued or active) — cancel everything.
    await svc.cancelAll()

    // Both items must now be terminal (stopped). cancelItem settles queued/active → terminal.
    const s1 = await svc.getStatus(id1)
    const s2 = await svc.getStatus(id2)
    expect(s1?.done).toBe(true)
    expect(s2?.done).toBe(true)

    // Board must have zero active items belonging to these two workflows.
    const board = await svc.getBoard()
    const stillActive = board.items
      .filter((i) => i.id === id1 || i.id === id2)
      .filter((i) => lifecycle(i.phase, i.outcome, false, false).isLive)
    expect(stillActive).toHaveLength(0)
  }, 10_000)
})

describe.skipIf(!reachable)('PipelineService reset/wipe (Unit 4.3)', () => {
  // A provider that finishes immediately so the item reaches a terminal (done) status.
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
    return makePipelineService({
      db,
      resolveAgent: () => runtime,
      descriptors: [],
      instanceKeyOf: (agentId) => agentId,
      sourceOf: () => null,
    })
  }

  it('resetWorkflow retires a finished item (outcome reset), preserving the row (I12)', async () => {
    const svc = makeResetService()
    const wf = `reset-wf-${randomUUID().slice(0, 8)}`
    const { id } = await svc.dispatch({
      workflowId: wf,
      agentId: `${wf}__sorter`,
      origin: 'human',
      payload: {},
    })
    await waitFor(async () => (await svc.getStatus(id))?.status === 'terminal')

    const res = await svc.resetWorkflow(wf)
    expect(res.reset).toBe(1)

    const status = await svc.getStatus(id)
    expect(status?.status).toBe('terminal')
    expect(status?.outcome).toBe('reset') // hidden from the live column, not deleted
    // It has LEFT the live board (retired items are filtered from getBoard)…
    const board = await svc.getBoard()
    expect(board.items.some((i) => i.id === id)).toBe(false)
    // …but the row is preserved in the store with outcome 'reset' (I12 — hidden, not deleted).
    const row = await makeStateStore(db).getWorkItem(id)
    expect(row).toBeDefined()
    expect(row?.outcome).toBe('reset')
  })

  it('wipeWorkflow stops an active item AND retires terminal items (Start-over)', async () => {
    const runtime: AgentRuntime = {
      provider: blockingProvider(), // stays active, occupies its slot
      renderToolNames: [],
      maxInstances: 2,
      effects: {},
      dispatchToolNames: [],
      handoffs: [],
    }
    const svc = makePipelineService({
      db,
      resolveAgent: () => runtime,
      descriptors: [],
      instanceKeyOf: (agentId) => agentId,
      sourceOf: () => null,
    })
    const wf = `wipe-active-${randomUUID().slice(0, 8)}`
    const { id } = await svc.dispatch({
      workflowId: wf,
      agentId: `${wf}__sorter`,
      origin: 'human',
      payload: {},
    })
    // queued or active — either way it is live; wipe stops it (→ stopped) THEN retires it from the
    // board (→ reset). The end state is terminal/reset, off the live board.
    await svc.wipeWorkflow(wf)
    const status = await svc.getStatus(id)
    expect(status?.status).toBe('terminal')
    expect(status?.outcome).toBe('reset')
    expect(status?.done).toBe(true)
    const board = await svc.getBoard()
    expect(board.items.some((i) => i.id === id)).toBe(false)
  })

  it('resetAll retires finished items across multiple workflows', async () => {
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
    await waitFor(async () => (await svc.getStatus(a.id))?.status === 'terminal')
    await waitFor(async () => (await svc.getStatus(b.id))?.status === 'terminal')

    const res = await svc.resetAll()
    expect(res.reset).toBeGreaterThanOrEqual(2)
    expect((await svc.getStatus(a.id))?.outcome).toBe('reset')
    expect((await svc.getStatus(b.id))?.outcome).toBe('reset')
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
    await waitFor(async () => (await svc.getStatus(id))?.status === 'terminal')
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

  // The app's dedup-source policy (Pass-1.5): the framework stamps whatever sourceOf returns onto
  // the work item's `source` column and dedups by it. Here the test policy reads payload.threadId.
  const sourceOf = (_agentId: string, p: Record<string, unknown>): string | null =>
    typeof p.threadId === 'string' ? `thread:${p.threadId}` : null

  it('stamps the app sourceOf result on a delivered CHILD (with parentId, origin=agent)', async () => {
    const svc = makePipelineService({
      db,
      resolveAgent: () => runtime,
      descriptors: [],
      instanceKeyOf: (agentId) => agentId,
      sourceOf,
    })
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

  it('two deliveries with the SAME sourceOf result dedup (app source drives dedup)', async () => {
    const svc = makePipelineService({
      db,
      resolveAgent: () => runtime,
      descriptors: [],
      instanceKeyOf: (agentId) => agentId,
      sourceOf,
    })
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
    const svc = makePipelineService({
      db,
      resolveAgent: () => runtime,
      descriptors: [crossWf],
      instanceKeyOf: (agentId) => agentId,
      sourceOf,
    })
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
  // queued → active → terminal, freeing the singleton slot for a sequential re-START.
  function quickProvider(): Provider {
    return {
      async *run(_input: RunAgentInput) {
        yield ev({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm1', delta: 'scanned' })
      },
    }
  }

  // Each test mints a UNIQUE workflow id (avoids cross-test DB pollution of the liveness scan).
  // A descriptor must carry the SAME id as the workflow so the input runtime key (`<wf>__sorter`)
  // is recognized as an input agent (isInputAgent). Returns the service + the matching ids.
  function makeReRunService(provider: Provider = quickProvider()) {
    const wf = `rerun-wf-${randomUUID().slice(0, 8)}`
    const inputWf = defineWorkflow({
      id: wf,
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
    const runtime: AgentRuntime = {
      provider,
      renderToolNames: [],
      maxInstances: 1,
      effects: {},
      dispatchToolNames: [],
      handoffs: [],
    }
    const svc = makePipelineService({
      db,
      resolveAgent: () => runtime,
      descriptors: [inputWf],
      instanceKeyOf: (agentId) => agentId,
      sourceOf: () => null,
    })
    return { svc, workflowId: wf, agentId: `${wf}__sorter` }
  }

  it('a sequential human re-START supersedes the prior finished root and mints a new one', async () => {
    const { svc, workflowId, agentId } = makeReRunService()
    const first = await svc.dispatch({ workflowId, agentId, origin: 'human', payload: {} })
    await waitFor(async () => (await svc.getStatus(first.id))?.status === 'terminal')

    const second = await svc.dispatch({ workflowId, agentId, origin: 'human', payload: {} })
    expect(second.id).not.toBe(first.id)

    // the prior finished root is now superseded (retired by B1 supersede-prior; preserved, not
    // destroyed — I12)
    const firstStatus = await svc.getStatus(first.id)
    expect(firstStatus?.status).toBe('terminal')
    expect(firstStatus?.outcome).toBe('superseded')
    // it has LEFT the live board (superseded is filtered from getBoard)…
    const board = await svc.getBoard()
    expect(board.items.some((i) => i.id === first.id)).toBe(false)
    // …but the row is preserved in the store (I12 — not deleted).
    const firstRow = await makeStateStore(db).getWorkItem(first.id)
    expect(firstRow).toBeDefined()
    expect(firstRow?.outcome).toBe('superseded')
  })

  it('a 2nd human START while the prior scan is RUNNING returns the live scan (one-open gate)', async () => {
    // blockingProvider keeps the first scan ACTIVE (slot occupied → live). B1 one-live-gate: no
    // second scan — the live scan is returned (deduped). The prior root is untouched.
    const { svc, workflowId, agentId } = makeReRunService(blockingProvider())
    const first = await svc.dispatch({ workflowId, agentId, origin: 'human', payload: {} })
    await waitFor(async () => (await svc.getStatus(first.id))?.status === 'active')
    const second = await svc.dispatch({ workflowId, agentId, origin: 'human', payload: {} })
    expect(second.id).toBe(first.id)
    expect(second.deduped).toBe(true)
    const firstStatus = await svc.getStatus(first.id)
    expect(firstStatus?.status).toBe('active')
  })

  it('a non-input agent human START does NOT wipe (only input roots refresh)', async () => {
    // dispatch a worker-role agent directly (origin human) twice; finishing the first should
    // NOT retire it — refresh applies only to input agents.
    const { svc, workflowId } = makeReRunService()
    const first = await svc.dispatch({
      workflowId,
      agentId: `${workflowId}__worker-x`, // not a declared input agent in this descriptor
      origin: 'human',
      payload: {},
    })
    await waitFor(async () => (await svc.getStatus(first.id))?.status === 'terminal')
    await svc.dispatch({
      workflowId,
      agentId: `${workflowId}__worker-x`,
      origin: 'human',
      payload: {},
    })
    const status = await svc.getStatus(first.id)
    expect(status?.status).toBe('terminal')
    expect(status?.outcome).toBe('done') // NOT wiped — refresh applies only to input agents
  })
})

describe.skipIf(!reachable)('PipelineService START = supersede-prior + one-live-gate (B1)', () => {
  // A provider that finishes immediately (one text chunk, no gate): a scan goes
  // queued → active → terminal/done, leaving a FINISHED root to supersede.
  function quickProvider(): Provider {
    return {
      async *run(_input: RunAgentInput) {
        yield ev({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: 'm1', delta: 'scanned' })
      },
    }
  }

  // A workflow with ONE input agent (sorter) so `<wf>__sorter` is recognized as an input agent
  // (isInputAgent). The runtime is shared for every agentId in this service.
  function makeInputService(provider: Provider = quickProvider()) {
    const wf = `b1-${randomUUID().slice(0, 8)}`
    const inputWf = defineWorkflow({
      id: wf,
      label: 'B',
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
    const runtime: AgentRuntime = {
      provider,
      renderToolNames: [],
      maxInstances: 1,
      effects: {},
      dispatchToolNames: [],
      handoffs: [],
    }
    const svc = makePipelineService({
      db,
      resolveAgent: () => runtime,
      descriptors: [inputWf],
      instanceKeyOf: (agentId) => agentId,
      sourceOf: () => null,
    })
    return { svc, workflowId: wf, sorterId: `${wf}__sorter` }
  }

  it('re-START does NOT wipe sibling worker runs (no wipe-on-START)', async () => {
    const { svc, workflowId, sorterId } = makeInputService()
    // A worker run dispatched by the machine (origin=agent) — a sibling of the input scan.
    const draft = await svc.dispatch({
      workflowId,
      agentId: `${workflowId}__reply`, // worker, not a declared input agent
      origin: 'agent',
      payload: {},
    })
    // A human START of the INPUT agent must not touch the worker run.
    await svc.dispatch({ workflowId, agentId: sorterId, origin: 'human', payload: {} })
    const worker = await makeStateStore(db).getWorkItem(draft.id)
    expect(worker?.outcome).not.toBe('stopped')
    expect(worker?.outcome).not.toBe('reset')
    expect(worker?.outcome).not.toBe('superseded')
  })

  it('a fresh input START supersedes the prior FINISHED scan root', async () => {
    const { svc, workflowId, sorterId } = makeInputService()
    const first = await svc.dispatch({
      workflowId,
      agentId: sorterId,
      origin: 'human',
      payload: {},
    })
    // Drive the first scan to a clean finish (quickProvider → terminal/done).
    await waitFor(async () => (await svc.getStatus(first.id))?.status === 'terminal')

    const second = await svc.dispatch({
      workflowId,
      agentId: sorterId,
      origin: 'human',
      payload: {},
    })
    expect(second.id).not.toBe(first.id)
    expect((await makeStateStore(db).getWorkItem(first.id))?.outcome).toBe('superseded')
  })

  it('a re-START does NOT supersede a prior finished scan that still has a live (awaiting) child', async () => {
    // The B1 regression: a prior scan FINISHED (terminal/done) but dispatched a worker child that is
    // still LIVE (e.g. a reply draft awaiting approval). Superseding the finished root orphans the
    // live child (its parent leaves the board), so the draft vanishes from the pipeline. The finished
    // scan with a live descendant must be KEPT (it collapses with the new scan by the input agent's
    // constant key); only a childless finished scan is superseded.
    // Use blockingProvider for the scan so the test drives its lifecycle manually (no auto-finish
    // racing the manual transitions): scan stays active until we `finish` it ourselves.
    const { svc, workflowId, sorterId } = makeInputService(blockingProvider())
    const first = await svc.dispatch({
      workflowId,
      agentId: sorterId,
      origin: 'human',
      payload: {},
    })
    await waitFor(async () => (await svc.getStatus(first.id))?.status === 'active')

    // While the scan is active it dispatches a worker child (a reply draft). Drive the child to
    // active so it is LIVE, then finish the scan — leaving a terminal/done root WITH a live child
    // (the exact bug state: the draft is awaiting while its parent scan has already finished).
    const child = await svc.dispatch({
      workflowId,
      agentId: `${workflowId}__reply`,
      origin: 'agent',
      payload: {},
      parentId: first.id,
    })
    await transition(db, child.id, 'start')
    expect((await svc.getStatus(child.id))?.status).toBe('active')
    await transition(db, first.id, 'finish')
    expect((await svc.getStatus(first.id))?.status).toBe('terminal')
    expect((await svc.getStatus(first.id))?.outcome).toBe('done')

    // Re-START the input agent. Scan 1 has a LIVE descendant, so it must NOT be superseded (it stays
    // terminal/done); a NEW scan is dispatched (scan 1's ROOT is not itself live, so the one-live-gate
    // falls through to dispatch a fresh scan).
    const second = await svc.dispatch({
      workflowId,
      agentId: sorterId,
      origin: 'human',
      payload: {},
    })
    expect(second.id).not.toBe(first.id)
    expect((await makeStateStore(db).getWorkItem(first.id))?.outcome).not.toBe('superseded')
    expect((await svc.getStatus(first.id))?.outcome).toBe('done')
    // The live child is untouched.
    expect((await svc.getStatus(child.id))?.status).toBe('active')
  })

  it('a second START while a scan is LIVE returns the live scan (no second scan)', async () => {
    // blockingProvider keeps the first scan ACTIVE (slot occupied → live).
    const { svc, workflowId, sorterId } = makeInputService(blockingProvider())
    const first = await svc.dispatch({
      workflowId,
      agentId: sorterId,
      origin: 'human',
      payload: {},
    })
    await waitFor(async () => (await svc.getStatus(first.id))?.status === 'active')

    const second = await svc.dispatch({
      workflowId,
      agentId: sorterId,
      origin: 'human',
      payload: {},
    })
    expect(second.id).toBe(first.id)
    expect(second.deduped).toBe(true)
  })
})

describe.skipIf(!reachable)('PipelineService.cancelInstance (B2)', () => {
  it('cancelInstance stops every live Run of one (agentId, key) + cascades to children', async () => {
    // instanceKeyOf reads the `k` field from payload; falls back to agentId (for other tests).
    const runtime: AgentRuntime = {
      provider: blockingProvider(),
      renderToolNames: [],
      maxInstances: 3, // allow two concurrent Runs for the same agentId
      effects: {},
      dispatchToolNames: [],
      handoffs: [],
    }
    const wf = `cancel-instance-${randomUUID().slice(0, 8)}`
    const agentId = `${wf}__reply`
    const service = makePipelineService({
      db,
      resolveAgent: () => runtime,
      descriptors: [],
      instanceKeyOf: (a, p) => ((p as Record<string, unknown>).k as string | undefined) ?? a,
      sourceOf: () => null,
    })

    // Two reply Runs for the SAME sender key 'alice', each with a distinct payload so the
    // dedup-by-source chokepoint lets both through (this service's sourceOf returns null — the
    // default stub below — so two null-source items are BOTH accepted by the chokepoint). Use
    // origin='agent' so the human Start-over path does not interfere.
    const r1 = await service.dispatch({
      workflowId: wf,
      agentId,
      origin: 'agent',
      payload: { k: 'alice' },
    })
    const r2 = await service.dispatch({
      workflowId: wf,
      agentId,
      origin: 'agent',
      payload: { k: 'alice', seq: 2 }, // distinct payload → still same key 'alice'
    })

    // Wait for both to become active (blockingProvider keeps them running).
    await waitFor(async () => (await service.getStatus(r1.id))?.status === 'active')
    await waitFor(async () => (await service.getStatus(r2.id))?.status === 'active')

    // Cancel every Run sharing (wf, wf__reply, 'alice').
    await service.cancelInstance(wf, agentId, 'alice')

    expect((await service.getStatus(r1.id))?.outcome).toBe('stopped')
    expect((await service.getStatus(r2.id))?.outcome).toBe('stopped')
  }, 10_000)

  it('cancelInstance on a TERMINAL spawning root still cascades to its live children', async () => {
    // The bug: cancelInstance pre-filtered the snapshot to live items only, so a spawning root
    // whose OWN Run already FINISHED (terminal/done) was dropped — and its live children (a
    // different agentId/key) never got the cascade. cancelItem already handles per-item liveness
    // (no-ops a terminal item) AND cascades to its active children, so matching by identity alone
    // is correct. Mirrors the B1 'finished scan with a live descendant' state.
    const inputWf = defineWorkflow({
      id: `cancel-terminal-${randomUUID().slice(0, 8)}`,
      label: 'B',
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
    const wf = inputWf.id
    const sorterId = `${wf}__sorter`
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
      descriptors: [inputWf],
      instanceKeyOf: (agentId) => agentId,
      sourceOf: () => null,
    })

    // Drive the input scan to active, then dispatch a child (different agentId/key) under it and
    // drive THAT to active. Finish the scan so the ROOT is terminal/done while the child stays live.
    const root = await svc.dispatch({
      workflowId: wf,
      agentId: sorterId,
      origin: 'human',
      payload: {},
    })
    await waitFor(async () => (await svc.getStatus(root.id))?.status === 'active')

    const child = await svc.dispatch({
      workflowId: wf,
      agentId: `${wf}__reply`,
      origin: 'agent',
      payload: {},
      parentId: root.id,
    })
    await transition(db, child.id, 'start')
    expect((await svc.getStatus(child.id))?.status).toBe('active')

    await transition(db, root.id, 'finish')
    expect((await svc.getStatus(root.id))?.status).toBe('terminal')
    expect((await svc.getStatus(root.id))?.outcome).toBe('done')

    // Stop the whole instance by the ROOT's (agentId, key). The root is terminal (cancelItem
    // no-ops it) but its live child must be cascaded to stopped.
    await svc.cancelInstance(wf, sorterId, sorterId)

    expect((await svc.getStatus(child.id))?.outcome).toBe('stopped')
  }, 10_000)
})

describe.skipIf(!reachable)('PipelineService input START Start-over (Bug 1)', () => {
  // A provider that opens a gate then ends — the input root suspends at the gate (awaiting_human)
  // and its pool slot is released. Approach-B steady state for a single-agent input scan: the scan
  // is still LIVE (awaiting the human) yet the worker pool count reads 0.
  function gateProviderLocal(): Provider {
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

  function makeGateInputService() {
    const wf = `live-scan-${randomUUID().slice(0, 8)}`
    const inputWf = defineWorkflow({
      id: wf,
      label: 'L',
      iconName: 'inbox',
      agents: [
        {
          agent: defineAgent({
            id: 'sorter',
            name: 's',
            provider: 'mock',
            instructions: 'x',
            tools: ['saveDraft'],
            approvals: ['saveDraft'],
            renders: {},
          }),
          role: 'input',
        },
      ],
      entryAgentId: 'sorter',
      inputs: [],
    })
    const runtime: AgentRuntime = {
      provider: gateProviderLocal(),
      renderToolNames: [],
      maxInstances: 1,
      effects: { saveDraft: async () => ({}) },
      dispatchToolNames: [],
      handoffs: [],
    }
    const svc = makePipelineService({
      db,
      resolveAgent: () => runtime,
      descriptors: [inputWf],
      instanceKeyOf: (agentId) => agentId,
      sourceOf: () => null,
    })
    return { svc, workflowId: wf, agentId: `${wf}__sorter` }
  }

  it('a second human START while the prior scan is awaiting approval returns the live scan (one-open gate)', async () => {
    const { svc, workflowId, agentId } = makeGateInputService()
    const first = await svc.dispatch({ workflowId, agentId, origin: 'human', payload: {} })

    // Drive the input root to awaiting_human: it suspends at the gate (still live) and the worker
    // pool releases its slot — pool.activeCount(agentId) is now 0 even though the scan is live.
    await waitFor(async () => (await svc.getStatus(first.id))?.status === 'awaiting_human')
    expect((await svc.stats(agentId)).active).toBe(0) // slot freed at the gate

    // B1 one-live-gate: an awaiting scan is still LIVE, so the second START returns it (no second
    // scan) — the live root is untouched (still awaiting_human).
    const second = await svc.dispatch({ workflowId, agentId, origin: 'human', payload: {} })
    expect(second.id).toBe(first.id)
    expect(second.deduped).toBe(true)
    expect((await svc.getStatus(first.id))?.status).toBe('awaiting_human')
  })

  it('a sequential re-START once the prior scan fully settles (gate resolved → finished) supersedes it', async () => {
    const { svc, workflowId, agentId } = makeGateInputService()
    const first = await svc.dispatch({ workflowId, agentId, origin: 'human', payload: {} })
    await waitFor(async () => (await svc.getStatus(first.id))?.status === 'awaiting_human')
    const board = await svc.getBoard()
    const gate = board.gates.find((g) => g.workItemId === first.id)
    expect(gate).toBeDefined()
    // Resolve the gate → the run resumes and finishes; the scan is no longer live.
    await svc.resolveGate(gate!.id, { gateId: gate!.id, decision: 'approved', formRev: 0 })
    await waitFor(async () => (await svc.getStatus(first.id))?.status === 'terminal')

    // A fresh human START now supersedes the prior finished root (→ superseded, hidden).
    const second = await svc.dispatch({ workflowId, agentId, origin: 'human', payload: {} })
    expect(second.id).not.toBe(first.id)
    const firstStatus = await svc.getStatus(first.id)
    expect(firstStatus?.status).toBe('terminal')
    expect(firstStatus?.outcome).toBe('superseded')
  })

  it('machine dispatch (origin=agent) to a live input scan is NOT wiped by the START path', async () => {
    const { svc, workflowId, agentId } = makeGateInputService()
    const first = await svc.dispatch({ workflowId, agentId, origin: 'human', payload: {} })
    await waitFor(async () => (await svc.getStatus(first.id))?.status === 'awaiting_human')
    // origin='agent' bypasses the human START Start-over path — it goes to the chokepoint.
    const machine = await svc.dispatch({ workflowId, agentId, origin: 'agent', payload: {} })
    expect(machine.id).not.toBe('')
    // The prior awaiting root is untouched (still awaiting_human).
    expect((await svc.getStatus(first.id))?.status).toBe('awaiting_human')
  })
})
