import { describe, it, expect } from 'vitest'
import {
  isAssistant,
  isToolMessage,
  toolCallsOf,
  hasPendingApproval,
  approvalResolved,
  pairToolResults,
  lastApprovalArgs,
  type Message,
} from './messages.js'

// Fixture builders — minimal valid AG-UI messages.
function assistantWithToolCall(name: string, id = 'tc1'): Message {
  return {
    role: 'assistant',
    id: 'a1',
    toolCalls: [{ id, type: 'function', function: { name, arguments: '{}' } }],
  }
}
function assistantText(content: string): Message {
  return { role: 'assistant', id: 'a1', content }
}
function toolResult(toolCallId: string): Message {
  return { role: 'tool', id: 't1', content: 'ok', toolCallId }
}

describe('hasPendingApproval', () => {
  const APPROVALS = ['confirmSend']

  it('false when there are no tool calls', () => {
    expect(hasPendingApproval([assistantText('hi')], APPROVALS)).toBe(false)
  })

  it('true when an approval tool call has no matching tool result', () => {
    const msgs = [assistantWithToolCall('confirmSend', 'x1')]
    expect(hasPendingApproval(msgs, APPROVALS)).toBe(true)
  })

  it('false when the approval tool call has been answered', () => {
    const msgs = [assistantWithToolCall('confirmSend', 'x1'), toolResult('x1')]
    expect(hasPendingApproval(msgs, APPROVALS)).toBe(false)
  })

  it('ignores non-approval tool calls', () => {
    const msgs = [assistantWithToolCall('renderLead', 'x1')]
    expect(hasPendingApproval(msgs, APPROVALS)).toBe(false)
  })

  it('true when one of several approvals is unanswered', () => {
    const msgs = [
      assistantWithToolCall('confirmSend', 'x1'),
      toolResult('x1'),
      assistantWithToolCall('confirmDelete', 'x2'),
    ]
    expect(hasPendingApproval(msgs, ['confirmSend', 'confirmDelete'])).toBe(true)
  })
})

describe('approvalResolved', () => {
  const APPROVALS = ['confirmSend']

  it('false on turn 1 (approval requested, not answered)', () => {
    const msgs = [assistantWithToolCall('confirmSend', 'x1')]
    expect(approvalResolved(msgs, APPROVALS)).toBe(false)
  })

  it('true on resume (a tool result answers the approval call)', () => {
    const msgs = [assistantWithToolCall('confirmSend', 'x1'), toolResult('x1')]
    expect(approvalResolved(msgs, APPROVALS)).toBe(true)
  })

  it('false when a tool result answers a non-approval call', () => {
    const msgs = [assistantWithToolCall('renderLead', 'x1'), toolResult('x1')]
    expect(approvalResolved(msgs, APPROVALS)).toBe(false)
  })
})

describe('pairToolResults', () => {
  it('indexes tool results by toolCallId', () => {
    const msgs = [assistantWithToolCall('confirmSend', 'x1'), toolResult('x1')]
    const map = pairToolResults(msgs)
    expect(map.get('x1')?.role).toBe('tool')
    expect(map.size).toBe(1)
  })

  it('has no entry for an unanswered tool call', () => {
    const map = pairToolResults([assistantWithToolCall('confirmSend', 'x1')])
    expect(map.get('x1')).toBeUndefined()
    expect(map.size).toBe(0)
  })
})

describe('guards', () => {
  it('isAssistant narrows assistant messages', () => {
    expect(isAssistant(assistantText('hi'))).toBe(true)
    expect(isAssistant(toolResult('tc1'))).toBe(false)
  })

  it('isToolMessage narrows tool messages', () => {
    expect(isToolMessage(toolResult('tc1'))).toBe(true)
    expect(isToolMessage(assistantText('hi'))).toBe(false)
  })

  it('toolCallsOf returns the tool calls of an assistant message, else []', () => {
    expect(toolCallsOf(assistantWithToolCall('confirmSend'))).toHaveLength(1)
    expect(toolCallsOf(assistantText('hi'))).toEqual([])
    expect(toolCallsOf(toolResult('tc1'))).toEqual([])
  })
})

describe('lastApprovalArgs', () => {
  const APPROVALS = ['saveDraft']

  function assistantWithArgs(name: string, args: string, id = 'tc1'): Message {
    return {
      role: 'assistant',
      id: 'a1',
      toolCalls: [{ id, type: 'function', function: { name, arguments: args } }],
    }
  }

  it('returns parsed args of the most recent matching approval tool call', () => {
    const msgs = [assistantWithArgs('saveDraft', '{"threadId":"t_9","body":"Hello"}')]
    expect(lastApprovalArgs(msgs, APPROVALS)).toEqual({ threadId: 't_9', body: 'Hello' })
  })

  it('returns null when no matching approval tool call exists', () => {
    const msgs = [assistantWithToolCall('renderLead')]
    expect(lastApprovalArgs(msgs, APPROVALS)).toBeNull()
  })

  it('returns null when the args are not valid JSON', () => {
    const msgs = [assistantWithArgs('saveDraft', '{bad')]
    expect(lastApprovalArgs(msgs, APPROVALS)).toBeNull()
  })
})
