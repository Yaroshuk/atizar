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
})
