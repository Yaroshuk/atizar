import { describe, it, expect, vi } from 'vitest'
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import { readGateOpened, providerConformanceChecks, type ConformanceScenario } from '@atizar/core'
import type { ResumeHandle } from '@atizar/core'
import { createMastraProvider } from './mastra-provider.js'
import type { MastraChunk, MastraRunner, MastraRun, MastraRunResult } from './mastra-types.js'

async function collect(it: AsyncIterable<BaseEvent>): Promise<BaseEvent[]> {
  const out: BaseEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

// A fake runner: scripts a chunk stream + a settled result, records abort().
function fakeRun(chunks: MastraChunk[], result: MastraRunResult, onAbort = () => {}): MastraRun {
  return {
    stream: (async function* () {
      for (const c of chunks) yield c
    })(),
    result: Promise.resolve(result),
    abort: onAbort,
  }
}

const DRAFT = { threadId: 't1', body: 'hello' }
const input = { messages: [], runId: 'r1' } as unknown as RunAgentInput

describe('createMastraProvider run()', () => {
  it('turn 1 with a saveDraft proposal suspends → exactly one GATE_OPENED', async () => {
    const runner: MastraRunner = {
      start: () =>
        fakeRun(
          [
            { type: 'text-delta', payload: { text: 'Drafting…' } },
            {
              type: 'tool-call',
              payload: { toolCallId: 'tc1', toolName: 'renderLead', args: { from: 'a' } },
            },
            {
              type: 'tool-call',
              payload: { toolCallId: 'tc2', toolName: 'saveDraft', args: DRAFT },
            },
          ],
          { status: 'suspended' }
        ),
      resume: () => fakeRun([], { status: 'completed' }),
    }
    const p = createMastraProvider({
      approvalNames: ['saveDraft'],
      surfaceTools: ['renderLead', 'saveDraft'],
      runner,
    })
    const events = await collect(p.run(input))
    const gates = events.map(readGateOpened).filter(Boolean)
    expect(gates).toHaveLength(1)
    expect(gates[0]!.toolName).toBe('saveDraft')
    expect(gates[0]!.toolCallId).toBe('tc2')
    expect(gates[0]!.proposedArtifact).toEqual(DRAFT)
  })

  it('no saveDraft + completed → no gate, just finishes (caution b)', async () => {
    const runner: MastraRunner = {
      start: () =>
        fakeRun(
          [
            {
              type: 'tool-call',
              payload: { toolCallId: 'v1', toolName: 'renderVerdict', args: {} },
            },
          ],
          { status: 'completed' }
        ),
      resume: () => fakeRun([], { status: 'completed' }),
    }
    const p = createMastraProvider({ approvalNames: [], surfaceTools: ['renderVerdict'], runner })
    const events = await collect(p.run(input))
    expect(events.map(readGateOpened).filter(Boolean)).toHaveLength(0)
    expect(events.length).toBeGreaterThan(0)
  })

  it('last saveDraft wins when emitted twice (caution b)', async () => {
    const runner: MastraRunner = {
      start: () =>
        fakeRun(
          [
            {
              type: 'tool-call',
              payload: { toolCallId: 'a', toolName: 'saveDraft', args: { body: 'first' } },
            },
            {
              type: 'tool-call',
              payload: { toolCallId: 'b', toolName: 'saveDraft', args: { body: 'second' } },
            },
          ],
          { status: 'suspended' }
        ),
      resume: () => fakeRun([], { status: 'completed' }),
    }
    const p = createMastraProvider({
      approvalNames: ['saveDraft'],
      surfaceTools: ['saveDraft'],
      runner,
    })
    const gates = (await collect(p.run(input))).map(readGateOpened).filter(Boolean)
    expect(gates).toHaveLength(1)
    expect(gates[0]!.toolCallId).toBe('b')
    expect(gates[0]!.proposedArtifact).toEqual({ body: 'second' })
  })

  it('calls abort() when the consumer stops early (caution a)', async () => {
    const onAbort = vi.fn()
    const runner: MastraRunner = {
      start: () =>
        fakeRun(
          [
            { type: 'text-delta', payload: { text: 'one' } },
            { type: 'text-delta', payload: { text: 'two' } },
          ],
          { status: 'completed' },
          onAbort
        ),
      resume: () => fakeRun([], { status: 'completed' }),
    }
    const p = createMastraProvider({ approvalNames: [], surfaceTools: [], runner })
    const it = p.run(input)[Symbol.asyncIterator]()
    await it.next() // first event
    await it.return!(undefined) // consumer stops → finally → abort
    expect(onAbort).toHaveBeenCalledTimes(1)
  })

  it('does NOT abort on a clean suspend (the parked run must survive for native resume)', async () => {
    const onAbort = vi.fn()
    const runner: MastraRunner = {
      start: () =>
        fakeRun(
          [{ type: 'tool-call', payload: { toolCallId: 'd', toolName: 'saveDraft', args: DRAFT } }],
          { status: 'suspended' },
          onAbort
        ),
      resume: () => fakeRun([], { status: 'completed' }),
    }
    const p = createMastraProvider({
      approvalNames: ['saveDraft'],
      surfaceTools: ['saveDraft'],
      runner,
    })
    await collect(p.run(input)) // fully consume to the natural end
    expect(onAbort).not.toHaveBeenCalled()
  })

  it('does NOT abort on a clean completion', async () => {
    const onAbort = vi.fn()
    const runner: MastraRunner = {
      start: () =>
        fakeRun(
          [{ type: 'text-delta', payload: { text: 'hi' } }],
          { status: 'completed' },
          onAbort
        ),
      resume: () => fakeRun([], { status: 'completed' }),
    }
    const p = createMastraProvider({ approvalNames: [], surfaceTools: [], runner })
    await collect(p.run(input))
    expect(onAbort).not.toHaveBeenCalled()
  })

  it('failed result yields an error chunk', async () => {
    const runner: MastraRunner = {
      start: () => fakeRun([], { status: 'failed', error: 'boom' }),
      resume: () => fakeRun([], { status: 'completed' }),
    }
    const p = createMastraProvider({ approvalNames: [], surfaceTools: [], runner })
    const events = await collect(p.run(input))
    const text = events.find((e) => e.type === EventType.TEXT_MESSAGE_CHUNK) as unknown as {
      delta: string
    }
    expect(text.delta).toContain('boom')
  })
})

describe('createMastraProvider resume()', () => {
  const handle = { runId: 'r1', input } as ResumeHandle

  it('approved completes, re-opens no gate, emits events', async () => {
    const runner: MastraRunner = {
      start: () => fakeRun([], { status: 'completed' }),
      resume: () =>
        fakeRun([{ type: 'text-delta', payload: { text: 'The Gmail draft was saved.' } }], {
          status: 'completed',
        }),
    }
    const p = createMastraProvider({
      approvalNames: ['saveDraft'],
      surfaceTools: ['saveDraft'],
      runner,
    })
    const events = await collect(
      p.resume!(handle, {
        gateId: 'g1',
        decision: 'approved',
        form: DRAFT,
        executedResult: { draftId: 'd1' },
      })
    )
    expect(events.map(readGateOpened).filter(Boolean)).toHaveLength(0)
    expect(events.length).toBeGreaterThan(0)
  })

  it('rejected terminates with no tool call', async () => {
    const runner: MastraRunner = {
      start: () => fakeRun([], { status: 'completed' }),
      resume: () =>
        fakeRun([{ type: 'text-delta', payload: { text: 'Rejected; nothing was saved.' } }], {
          status: 'completed',
        }),
    }
    const p = createMastraProvider({
      approvalNames: ['saveDraft'],
      surfaceTools: ['saveDraft'],
      runner,
    })
    const events = await collect(p.resume!(handle, { gateId: 'g1', decision: 'rejected' }))
    expect(events.filter((e) => e.type === EventType.TOOL_CALL_START)).toHaveLength(0)
    expect(events.map(readGateOpened).filter(Boolean)).toHaveLength(0)
    expect(events.length).toBeGreaterThan(0)
  })

  it('passes the resolution to runner.resume keyed by handle.runId', async () => {
    const resume = vi.fn(() =>
      fakeRun([{ type: 'text-delta', payload: { text: 'ok' } }], { status: 'completed' as const })
    )
    const runner: MastraRunner = { start: () => fakeRun([], { status: 'completed' }), resume }
    const p = createMastraProvider({ approvalNames: ['saveDraft'], surfaceTools: [], runner })
    await collect(
      p.resume!(handle, { gateId: 'g1', decision: 'approved', executedResult: { draftId: 'd1' } })
    )
    expect(resume).toHaveBeenCalledWith('r1', expect.objectContaining({ decision: 'approved' }))
  })
})

// A fake runner that satisfies the conformance scenario: turn1 → suspend at saveDraft;
// resume(approved) → completed text; resume(rejected) → completed text, no tool call.
function conformanceRunner(): MastraRunner {
  return {
    start: () =>
      fakeRun(
        [
          {
            type: 'tool-call',
            payload: { toolCallId: 'tc-render', toolName: 'renderLead', args: { from: 'a' } },
          },
          {
            type: 'tool-call',
            payload: { toolCallId: 'tc-draft', toolName: 'saveDraft', args: DRAFT },
          },
        ],
        { status: 'suspended' }
      ),
    resume: (_runId, payload) =>
      fakeRun(
        [
          {
            type: 'text-delta',
            payload: {
              text:
                payload.kind !== 'answer' && payload.decision === 'approved'
                  ? 'Saved.'
                  : 'Rejected.',
            },
          },
        ],
        { status: 'completed' }
      ),
  }
}

const scenario: ConformanceScenario = {
  approvalNames: ['saveDraft'],
  surfaceTools: ['renderLead', 'saveDraft'],
  turn1Input: { messages: [], runId: 'r1' } as unknown as RunAgentInput,
  approved: {
    handle: { runId: 'r1', input: { messages: [] } as unknown as RunAgentInput },
    resolution: {
      gateId: 'g1',
      decision: 'approved',
      form: DRAFT,
      executedResult: { draftId: 'd1' },
    },
  },
  rejected: {
    handle: { runId: 'r1', input: { messages: [] } as unknown as RunAgentInput },
    resolution: { gateId: 'g1', decision: 'rejected' },
  },
  answered: {
    handle: { runId: 'r1', input: { messages: [] } as never },
    payload: {
      kind: 'answer',
      answers: [{ target: {}, answer: { text: 'use X' }, ok: true }],
      allOk: true,
    },
  },
}

describe('mastra-provider conformance', () => {
  for (const check of providerConformanceChecks) {
    it(check.name, () =>
      check.run(
        () =>
          createMastraProvider({
            approvalNames: ['saveDraft'],
            surfaceTools: ['renderLead', 'saveDraft'],
            runner: conformanceRunner(),
          }),
        scenario
      )
    )
  }
})
