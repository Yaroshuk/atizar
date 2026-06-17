// @vitest-environment node
import { describe, it, expect } from 'vitest'
import type { RunAgentInput } from '@ag-ui/client'
import { encodeHandoff } from '@atizar/core'
import { sorterPrompt, replyPrompt, readerPrompt } from './prompts.js'
import { EMAIL_INBOX_TOOLS as t } from './tools.js'

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

const sampleEmail = {
  messageId: 'm_1',
  threadId: 't_1',
  from: 'ivan@acme.ru',
  subject: 'Order question',
}
const sampleBatch = {
  emails: [
    { messageId: 'm_a', threadId: 't_a', from: 'news@x.com', subject: 'Weekly digest' },
    { messageId: 'm_b', threadId: 't_b', from: 'noreply@y.com', subject: 'Receipt' },
  ],
}

// Turn-only prose must NOT re-bake the composed agent identity (now provider-prepended). We assert
// on phrases the OLD identity preamble carried (agent names + the workflow-level rule sentence).
const IDENTITY_FRAGMENTS = ['EMAIL SORTER', 'REPLY AGENT', 'email-inbox automation']
const expectTurnOnly = (prose: string) => {
  for (const frag of IDENTITY_FRAGMENTS) expect(prose).not.toContain(frag)
}

describe('sorter prompt strategy', () => {
  it('onStart is turn-only and routes tool names through consts', () => {
    const p = sorterPrompt.buildFirst(inputWith(null))
    expectTurnOnly(p)
    expect(p).toContain(t.list_unread)
    expect(p).toContain(t.route_emails)
    expect(p).toContain(t.renderSort)
  })

  it('has no buildResume (the sorter never approves)', () => {
    expect(sorterPrompt.buildResume).toBeUndefined()
  })
})

describe('reply prompt strategy', () => {
  it('onInput uses the email payload and the reply tool consts; turn-only', () => {
    const p = replyPrompt.buildFirst(inputWith({ email: sampleEmail }))
    expectTurnOnly(p)
    expect(p).toContain(sampleEmail.messageId)
    expect(p).toContain(sampleEmail.threadId)
    expect(p).toContain(sampleEmail.from)
    expect(p).toContain(t.get_email)
    expect(p).toContain(t.renderLead)
    expect(p).toContain(t.saveDraft)
  })

  it('onStart (no handoff) points back to the sorter and calls no read tool', () => {
    const p = replyPrompt.buildFirst(inputWith(null))
    expectTurnOnly(p)
    expect(p).not.toContain(t.get_email)
    expect(p).toMatch(/sorter/i)
  })

  it('onResume returns prompt-mode ResumeOutcome with draft confirmation text', () => {
    const outcome = replyPrompt.buildResume?.({ threadId: 't', body: 'hi' }, { draftId: 'd-42' })
    expect(outcome).not.toBeNull()
    expect(outcome).toMatchObject({ kind: 'prompt' })
    const text = (outcome as { kind: 'prompt'; text: string }).text
    expect(text).toMatch(/already (created|saved)/i)
    expect(text).toContain('d-42')
    expectTurnOnly(text)
  })

  it('onResume falls back to "saved" when no draftId', () => {
    const outcome = replyPrompt.buildResume?.({})
    expect(outcome).toMatchObject({ kind: 'prompt' })
    const text = (outcome as { kind: 'prompt'; text: string }).text
    expect(text).toMatch(/already (created|saved)/i)
  })
})

describe('batch prompt strategy (reader)', () => {
  it('onInput uses the batch payload and the applyActions const; turn-only', () => {
    const p = readerPrompt.buildFirst(inputWith(sampleBatch))
    expectTurnOnly(p)
    expect(p).toContain(t.applyActions)
    expect(p).toContain(sampleBatch.emails[0].messageId)
    expect(p).toContain('read') // reader's default action
  })

  it('onStart (no handoff) points back to the sorter', () => {
    const p = readerPrompt.buildFirst(inputWith(null))
    expectTurnOnly(p)
    expect(p).toMatch(/sorter/i)
  })

  it('onResume returns prompt-mode ResumeOutcome with applied-actions confirmation text', () => {
    const outcome = readerPrompt.buildResume?.({}, { applied: 2, failed: [] })
    expect(outcome).not.toBeNull()
    expect(outcome).toMatchObject({ kind: 'prompt' })
    const text = (outcome as { kind: 'prompt'; text: string }).text
    expect(text).toMatch(/already applied/i)
    expect(text).toContain('2')
  })
})
