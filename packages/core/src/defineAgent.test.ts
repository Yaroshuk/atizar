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

describe('effects + readonly', () => {
  it('accepts effects that are a subset of approvals', () => {
    const def = defineAgent({
      id: 'reply',
      name: 'REPLY',
      provider: 'claude-cli',
      instructions: 'x',
      tools: ['renderLead', 'saveDraft'],
      approvals: ['saveDraft'],
      effects: ['saveDraft'],
      readonly: [],
      renders: { renderLead: 'LeadCard', saveDraft: 'ApprovalDialog' },
    })
    expect(def.effects).toEqual(['saveDraft'])
    expect(def.readonly).toEqual([])
  })

  it('rejects an effect that is not an approval', () => {
    expect(() =>
      defineAgent({
        id: 'reply',
        name: 'REPLY',
        provider: 'claude-cli',
        instructions: 'x',
        tools: ['renderLead', 'saveDraft'],
        approvals: ['saveDraft'],
        effects: ['renderLead'], // not an approval
        renders: {},
      })
    ).toThrow(/effect .*renderLead.* is not an approval/)
  })

  it('defaults effects and readonly to empty arrays', () => {
    const def = defineAgent({
      id: 'q',
      name: 'Q',
      provider: 'claude-cli',
      instructions: 'x',
      tools: [],
      approvals: [],
      renders: {},
    })
    expect(def.effects).toEqual([])
    expect(def.readonly).toEqual([])
  })
})

describe('dispatches', () => {
  it('accepts dispatches as a subset of tools', () => {
    const def = defineAgent({
      id: 'sorter',
      name: 'Sorter',
      provider: 'claude-cli',
      instructions: 'x',
      tools: ['route_emails'],
      approvals: [],
      renders: {},
      dispatches: ['route_emails'],
      handoffs: ['reply'],
    })
    expect(def.dispatches).toEqual(['route_emails'])
  })

  it('rejects a dispatch tool not declared in tools', () => {
    expect(() =>
      defineAgent({
        id: 'sorter',
        name: 'Sorter',
        provider: 'claude-cli',
        instructions: 'x',
        tools: [],
        approvals: [],
        renders: {},
        dispatches: ['route_emails'],
      })
    ).toThrow(/dispatch .*route_emails.* is not declared in tools/)
  })

  it('defaults dispatches to an empty array', () => {
    const def = defineAgent({
      id: 'a',
      name: 'A',
      provider: 'claude-cli',
      instructions: 'x',
      tools: [],
      approvals: [],
      renders: {},
    })
    expect(def.dispatches).toEqual([])
  })
})

describe('maxInstances', () => {
  it('defaults to 1 when omitted', () => {
    expect(defineAgent({ ...base }).maxInstances).toBe(1)
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
