// packages/core/src/defineWorkflow.test.ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineAgent } from './defineAgent.js'
import { defineWorkflow, instanceId } from './defineWorkflow.js'

const reader = defineAgent({
  id: 'reader',
  name: 'Reader',
  provider: 'mock',
  instructions: 'x',
  tools: ['t'],
  approvals: [],
  renders: {},
})
const worker = defineAgent({
  id: 'worker',
  name: 'Worker',
  provider: 'mock',
  instructions: 'x',
  tools: ['t'],
  approvals: [],
  renders: {},
  handoffs: [],
})

const base = {
  id: 'wf',
  label: 'WF',
  iconName: 'inbox',
  agents: [
    { agent: reader, role: 'input' as const },
    { agent: worker, role: 'worker' as const },
  ],
  entryAgentId: 'reader',
  inputs: [{ name: 'lead', schema: z.object({ x: z.string() }), agentId: 'reader' }],
}

describe('instanceId', () => {
  it('namespaces an agent by workflow', () => {
    expect(instanceId('wf', 'reader')).toBe('wf__reader')
  })
})

describe('defineWorkflow', () => {
  it('accepts a valid descriptor', () => {
    expect(defineWorkflow(base).id).toBe('wf')
  })
  it('rejects an entryAgentId that is not a role:input agent', () => {
    expect(() => defineWorkflow({ ...base, entryAgentId: 'worker' })).toThrow(/entry/i)
  })
  it('rejects an input bound to a non-input agent', () => {
    expect(() =>
      defineWorkflow({
        ...base,
        inputs: [{ name: 'lead', schema: z.object({}), agentId: 'worker' }],
      })
    ).toThrow(/input "lead"/i)
  })
  it('rejects duplicate published input names', () => {
    const dup = { name: 'lead', schema: z.object({}), agentId: 'reader' }
    expect(() => defineWorkflow({ ...base, inputs: [dup, dup] })).toThrow(/duplicate/i)
  })
  it('rejects a handoff that leaves the workflow', () => {
    const stray = defineAgent({
      id: 'reader',
      name: 'R',
      provider: 'mock',
      instructions: 'x',
      tools: ['t'],
      approvals: [],
      renders: {},
      handoffs: ['nope'],
    })
    expect(() =>
      defineWorkflow({
        ...base,
        agents: [
          { agent: stray, role: 'input' as const },
          { agent: worker, role: 'worker' as const },
        ],
      })
    ).toThrow(/hands off to "nope"/i)
  })
  it('rejects duplicate agent ids', () => {
    expect(() =>
      defineWorkflow({
        ...base,
        agents: [
          { agent: reader, role: 'input' },
          { agent: reader, role: 'input' },
        ],
      })
    ).toThrow(/duplicate agent/i)
  })
  it('passes prompt through unchanged', () => {
    expect(defineWorkflow({ ...base, prompt: 'shared context' }).prompt).toBe('shared context')
  })
  it('passes through when prompt is absent (no-op for existing workflows)', () => {
    expect(defineWorkflow(base).prompt).toBeUndefined()
  })
  it('round-trips a declared connections list', () => {
    const wf = defineWorkflow({
      ...base,
      connections: [{ integration: 'gmail', provider: 'google' }],
    })
    expect(wf.connections).toEqual([{ integration: 'gmail', provider: 'google' }])
  })
  it('leaves connections undefined when none are declared', () => {
    expect(defineWorkflow(base).connections).toBeUndefined()
  })
  it('round-trips the rerun knob', () => {
    expect(defineWorkflow({ ...base, rerun: 'refresh' }).rerun).toBe('refresh')
    expect(defineWorkflow({ ...base, rerun: 'history' }).rerun).toBe('history')
  })
  it('leaves rerun undefined when not declared (defaults to refresh at the call site)', () => {
    expect(defineWorkflow(base).rerun).toBeUndefined()
  })
})
