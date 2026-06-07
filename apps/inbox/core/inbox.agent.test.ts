import { describe, it, expect } from 'vitest'
import { qualifierAgent, replyAgent, agents } from './inbox.agent.js'
import { defineProviders } from './providers.js'
import { createMockInboxProvider } from './mock-provider.js'

describe('inbox agents wiring', () => {
  it('reply passport validates and references the claude-cli provider', () => {
    expect(replyAgent.id).toBe('reply')
    expect(replyAgent.provider).toBe('claude-cli')
    expect(replyAgent.approvals).toEqual(['saveDraft'])
  })

  it('qualifier passport classifies with no approval and hands off to reply', () => {
    expect(qualifierAgent.id).toBe('qualifier')
    expect(qualifierAgent.approvals).toEqual([])
    expect(qualifierAgent.tools).toEqual(['renderVerdict'])
    expect(qualifierAgent.handoffs).toEqual(['reply'])
  })

  it('every handoff target is a known agent id', () => {
    const ids = new Set(agents.map((a) => a.id))
    for (const a of agents) for (const t of a.handoffs ?? []) expect(ids.has(t)).toBe(true)
  })

  it('a registry of factories resolves a runnable provider', () => {
    const reg = defineProviders({ mock: (cfg) => createMockInboxProvider(cfg.approvalNames) })
    const provider = reg.resolve('mock')({
      approvalNames: [],
      surfaceTools: [],
      prompts: { buildFirst: () => '' },
    })
    expect(typeof provider.run).toBe('function')
  })
})
