import { describe, it, expect } from 'vitest'
import { defineAgent } from './defineAgent.js'

const valid = {
  id: 'inbox',
  name: 'EMAIL AGENT',
  provider: 'mock',
  instructions: 'Process inbound leads.',
  tools: ['renderLead', 'saveDraft'],
  approvals: ['saveDraft'],
  renders: { renderLead: 'LeadCard', saveDraft: 'ApprovalDialog' },
}

describe('defineAgent', () => {
  it('returns the parsed definition for a valid passport', () => {
    const def = defineAgent(valid)
    expect(def.name).toBe('EMAIL AGENT')
    expect(def.approvals).toEqual(['saveDraft'])
  })

  it('rejects an approval that is not in tools', () => {
    expect(() => defineAgent({ ...valid, approvals: ['sendNow'] })).toThrow()
  })

  it('rejects a render key that is not in tools', () => {
    expect(() => defineAgent({ ...valid, renders: { ghostTool: 'LeadCard' } })).toThrow()
  })

  it('accepts an optional handoffs array', () => {
    const def = defineAgent({ ...valid, handoffs: ['other'] })
    expect(def.handoffs).toEqual(['other'])
  })
})

const base = {
  id: 'x',
  name: 'X',
  provider: 'mock',
  instructions: '',
  tools: [],
  approvals: [],
  renders: {},
}

describe('maxInstances', () => {
  it('defaults to 2 when omitted', () => {
    expect(defineAgent({ ...base }).maxInstances).toBe(2)
  })
  it('keeps an explicit override', () => {
    expect(defineAgent({ ...base, maxInstances: 1 }).maxInstances).toBe(1)
  })
  it('rejects a non-positive cap', () => {
    expect(() => defineAgent({ ...base, maxInstances: 0 })).toThrow()
  })
  it('rejects a non-integer cap', () => {
    expect(() => defineAgent({ ...base, maxInstances: 1.5 })).toThrow()
  })
})
