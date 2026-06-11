import { describe, it, expect } from 'vitest'
import { aggregateHealth, providerHealth } from './health.js'

describe('aggregateHealth', () => {
  it('is ok when all checks are ok', () => {
    expect(aggregateHealth([{ ok: true }, { ok: true, detail: 'x' }])).toEqual({ ok: true })
  })
  it('returns the first failure', () => {
    const fail = { ok: false, error: 'no creds', hint: 'see skill' } as const
    expect(aggregateHealth([{ ok: true }, fail])).toEqual(fail)
  })
})

describe('providerHealth', () => {
  it('mock is always ok', () => expect(providerHealth('mock')).toEqual({ ok: true }))
  it('mastra needs ANTHROPIC_API_KEY', () => {
    const saved = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    expect(providerHealth('mastra').ok).toBe(false)
    if (saved) process.env.ANTHROPIC_API_KEY = saved
  })
})
