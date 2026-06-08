import { describe, it, expect } from 'vitest'
import { statusFrom } from './statusFrom'
import type { Message } from '@platform/core'

const approvalMsg: Message = {
  id: '1',
  role: 'assistant',
  content: '',
  toolCalls: [{ id: 't1', type: 'function', function: { name: 'saveDraft', arguments: '{}' } }],
} as Message

describe('statusFrom', () => {
  it('returns the lifecycle when no approval pending', () => {
    expect(statusFrom('running', [], ['saveDraft'])).toBe('running')
    expect(statusFrom('done', [], ['saveDraft'])).toBe('done')
  })
  it('returns awaiting_approval when an approval tool call is pending', () => {
    expect(statusFrom('running', [approvalMsg], ['saveDraft'])).toBe('awaiting_approval')
  })
  it('error wins over a pending approval', () => {
    expect(statusFrom('error', [approvalMsg], ['saveDraft'])).toBe('error')
  })
})
