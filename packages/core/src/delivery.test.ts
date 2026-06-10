import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineAgent, defineWorkflow } from './index.js'
import { resolveDelivery, deliveryKey } from './delivery.js'

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
    const r = resolveDelivery(wfs, 'a', { kind: 'contract', workflow: 'b', input: 'lead' }, { x: 123 })
    expect(r.ok).toBe(false)
  })
})

describe('deliveryKey', () => {
  it('keys an email parcel by its threadId', () => {
    expect(deliveryKey({ threadId: 'abc', from: 'a@b.com', subject: 'Hi' })).toBe('thread:abc')
  })
  it('keys a ticket parcel by its issue number', () => {
    expect(deliveryKey({ number: 42, title: 'Bug' })).toBe('number:42')
  })
  it('prefers threadId over number when both are present', () => {
    expect(deliveryKey({ threadId: 'abc', number: 42 })).toBe('thread:abc')
  })
  it('falls back to from+subject when there is no id', () => {
    expect(deliveryKey({ from: 'a@b.com', subject: 'Hello' })).toBe('email:a@b.com|Hello')
  })
  it('returns undefined when the payload has no usable identity', () => {
    expect(deliveryKey({ summary: 'no id here' })).toBeUndefined()
    expect(deliveryKey(null)).toBeUndefined()
    expect(deliveryKey('nope')).toBeUndefined()
  })
})
