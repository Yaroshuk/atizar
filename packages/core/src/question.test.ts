import { describe, it, expect } from 'vitest'
import { EventType } from '@ag-ui/client'
import { agentQuestion, readAgentQuestion, AGENT_QUESTION } from './question.js'

describe('agent question signal', () => {
  const value = {
    questions: [{ toolCallId: 'tc1', target: { agentId: 'answerer' }, payload: { q: 'how?' } }],
  }

  it('round-trips a question value through the CUSTOM envelope', () => {
    const ev = agentQuestion(value)
    expect(ev.type).toBe(EventType.CUSTOM)
    expect(ev.name).toBe(AGENT_QUESTION)
    expect(readAgentQuestion(ev)).toEqual(value)
  })

  it('returns null for a non-question event', () => {
    expect(readAgentQuestion({ type: EventType.TEXT_MESSAGE_CHUNK } as never)).toBeNull()
  })

  it('returns null for a malformed question payload', () => {
    const bad = { type: EventType.CUSTOM, name: AGENT_QUESTION, value: { questions: 'nope' } }
    expect(readAgentQuestion(bad as never)).toBeNull()
  })
})
