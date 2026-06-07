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
  JSON.stringify({
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } },
  })
const toolStart = (index: number, id: string, name: string) =>
  JSON.stringify({
    type: 'stream_event',
    event: {
      type: 'content_block_start',
      index,
      content_block: { type: 'tool_use', id, name, input: {} },
    },
  })
const toolArgs = (index: number, partial: string) =>
  JSON.stringify({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index,
      delta: { type: 'input_json_delta', partial_json: partial },
    },
  })
const blockStop = (index: number) =>
  JSON.stringify({ type: 'stream_event', event: { type: 'content_block_stop', index } })

describe('mapClaudeStream', () => {
  it('maps text deltas to TEXT_MESSAGE_CHUNK', async () => {
    const out = await collect([textDelta('Hello '), textDelta('world')], ['confirmSend'])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({
      type: EventType.TEXT_MESSAGE_CHUNK,
      role: 'assistant',
      delta: 'Hello ',
    })
    expect(out[1]).toMatchObject({ delta: 'world' })
  })

  it('maps a tool call (mcp prefix stripped) to START/ARGS/END', async () => {
    const out = await collect(
      [toolStart(0, 'tc1', 'mcp__inbox__renderLead'), toolArgs(0, '{"id":42}'), blockStop(0)],
      ['confirmSend']
    )
    expect(out[0]).toMatchObject({
      type: EventType.TOOL_CALL_START,
      toolCallId: 'tc1',
      toolCallName: 'renderLead',
    })
    expect(out[1]).toMatchObject({
      type: EventType.TOOL_CALL_ARGS,
      toolCallId: 'tc1',
      delta: '{"id":42}',
    })
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
      ['confirmSend']
    )
    expect(out.some((e) => e.delta === 'THIS MUST NOT APPEAR')).toBe(false)
    expect(out.at(-1)).toMatchObject({ type: EventType.TOOL_CALL_END, toolCallId: 'tc_ok' })
  })

  it('skips malformed lines and blanks', async () => {
    const out = await collect(['', 'not json', '{bad', textDelta('ok')], ['confirmSend'])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ delta: 'ok' })
  })

  const assistantMsg = (content: unknown[]) =>
    JSON.stringify({ type: 'assistant', message: { content } })

  it('filters out non-surface (internal) tool calls like ToolSearch, keeps contract tools', async () => {
    const out: any[] = []
    const lines = [
      toolStart(0, 'tc_search', 'ToolSearch'),
      toolArgs(0, '{"query":"inbox"}'),
      blockStop(0),
      toolStart(1, 'tc_lead', 'mcp__inbox__renderLead'),
      toolArgs(1, '{"id":42}'),
      blockStop(1),
    ]
    for await (const ev of mapClaudeStream(fromLines(lines), {
      approvalNames: ['confirmSend'],
      surfaceTools: ['renderLead', 'confirmSend'],
    })) {
      out.push(ev)
    }
    const starts = out.filter((e) => e.type === EventType.TOOL_CALL_START)
    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({ toolCallName: 'renderLead' })
    expect(out.some((e) => e.toolCallName === 'ToolSearch')).toBe(false)
  })

  it('maps a complete top-level assistant message (synthetic/non-streamed turn)', async () => {
    const out = await collect(
      [
        assistantMsg([
          { type: 'text', text: 'Done — reply sent.' },
          { type: 'tool_use', id: 'tc_lead', name: 'mcp__inbox__renderLead', input: { id: 42 } },
        ]),
      ],
      ['confirmSend']
    )
    expect(out[0]).toMatchObject({
      type: EventType.TEXT_MESSAGE_CHUNK,
      delta: 'Done — reply sent.',
    })
    expect(out[1]).toMatchObject({
      type: EventType.TOOL_CALL_START,
      toolCallId: 'tc_lead',
      toolCallName: 'renderLead',
    })
    expect(out[2]).toMatchObject({
      type: EventType.TOOL_CALL_ARGS,
      toolCallId: 'tc_lead',
      delta: '{"id":42}',
    })
    expect(out[3]).toMatchObject({ type: EventType.TOOL_CALL_END, toolCallId: 'tc_lead' })
  })

  it('skips TEXT from a <synthetic> assistant message (system notice), still surfaced via result-error', async () => {
    const synthetic = JSON.stringify({
      type: 'assistant',
      message: {
        model: '<synthetic>',
        content: [{ type: 'text', text: 'Not logged in · Please run /login' }],
      },
    })
    const out = await collect([synthetic], ['confirmSend'])
    expect(out).toHaveLength(0)
  })

  it('stops at an approval tool_use in a complete top-level assistant message', async () => {
    const out = await collect(
      [
        assistantMsg([
          { type: 'tool_use', id: 'tc_ok', name: 'mcp__inbox__confirmSend', input: { leadId: 42 } },
        ]),
        textDelta('NOPE'),
      ],
      ['confirmSend']
    )
    expect(out.at(-1)).toMatchObject({ type: EventType.TOOL_CALL_END, toolCallId: 'tc_ok' })
    expect(out.some((e) => e.delta === 'NOPE')).toBe(false)
  })

  it('does not double-emit when streamed deltas are followed by the complete message', async () => {
    const out = await collect(
      [
        JSON.stringify({ type: 'stream_event', event: { type: 'message_start' } }),
        textDelta('hello'),
        toolStart(0, 'tc_lead', 'mcp__inbox__renderLead'),
        toolArgs(0, '{"id":42}'),
        blockStop(0),
        // The same content arrives again as a complete assistant message:
        assistantMsg([
          { type: 'text', text: 'hello' },
          { type: 'tool_use', id: 'tc_lead', name: 'mcp__inbox__renderLead', input: { id: 42 } },
        ]),
      ],
      ['confirmSend']
    )
    expect(out.filter((e) => e.type === EventType.TEXT_MESSAGE_CHUNK)).toHaveLength(1)
    expect(out.filter((e) => e.type === EventType.TOOL_CALL_START)).toHaveLength(1)
  })

  it('surfaces a run-level result error (e.g. auth failure) as a text chunk and stops', async () => {
    const out = await collect(
      [
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: true,
          result: 'Not logged in · Please run /login',
        }),
        textDelta('THIS MUST NOT APPEAR'),
      ],
      ['confirmSend']
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ type: EventType.TEXT_MESSAGE_CHUNK, role: 'assistant' })
    expect(out[0].delta).toMatch(/Not logged in/)
  })

  it('emits args from content_block_start.input when no input_json_delta arrives', async () => {
    const start = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'tc1',
          name: 'mcp__inbox__renderLead',
          input: { id: 42 },
        },
      },
    })
    const out = await collect([start, blockStop(0)], ['confirmSend'])
    expect(out.map((e) => e.type)).toEqual([
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
    ])
    expect(out[1]).toMatchObject({ toolCallId: 'tc1', delta: '{"id":42}' })
  })
})
