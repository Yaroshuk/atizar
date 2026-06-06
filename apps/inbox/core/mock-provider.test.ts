import { describe, it, expect } from 'vitest'
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
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

  it('resume: emits only the done text once the approval is answered', async () => {
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
    expect((events[0] as unknown as { delta: string }).delta).toMatch(/done/i)
  })
})
