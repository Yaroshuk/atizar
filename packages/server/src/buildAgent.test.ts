import { describe, it, expect } from 'vitest'
import { defineAgent, defineProviders } from '@atizar/core'
import type { Provider } from '@atizar/core'
import { buildAgentProvider } from './buildAgent.js'

const def = defineAgent({
  id: 'reply',
  name: 'REPLY',
  provider: 'mock',
  instructions: 'x',
  tools: ['saveDraft'],
  approvals: ['saveDraft'],
  renders: { saveDraft: 'ApprovalDialog' },
})

const baseProvider: Provider = { async *run() {} }
const registry = defineProviders({ mock: () => baseProvider })

describe('buildAgentProvider', () => {
  it('returns the resolved provider unchanged when no wrap is given', () => {
    const p = buildAgentProvider({
      def,
      prompts: { buildFirst: () => 'p', buildResume: () => null },
      registry,
      allowedTools: ['saveDraft'],
      instanceKey: 'wf__reply',
    })
    expect(p).toBe(baseProvider)
  })

  it('applies the injected wrap (receives provider + instanceKey + approvalNames)', () => {
    const wrapped: Provider = { async *run() {} }
    let seenKey = ''
    const p = buildAgentProvider({
      def,
      prompts: { buildFirst: () => 'p', buildResume: () => null },
      registry,
      allowedTools: ['saveDraft'],
      instanceKey: 'wf__reply',
      wrap: (provider, ctx) => {
        seenKey = ctx.instanceKey
        expect(provider).toBe(baseProvider)
        expect(ctx.approvalNames).toEqual(['saveDraft'])
        return wrapped
      },
    })
    expect(p).toBe(wrapped)
    expect(seenKey).toBe('wf__reply')
  })
})
