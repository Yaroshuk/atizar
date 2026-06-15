import { describe, it, expect } from 'vitest'
import { providerHealth } from './providerHealth.js'

describe('providerHealth', () => {
  it('mock is always ok', () => expect(providerHealth('mock')).toEqual({ ok: true }))
  it('mastra needs ANTHROPIC_API_KEY', () => {
    const saved = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      expect(providerHealth('mastra').ok).toBe(false)
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved
      else delete process.env.ANTHROPIC_API_KEY
    }
  })
})
