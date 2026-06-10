import { describe, it, expect } from 'vitest'
import { defineProviders, type ProviderFactory } from './providers.js'
import type { Provider, ResumeHandle, GateResolution } from './providers.js'

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

describe('Provider v2 contract types', () => {
  it('allows a provider that implements optional resume()', async () => {
    const handle: ResumeHandle = { runId: 'r1', input: { messages: [] } as never }
    const resolution: GateResolution = { gateId: 'g1', decision: 'approved', form: { body: 'x' } }
    const provider: Provider = {
      // eslint-disable-next-line require-yield
      async *run() {
        return
      },
      async *resume(h: ResumeHandle, r: GateResolution) {
        expect(h.runId).toBe('r1')
        expect(r.decision).toBe('approved')
      },
    }
    // resume is optional but present here — drain it to prove the shape compiles + runs
    for await (const _ of provider.resume!(handle, resolution)) void _
    expect(typeof provider.resume).toBe('function')
  })

  it('allows a provider WITHOUT resume() (back-compat)', () => {
    const provider: Provider = {
      // eslint-disable-next-line require-yield
      async *run() {
        return
      },
    }
    expect(provider.resume).toBeUndefined()
  })
})
