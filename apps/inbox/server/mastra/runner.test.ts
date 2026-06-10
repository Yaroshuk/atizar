import { describe, it, expect } from 'vitest'
import type { MastraChunk } from '@platform/providers'
import { unwrapStepOutput } from './runner.js'

describe('unwrapStepOutput', () => {
  it('unwraps a workflow-step-output envelope to its payload.output', () => {
    const inner: MastraChunk = { type: 'text-delta', payload: { text: 'hello' } }
    const wrapped = {
      type: 'workflow-step-output',
      payload: { output: inner },
    } as unknown as MastraChunk
    expect(unwrapStepOutput(wrapped)).toBe(inner)
  })

  it('passes through non-envelope chunks unchanged', () => {
    const chunk: MastraChunk = {
      type: 'tool-call',
      payload: { toolName: 'renderLead', toolCallId: 'tc1', args: {} },
    }
    expect(unwrapStepOutput(chunk)).toBe(chunk)
  })

  it('passes through workflow-start / workflow-finish unchanged (no output field)', () => {
    const chunk = { type: 'workflow-start' } as unknown as MastraChunk
    expect(unwrapStepOutput(chunk)).toBe(chunk)
  })

  it('falls back to the raw chunk when payload.output is missing', () => {
    const chunk = { type: 'workflow-step-output', payload: {} } as unknown as MastraChunk
    expect(unwrapStepOutput(chunk)).toBe(chunk)
  })
})
