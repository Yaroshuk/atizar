import { describe, it, expect } from 'vitest'
import { defineProviders, type ProviderFactory } from './providers.js'

const factory: ProviderFactory = () => ({
  // eslint-disable-next-line require-yield
  async *run() {
    return
  },
})

describe('defineProviders', () => {
  it('resolves a provider factory by name', () => {
    const registry = defineProviders({ mock: factory })
    expect(registry.resolve('mock')).toBe(factory)
  })

  it('throws on an unknown provider name', () => {
    const registry = defineProviders({ mock: factory })
    expect(() => registry.resolve('nope')).toThrow(/unknown provider/i)
  })
})
