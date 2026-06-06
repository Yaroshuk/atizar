import { describe, it, expect } from 'vitest'
import { inboxAgent } from './inbox.agent.js'
import { defineProviders } from './providers.js'
import { createMockInboxProvider } from './mock-provider.js'

describe('inbox.agent wiring', () => {
  it('the passport validates and references the claude-cli provider', () => {
    expect(inboxAgent.id).toBe('inbox')
    expect(inboxAgent.provider).toBe('claude-cli')
    expect(inboxAgent.approvals).toEqual(['saveDraft'])
  })

  it('a registry built from the passport approvals resolves a provider', () => {
    const reg = defineProviders({ mock: createMockInboxProvider(inboxAgent.approvals) })
    expect(typeof reg.resolve('mock').run).toBe('function')
  })
})
