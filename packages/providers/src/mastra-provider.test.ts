import { describe, it, expect, vi } from 'vitest'
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import { readGateOpened } from '@platform/core'
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
