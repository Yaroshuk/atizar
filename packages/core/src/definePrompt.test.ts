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
  it('buildResume passes the server effect result', () => {
    const p = definePrompt({ onStart: () => 's', onResume: ({ draftId }) => `saved ${draftId}` })
    expect(p.buildResume?.({}, { draftId: 'd1' })).toBe('saved d1')
  })
  it('no onResume → buildResume is undefined', () => {
    const p = definePrompt({ onStart: () => 's' })
    expect(p.buildResume).toBeUndefined()
  })
})
