import { describe, it, expect } from 'vitest'
import type { MastraChunk } from '@atizar/providers'
import { unwrapStepOutput, makeMastraRunner } from './runner.js'

const baseConfig = {
  agentId: 'wf__agent',
  instructions: 'do the thing',
  approvalNames: [] as string[],
  readTools: [] as string[],
  renderAndProposeTools: [] as string[],
  model: 'claude-sonnet-4-6',
  databaseUrl: 'postgres://unused',
  prompts: { buildFirst: () => 'PROMPT', buildResume: () => null },
}

describe('makeMastraRunner tool resolution', () => {
  it('throws a clear error when an allow-listed tool is not registered in ALL_TOOLS', () => {
    // The tools map is built before any Mastra/DB construction, so this throws synchronously
    // without touching Postgres.
    expect(() => makeMastraRunner({ ...baseConfig, readTools: ['nonexistent'] })).toThrow(
      /Mastra has no tool "nonexistent"/
    )
  })
})

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
