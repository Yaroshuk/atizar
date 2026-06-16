import { describe, it, expect } from 'vitest'
import { lifecycle, hasLiveDescendant, type Phase, type Outcome } from './lifecycle.js'

// Drift guard: the same (phase, outcome, hasCard, hasLiveDescendant) tuple must yield ONE answer.
// This is a property test over the full alphabet — if any consumer ever forks the rule, its own
// unit test would diverge from this table. (The consumers import lifecycle() directly, so this
// guards against a future copy-paste reintroducing a parallel derivation.)
const PHASES: Phase[] = ['queued', 'active', 'awaiting_human', 'terminal']
const OUTCOMES: Outcome[] = [
  'running',
  'done',
  'stopped',
  'rejected',
  'error',
  'superseded',
  'reset',
]

describe('lifecycle drift guard', () => {
  it('is a pure function of its inputs (idempotent)', () => {
    for (const phase of PHASES) {
      for (const outcome of OUTCOMES) {
        for (const hasCard of [false, true]) {
          for (const hld of [false, true]) {
            const a = lifecycle(phase, outcome, hasCard, hld)
            const b = lifecycle(phase, outcome, hasCard, hld)
            expect(a).toEqual(b)
          }
        }
      }
    }
  })

  it('isLive is exactly phase ∈ {queued, active, awaiting_human} regardless of outcome/card', () => {
    for (const phase of PHASES) {
      for (const outcome of OUTCOMES) {
        const expected = phase !== 'terminal'
        expect(lifecycle(phase, outcome, false, false).isLive).toBe(expected)
      }
    }
  })

  it('a retired (superseded/reset) item is never visible; a queued item is never visible', () => {
    expect(lifecycle('terminal', 'superseded', true, true).isVisible).toBe(false)
    expect(lifecycle('terminal', 'reset', true, true).isVisible).toBe(false)
    expect(lifecycle('queued', 'running', true, true).isVisible).toBe(false)
  })

  it('hasLiveDescendant agrees with isLive over a tree', () => {
    const rows = [
      { id: 'r', parentId: null, phase: 'terminal' as Phase },
      { id: 'c', parentId: 'r', phase: 'active' as Phase },
    ]
    const set = hasLiveDescendant(rows)
    expect(set.has('r')).toBe(lifecycle('active', 'running', false, false).isLive) // true
  })
})
