import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineAgent, defineWorkflow } from '@platform/core'
import { resolveDelivery } from './deliver'

const mk = (id: string, role: 'input' | 'worker', handoffs: string[] = []) => ({
  agent: defineAgent({
    id,
    name: id,
    provider: 'mock',
    instructions: 'x',
    tools: ['t'],
    approvals: [],
    renders: {},
    handoffs,
  }),
  role,
})
const A = defineWorkflow({
  id: 'a',
  label: 'A',
  iconName: 'inbox',
  agents: [mk('q', 'input', ['r']), mk('r', 'worker')],
  entryAgentId: 'q',
  inputs: [],
})
const B = defineWorkflow({
  id: 'b',
  label: 'B',
  iconName: 'git',
  agents: [mk('in', 'input')],
  entryAgentId: 'in',
  inputs: [{ name: 'lead', schema: z.object({ x: z.string() }), agentId: 'in' }],
})
const wfs = [A, B]

describe('resolveDelivery', () => {
  it('resolves an intra-workflow agent destination to an instance id', () => {
    const r = resolveDelivery(wfs, 'a', { kind: 'agent', agentId: 'r' }, { any: 1 })
    expect(r).toEqual({ ok: true, instanceId: 'a__r' })
  })
  it('resolves a valid cross-workflow contract to the bound input instance', () => {
    const r = resolveDelivery(
      wfs,
      'a',
      { kind: 'contract', workflow: 'b', input: 'lead' },
      { x: 'hi' }
    )
    expect(r).toEqual({ ok: true, instanceId: 'b__in', targetWorkflow: 'b' })
  })
  it('rejects an unknown contract input name', () => {
    const r = resolveDelivery(
      wfs,
      'a',
      { kind: 'contract', workflow: 'b', input: 'nope' },
      { x: 'hi' }
    )
    expect(r.ok).toBe(false)
  })
  it('rejects a payload that fails the contract schema', () => {
    const r = resolveDelivery(
      wfs,
      'a',
      { kind: 'contract', workflow: 'b', input: 'lead' },
      { x: 123 }
    )
    expect(r.ok).toBe(false)
  })
})
