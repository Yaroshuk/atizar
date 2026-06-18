import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import type { RunAgentInput } from '@ag-ui/client'
import { definePrompt } from './definePrompt.js'
import { encodeHandoff } from './handoff.js'

const Schema = z.object({ email: z.object({ from: z.string() }) })
const base = { threadId: 't', runId: 'r', state: {}, tools: [], context: [], forwardedProps: {} }
const inputWith = (p: unknown): RunAgentInput =>
  ({ ...base, messages: [encodeHandoff(p)] }) as RunAgentInput
const emptyInput = { ...base, messages: [] } as RunAgentInput

describe('definePrompt', () => {
  it('renders onInput when a matching payload decodes', () => {
    const p = definePrompt({
      input: Schema,
      onInput: ({ email }) => `to ${email.from}`,
      onStart: () => 'start',
    })
    expect(p.buildFirst(inputWith({ email: { from: 'jane@acme.com' } }))).toBe('to jane@acme.com')
  })
  it('falls back to onStart when no payload decodes', () => {
    const p = definePrompt({
      input: Schema,
      onInput: ({ email }) => `to ${email.from}`,
      onStart: () => 'start',
    })
    expect(p.buildFirst(emptyInput)).toBe('start')
  })
  it('input agent (no schema) always renders onStart', () => {
    const p = definePrompt({ onStart: () => 'read the inbox' })
    expect(p.buildFirst(emptyInput)).toBe('read the inbox')
  })
  it('buildResume wraps onResume into a prompt-mode ResumeOutcome', () => {
    const p = definePrompt({
      onStart: () => 's',
      onResume: ({ draftId }) => ({ kind: 'prompt', text: `saved ${draftId}` }),
    })
    expect(p.buildResume?.({}, { draftId: 'd1' })).toEqual({ kind: 'prompt', text: 'saved d1' })
  })

  it('onResume may return message mode (server-appended, no model spawn)', () => {
    const p = definePrompt({
      onStart: () => 's',
      onResume: () => ({ kind: 'message', text: 'Draft saved' }),
    })
    expect(p.buildResume?.({}, {})).toEqual({ kind: 'message', text: 'Draft saved' })
  })

  it('onResume may return null (silent settle)', () => {
    const p = definePrompt({ onStart: () => 's', onResume: () => null })
    expect(p.buildResume?.({}, {})).toBeNull()
  })

  it('no onResume → buildResume is undefined', () => {
    const p = definePrompt({ onStart: () => 's' })
    expect(p.buildResume).toBeUndefined()
  })
})

describe('definePrompt onAnswer', () => {
  it('wires onAnswer into buildResumeFromAnswer', () => {
    const strat = definePrompt({
      onStart: () => 'start',
      onAnswer: (answers) => ({ kind: 'prompt', text: `got ${answers.length} answers` }),
    })
    expect(strat.buildResumeFromAnswer).toBeDefined()
    expect(strat.buildResumeFromAnswer!([{ target: {}, answer: { a: 1 }, ok: true }])).toEqual({
      kind: 'prompt',
      text: 'got 1 answers',
    })
  })

  it('leaves buildResumeFromAnswer undefined when onAnswer is omitted', () => {
    expect(definePrompt({ onStart: () => 'start' }).buildResumeFromAnswer).toBeUndefined()
  })
})
