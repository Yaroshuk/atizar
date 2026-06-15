import { describe, it, expect } from 'vitest'
import {
  isOk,
  aggregateHealth,
  type HealthCheck,
  type ReadResult,
  type BatchActionResult,
} from './integration.js'

describe('integration contract', () => {
  it('isOk narrows a HealthCheck to the ok branch', () => {
    const ok: HealthCheck = { ok: true, detail: 'me@example.com' }
    const bad: HealthCheck = { ok: false, error: 'invalid_grant', hint: 'see SKILL.md' }
    expect(isOk(ok)).toBe(true)
    expect(isOk(bad)).toBe(false)
    if (isOk(ok)) expect(ok.detail).toBe('me@example.com')
    if (!isOk(bad)) expect(bad.hint).toMatch(/SKILL/)
  })

  it('ReadResult / BatchActionResult are usable as the documented shapes', () => {
    const r: ReadResult<{ n: number }> = { n: 1 }
    const err: ReadResult<{ n: number }> = { error: 'boom' }
    const batch: BatchActionResult = { done: ['a'], failed: [{ messageId: 'b', error: 'x' }] }
    expect('error' in r).toBe(false)
    expect('error' in err).toBe(true)
    expect(batch.done).toEqual(['a'])
  })
})

describe('aggregateHealth', () => {
  it('is ok when all checks are ok', () => {
    expect(aggregateHealth([{ ok: true }, { ok: true, detail: 'x' }])).toEqual({ ok: true })
  })
  it('returns the first failure', () => {
    const fail: HealthCheck = { ok: false, error: 'no creds', hint: 'see skill' }
    expect(aggregateHealth([{ ok: true }, fail])).toEqual(fail)
  })
  it('an empty array has no failing checks → ok', () => {
    expect(aggregateHealth([])).toEqual({ ok: true })
  })
})
