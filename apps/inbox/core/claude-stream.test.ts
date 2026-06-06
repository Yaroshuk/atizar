import { describe, it, expect } from 'vitest'
import { EventType } from '@ag-ui/client'
import { mapClaudeStream } from './claude-stream.js'

async function* fromLines(lines: string[]) {
  for (const l of lines) yield l
}

async function collect(lines: string[], approvalNames: string[]) {
  const out: any[] = []
  for await (const ev of mapClaudeStream(fromLines(lines), { approvalNames })) out.push(ev)
  return out
}

const textDelta = (t: string) =>
  JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } } })
const toolStart = (index: number, id: string, name: string) =>
  JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name, input: {} } } })
const toolArgs = (index: number, partial: string) =>
  JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: partial } } })
const blockStop = (index: number) =>
  JSON.stringify({ type: 'stream_event', event: { type: 'content_block_stop', index } })

describe('mapClaudeStream', () => {
  it('maps text deltas to TEXT_MESSAGE_CHUNK', async () => {
    const out = await collect([textDelta('Hello '), textDelta('world')], ['confirmSend'])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ type: EventType.TEXT_MESSAGE_CHUNK, role: 'assistant', delta: 'Hello ' })
    expect(out[1]).toMatchObject({ delta: 'world' })
  })

  it('maps a tool call (mcp prefix stripped) to START/ARGS/END', async () => {
    const out = await collect(
      [toolStart(0, 'tc1', 'mcp__inbox__renderLead'), toolArgs(0, '{"id":42}'), blockStop(0)],
      ['confirmSend'],
    )
    expect(out[0]).toMatchObject({ type: EventType.TOOL_CALL_START, toolCallId: 'tc1', toolCallName: 'renderLead' })
    expect(out[1]).toMatchObject({ type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc1', delta: '{"id":42}' })
    expect(out[2]).toMatchObject({ type: EventType.TOOL_CALL_END, toolCallId: 'tc1' })
  })

  it('STOPS after the approval tool call ends (no further events)', async () => {
    const out = await collect(
      [
        textDelta('found a lead'),
        toolStart(0, 'tc_lead', 'mcp__inbox__renderLead'),
        blockStop(0),
        toolStart(1, 'tc_ok', 'mcp__inbox__confirmSend'),
        toolArgs(1, '{"leadId":42,"message":"ok?"}'),
        blockStop(1),
        textDelta('THIS MUST NOT APPEAR'),
      ],
      ['confirmSend'],
    )
    expect(out.some((e) => e.delta === 'THIS MUST NOT APPEAR')).toBe(false)
    expect(out.at(-1)).toMatchObject({ type: EventType.TOOL_CALL_END, toolCallId: 'tc_ok' })
  })

  it('skips malformed lines and blanks', async () => {
    const out = await collect(['', 'not json', '{bad', textDelta('ok')], ['confirmSend'])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ delta: 'ok' })
  })

  it('emits args from content_block_start.input when no input_json_delta arrives', async () => {
    const start = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc1', name: 'mcp__inbox__renderLead', input: { id: 42 } } },
    })
    const out = await collect([start, blockStop(0)], ['confirmSend'])
    expect(out.map((e) => e.type)).toEqual([EventType.TOOL_CALL_START, EventType.TOOL_CALL_ARGS, EventType.TOOL_CALL_END])
    expect(out[1]).toMatchObject({ toolCallId: 'tc1', delta: '{"id":42}' })
  })
})
