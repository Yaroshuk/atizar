import { describe, it, expect } from 'vitest'
import { qualifierAgent, replyAgent, leadInboxAgents } from '../workflows/lead-inbox/descriptor.js'
import { defineProviders } from '@platform/core'
import { createMockInboxProvider } from '@platform/providers'

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
    const ids = new Set(leadInboxAgents.map((a) => a.id))
    for (const a of leadInboxAgents) for (const t of a.handoffs ?? []) expect(ids.has(t)).toBe(true)
  })

  it('a registry of factories resolves a runnable provider', () => {
    const reg = defineProviders({ mock: (cfg) => createMockInboxProvider(cfg.approvalNames) })
    const provider = reg.resolve('mock')({
      approvalNames: [],
      surfaceTools: [],
      allowedTools: [],
      prompts: { buildFirst: () => '' },
    })
    expect(typeof provider.run).toBe('function')
  })
})
