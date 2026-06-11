// @vitest-environment node
import { describe, it, expect } from 'vitest'
import type { RunAgentInput } from '@ag-ui/client'
import { encodeHandoff } from '@platform/core'
import { createSorterPrompts, createReplyPrompts, createBatchPrompts } from './prompts.js'

const inputWith = (payload: unknown): RunAgentInput =>
  ({
    messages: payload ? [encodeHandoff(payload)] : [],
    threadId: 't',
    runId: 'r',
    state: {},
    tools: [],
    context: [],
    forwardedProps: {},
  }) as RunAgentInput

describe('email-inbox prompts', () => {
  it('sorter instructs list_unread → route_emails → renderSort', () => {
    const p = createSorterPrompts('SORTER INSTR')
    const t = p.buildFirst(inputWith(null))
    expect(t).toContain('SORTER INSTR')
    expect(t).toMatch(/list_unread/)
    expect(t).toMatch(/route_emails/)
    expect(t).toMatch(/renderSort/)
  })

  it('reply decodes the handed email and instructs get_email → renderLead → saveDraft', () => {
    const p = createReplyPrompts('REPLY INSTR')
    const email = {
      messageId: 'm1',
      threadId: 't1',
      from: 'a@b.c',
      subject: 'Hi',
      date: 'd',
      snippet: 'sn',
    }
    const t = p.buildFirst(inputWith({ email }))
    expect(t).toMatch(/get_email/)
    expect(t).toMatch(/m1/)
    expect(t).toMatch(/saveDraft/)
    const resume = p.buildResume!({ threadId: 't1', body: 'x' }, { draftId: 'd-9' })
    expect(resume).toMatch(/d-9|saved/i)
  })

  it('batch defaults each row to the agent default action and proposes applyActions', () => {
    const p = createBatchPrompts('READER INSTR', 'read')
    const emails = [
      { messageId: 'm1', threadId: 't1', from: 'a', subject: 's', date: 'd', snippet: 'x' },
    ]
    const t = p.buildFirst(inputWith({ emails }))
    expect(t).toMatch(/applyActions/)
    expect(t).toMatch(/read/)
    const resume = p.buildResume!({ items: [] }, { applied: 3, failed: [], byAction: { read: 3 } })
    expect(resume).toMatch(/3/)
  })
})
