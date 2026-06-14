import { describe, it, expect } from 'vitest'
import { PROVIDERS, type ProviderId } from './provider-ids.js'

describe('PROVIDERS', () => {
  it('maps each key to its wire string (config-as-data: value IS the wire string)', () => {
    expect(PROVIDERS.claudeCli).toBe('claude-cli')
    expect(PROVIDERS.mastra).toBe('mastra')
    expect(PROVIDERS.mock).toBe('mock')
  })

  it('exposes exactly the three known providers', () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual(['claudeCli', 'mastra', 'mock'])
  })

  it('every value is assignable to ProviderId (round-trip)', () => {
    const ids: ProviderId[] = Object.values(PROVIDERS)
    expect(ids).toEqual(['claude-cli', 'mastra', 'mock'])
  })
})
