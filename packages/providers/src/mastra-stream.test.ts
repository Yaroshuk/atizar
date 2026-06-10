import { describe, it, expect } from 'vitest'
import { EventType, type BaseEvent } from '@ag-ui/client'
import { mapMastraStream } from './mastra-stream.js'
import type { MastraChunk } from './mastra-types.js'

async function* from(chunks: MastraChunk[]): AsyncGenerator<MastraChunk> {
  for (const c of chunks) yield c
}
async function collect(it: AsyncIterable<BaseEvent>): Promise<BaseEvent[]> {
  const out: BaseEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

describe('mapMastraStream', () => {
  it('maps contiguous text-delta to ONE messageId, resets after a tool call', async () => {
    const events = await collect(
      mapMastraStream(
        from([
          { type: 'text-delta', payload: { text: 'Draf' } },
          { type: 'text-delta', payload: { text: 'ted a reply' } },
          {
            type: 'tool-call',
            payload: { toolCallId: 't1', toolName: 'renderLead', args: { from: 'a' } },
          },
          { type: 'text-delta', payload: { text: 'after' } },
        ]),
        { surfaceTools: ['renderLead'] }
      )
    )
    const texts = events.filter((e) => e.type === EventType.TEXT_MESSAGE_CHUNK) as Array<
      BaseEvent & { messageId: string; delta: string }
    >
    expect(texts.map((t) => t.delta)).toEqual(['Draf', 'ted a reply', 'after'])
    expect(texts[0].messageId).toBe(texts[1].messageId)
    expect(texts[2].messageId).not.toBe(texts[0].messageId)
  })

  it('maps a tool-call to START/ARGS/END and filters unsurfaced tools', async () => {
    const events = await collect(
      mapMastraStream(
        from([
          {
            type: 'tool-call',
            payload: { toolCallId: 't1', toolName: 'renderLead', args: { from: 'a' } },
          },
          { type: 'tool-call', payload: { toolCallId: 't2', toolName: 'ToolSearch', args: {} } },
        ]),
        { surfaceTools: ['renderLead'] }
      )
    )
    const names = events
      .filter((e) => e.type === EventType.TOOL_CALL_START)
      .map((e) => (e as unknown as { toolCallName: string }).toolCallName)
    expect(names).toEqual(['renderLead'])
    const argsEvents = events.filter((e) => e.type === EventType.TOOL_CALL_ARGS)
    expect((argsEvents[0] as unknown as { delta: string }).delta).toBe('{"from":"a"}')
  })

  it('surfaces a tool-result only for a surfaced tool', async () => {
    const events = await collect(
      mapMastraStream(
        from([
          { type: 'tool-call', payload: { toolCallId: 't1', toolName: 'renderLead', args: {} } },
          { type: 'tool-result', payload: { toolCallId: 't1', result: { ok: true } } },
        ]),
        { surfaceTools: ['renderLead'] }
      )
    )
    expect(events.some((e) => e.type === EventType.TOOL_CALL_RESULT)).toBe(true)
  })

  it('error chunk yields a TEXT_MESSAGE_CHUNK whose delta starts with "Provider error:"', async () => {
    const events = await collect(
      mapMastraStream(from([{ type: 'error', payload: { error: 'timeout' } }]), {
        surfaceTools: [],
      })
    )
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe(EventType.TEXT_MESSAGE_CHUNK)
    const delta = (events[0] as unknown as { delta: string }).delta
    expect(delta).toMatch(/^Provider error:/)
    expect(delta).toContain('timeout')
  })

  it('skips empty/missing text in a text-delta chunk (no event emitted)', async () => {
    const events = await collect(
      mapMastraStream(
        from([
          { type: 'text-delta', payload: { text: '' } },
          { type: 'text-delta', payload: {} as { text: string } },
          { type: 'text-delta', payload: { text: 'hello' } },
        ]),
        { surfaceTools: [] }
      )
    )
    const textEvents = events.filter((e) => e.type === EventType.TEXT_MESSAGE_CHUNK)
    expect(textEvents).toHaveLength(1)
    expect((textEvents[0] as unknown as { delta: string }).delta).toBe('hello')
  })

  it('maps payload-less (flattened-root) text-delta and tool-call chunks correctly', async () => {
    const events = await collect(
      mapMastraStream(
        from([
          { type: 'text-delta', text: 'hi' } as unknown as MastraChunk,
          {
            type: 'tool-call',
            toolCallId: 't1',
            toolName: 'renderLead',
            args: { x: 1 },
          } as unknown as MastraChunk,
        ]),
        { surfaceTools: ['renderLead'] }
      )
    )
    const textEvents = events.filter((e) => e.type === EventType.TEXT_MESSAGE_CHUNK)
    expect(textEvents).toHaveLength(1)
    expect((textEvents[0] as unknown as { delta: string }).delta).toBe('hi')

    const startEvents = events.filter((e) => e.type === EventType.TOOL_CALL_START)
    expect(startEvents).toHaveLength(1)
    expect((startEvents[0] as unknown as { toolCallName: string }).toolCallName).toBe('renderLead')

    const argsEvents = events.filter((e) => e.type === EventType.TOOL_CALL_ARGS)
    expect((argsEvents[0] as unknown as { delta: string }).delta).toBe('{"x":1}')
  })

  it('emits no TOOL_CALL_RESULT for a tool-result whose tool-call was unsurfaced', async () => {
    const events = await collect(
      mapMastraStream(
        from([
          {
            type: 'tool-call',
            payload: { toolCallId: 't2', toolName: 'ToolSearch', args: {} },
          },
          { type: 'tool-result', payload: { toolCallId: 't2', result: { data: 'secret' } } },
        ]),
        { surfaceTools: ['renderLead'] }
      )
    )
    expect(events.filter((e) => e.type === EventType.TOOL_CALL_RESULT)).toHaveLength(0)
  })
})
