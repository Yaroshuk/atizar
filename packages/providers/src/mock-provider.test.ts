import { describe, it, expect } from 'vitest'
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import { providerConformanceChecks, type ConformanceScenario } from '@atizar/core'
import { createMockInboxProvider } from './mock-provider.js'

async function collect(stream: AsyncIterable<BaseEvent>): Promise<BaseEvent[]> {
  const out: BaseEvent[] = []
  for await (const e of stream) out.push(e)
  return out
}

// Minimal RunAgentInput; only `messages` matters to the mock.
function input(messages: unknown[]): RunAgentInput {
  return { messages } as unknown as RunAgentInput
}

// A transcript with an answered saveDraft approval. Shared by both scenario branches: the mock's
// resume() ignores the handle entirely, so the same fixture stands in for approved AND rejected
// (the decision comes from `resolution`, not the transcript). Task 6's claude-cli fixture differs.
const resolvedMessages = [
  {
    role: 'assistant',
    toolCalls: [
      {
        id: 'tc_ok',
        type: 'function',
        function: { name: 'saveDraft', arguments: '{"threadId":"t","body":"b"}' },
      },
    ],
  },
  { role: 'tool', toolCallId: 'tc_ok', content: 'approved' },
]

const scenario: ConformanceScenario = {
  approvalNames: ['saveDraft'],
  surfaceTools: ['renderLead', 'saveDraft'],
  turn1Input: { messages: [] } as unknown as RunAgentInput,
  approved: {
    handle: { runId: 'r1', input: { messages: resolvedMessages } as unknown as RunAgentInput },
    resolution: { gateId: 'g1', decision: 'approved', form: { threadId: 't', body: 'b' } },
  },
  rejected: {
    handle: { runId: 'r1', input: { messages: resolvedMessages } as unknown as RunAgentInput },
    resolution: { gateId: 'g1', decision: 'rejected' },
  },
}

describe('mock-provider conformance', () => {
  for (const check of providerConformanceChecks) {
    it(check.name, () => check.run(() => createMockInboxProvider(['saveDraft']), scenario))
  }
})

describe('mock provider answer-resume', () => {
  it('yields a turn that reflects the delivered answer', async () => {
    const p = createMockInboxProvider(['saveDraft'])
    const events = await collect(
      p.resume!(
        { runId: 'r1', input: { messages: [] } as never },
        { kind: 'answer', answers: [{ target: {}, answer: { text: 'use X' }, ok: true }], allOk: true }
      )
    )
    expect(events.length).toBeGreaterThan(0)
    const text = events
      .filter((e) => e.type === EventType.TEXT_MESSAGE_CHUNK)
      .map((e) => (e as unknown as { delta: string }).delta)
      .join('')
    expect(text).toContain('answer')
  })
})

describe('mockInboxProvider', () => {
  const provider = createMockInboxProvider(['saveDraft'])

  it('turn 1: streams text, renderLead, then saveDraft', async () => {
    const events = await collect(provider.run(input([])))
    const types = events.map((e) => e.type)
    expect(types).toContain(EventType.TEXT_MESSAGE_CHUNK)
    const toolNames = events
      .filter((e) => e.type === EventType.TOOL_CALL_START)
      .map((e) => (e as unknown as { toolCallName: string }).toolCallName)
    expect(toolNames).toEqual(['renderLead', 'saveDraft'])
  })

  it('run() with resolved messages: exits early with done text (legacy back-compat path)', async () => {
    const resumed = [
      {
        role: 'assistant',
        id: 'a1',
        toolCalls: [
          { id: 'x1', type: 'function', function: { name: 'saveDraft', arguments: '{}' } },
        ],
      },
      { role: 'tool', id: 't1', content: 'approved', toolCallId: 'x1' },
    ]
    const events = await collect(provider.run(input(resumed)))
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe(EventType.TEXT_MESSAGE_CHUNK)
    expect((events[0] as unknown as { delta: string }).delta).toMatch(/draft saved/i)
  })
})
