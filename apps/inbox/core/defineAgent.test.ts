import { describe, it, expect } from 'vitest'
import { defineAgent } from './defineAgent.js'

const valid = {
  id: 'inbox',
  name: 'EMAIL AGENT',
  provider: 'mock',
  instructions: 'Process inbound leads.',
  tools: ['renderLead', 'confirmSend'],
  approvals: ['confirmSend'],
  renders: { renderLead: 'LeadCard', confirmSend: 'ApprovalDialog' },
}

describe('defineAgent', () => {
  it('returns the parsed definition for a valid passport', () => {
    const def = defineAgent(valid)
    expect(def.name).toBe('EMAIL AGENT')
    expect(def.approvals).toEqual(['confirmSend'])
  })

  it('rejects an approval that is not in tools', () => {
    expect(() => defineAgent({ ...valid, approvals: ['sendNow'] })).toThrow()
  })

  it('rejects a render key that is not in tools', () => {
    expect(() => defineAgent({ ...valid, renders: { ghostTool: 'LeadCard' } })).toThrow()
  })
})
