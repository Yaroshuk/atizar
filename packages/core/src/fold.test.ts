import { describe, expect, it } from 'vitest'
import { EventType, type BaseEvent } from '@ag-ui/client'
import { gateOpened } from './gate.js'
import { foldEventsToMessages } from './fold.js'
import { isAssistant, isToolMessage, pairToolResults } from './messages.js'

const text = (messageId: string, delta: string): BaseEvent =>
  ({ type: EventType.TEXT_MESSAGE_CHUNK, role: 'assistant', messageId, delta }) as BaseEvent
const tcStart = (parentMessageId: string, toolCallId: string, toolCallName: string): BaseEvent =>
  ({ type: EventType.TOOL_CALL_START, parentMessageId, toolCallId, toolCallName }) as BaseEvent
const tcArgs = (toolCallId: string, delta: string): BaseEvent =>
  ({ type: EventType.TOOL_CALL_ARGS, toolCallId, delta }) as BaseEvent
const tcEnd = (toolCallId: string): BaseEvent =>
  ({ type: EventType.TOOL_CALL_END, toolCallId }) as BaseEvent
const tcResult = (messageId: string, toolCallId: string, content: string): BaseEvent =>
  ({ type: EventType.TOOL_CALL_RESULT, messageId, toolCallId, content, role: 'tool' }) as BaseEvent

describe('foldEventsToMessages', () => {
  it('returns no messages for an empty event list', () => {
    expect(foldEventsToMessages([])).toEqual([])
  })

  it('concatenates contiguous text deltas that share one messageId into ONE bubble', () => {
    const msgs = foldEventsToMessages([text('m1', 'Draf'), text('m1', 'ted a reply')])
    expect(msgs).toHaveLength(1)
    expect(isAssistant(msgs[0])).toBe(true)
    expect(msgs[0].content).toBe('Drafted a reply')
  })

  it('splits text deltas with different messageIds into separate bubbles, in order', () => {
    const msgs = foldEventsToMessages([text('m1', 'first'), text('m2', 'second')])
    expect(msgs.map((m) => m.content)).toEqual(['first', 'second'])
  })

  it('builds an assistant tool call with accumulated arguments', () => {
    const msgs = foldEventsToMessages([
      tcStart('p1', 'call_1', 'renderVerdict'),
      tcArgs('call_1', '{"category":'),
      tcArgs('call_1', '"sales"}'),
      tcEnd('call_1'),
    ])
    expect(msgs).toHaveLength(1)
    const m = msgs[0]
    if (!isAssistant(m) || !m.toolCalls)
      throw new Error('expected an assistant message with tool calls')
    expect(m.toolCalls).toHaveLength(1)
    expect(m.toolCalls[0].id).toBe('call_1')
    expect(m.toolCalls[0].function.name).toBe('renderVerdict')
    expect(JSON.parse(m.toolCalls[0].function.arguments)).toEqual({ category: 'sales' })
  })

  it('pairs a tool result with its call via pairToolResults (AgentModal logic)', () => {
    const msgs = foldEventsToMessages([
      tcStart('p1', 'call_1', 'get_latest_email'),
      tcArgs('call_1', '{}'),
      tcEnd('call_1'),
      tcResult('r1', 'call_1', '{"subject":"hi"}'),
    ])
    expect(msgs.find(isToolMessage)).toBeTruthy()
    expect(pairToolResults(msgs).get('call_1')?.content).toBe('{"subject":"hi"}')
  })

  it('preserves chronological order across text, tool call, and result', () => {
    const msgs = foldEventsToMessages([
      text('m1', 'Checking inbox'),
      tcStart('p1', 'call_1', 'get_latest_email'),
      tcEnd('call_1'),
      tcResult('r1', 'call_1', 'email body'),
      text('m2', 'Found a lead'),
    ])
    expect(msgs.map((m) => m.role)).toEqual(['assistant', 'assistant', 'tool', 'assistant'])
  })

  it('ignores GATE_OPENED (a signal, not a message)', () => {
    const msgs = foldEventsToMessages([
      tcStart('p1', 'call_1', 'saveDraft'),
      tcArgs('call_1', '{"body":"hi"}'),
      tcEnd('call_1'),
      gateOpened({
        gateKind: 'approval',
        toolName: 'saveDraft',
        toolCallId: 'call_1',
        proposedArtifact: { body: 'hi' },
      }),
    ])
    expect(msgs).toHaveLength(1)
    expect(isAssistant(msgs[0])).toBe(true)
  })

  it('is incremental: folding a prefix matches the full fold on the common prefix', () => {
    const events = [
      text('m1', 'Hello '),
      text('m1', 'world'),
      tcStart('p1', 'call_1', 'renderVerdict'),
      tcArgs('call_1', '{"ok":true}'),
      tcEnd('call_1'),
    ]
    expect(foldEventsToMessages(events.slice(0, 2))).toHaveLength(1)
    expect(foldEventsToMessages(events)).toHaveLength(2)
  })
})
