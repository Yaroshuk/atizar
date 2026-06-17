import { describe, it, expect } from 'vitest'
import { lifecycle, hasLiveDescendant, type Phase, type Outcome } from './lifecycle.js'

// The golden table: every (phase, outcome) pair we can persist, with the EXPECTED classifier
// output. hasCard / hasLiveDescendant are the two extrinsic inputs to isVisible; the table
// fixes isVisible for the "no card, no live descendant" baseline, then separate cases cover the
// card / descendant overrides. THIS TABLE IS THE I12 LADDER — change it only with a spec change.
type Row = {
  phase: Phase
  outcome: Outcome
  isLive: boolean
  // isVisible with hasCard=false, hasLiveDescendant=false
  baseVisible: boolean
  covers: boolean
}

const TABLE: Row[] = [
  // live, never-terminal
  { phase: 'queued', outcome: 'running', isLive: true, baseVisible: false, covers: true },
  { phase: 'active', outcome: 'running', isLive: true, baseVisible: true, covers: true },
  { phase: 'awaiting_human', outcome: 'running', isLive: true, baseVisible: true, covers: true },
  // terminal outcomes
  { phase: 'terminal', outcome: 'done', isLive: false, baseVisible: false, covers: true },
  { phase: 'terminal', outcome: 'stopped', isLive: false, baseVisible: true, covers: true },
  { phase: 'terminal', outcome: 'rejected', isLive: false, baseVisible: true, covers: false },
  { phase: 'terminal', outcome: 'error', isLive: false, baseVisible: true, covers: false },
  { phase: 'terminal', outcome: 'superseded', isLive: false, baseVisible: false, covers: false },
  { phase: 'terminal', outcome: 'reset', isLive: false, baseVisible: false, covers: false },
  { phase: 'terminal', outcome: 'dismissed', isLive: false, baseVisible: false, covers: false },
]

describe('lifecycle() golden table (I12 ladder)', () => {
  for (const r of TABLE) {
    it(`${r.phase}/${r.outcome}: isLive=${r.isLive} baseVisible=${r.baseVisible} covers=${r.covers}`, () => {
      const lc = lifecycle(r.phase, r.outcome, false, false)
      expect(lc.isLive).toBe(r.isLive)
      expect(lc.isVisible).toBe(r.baseVisible)
      expect(lc.covers).toBe(r.covers)
      expect(lc.phase).toBe(r.phase)
      expect(lc.outcome).toBe(r.outcome)
    })
  }

  it('queued is NEVER visible even with a card or a live descendant', () => {
    expect(lifecycle('queued', 'running', true, true).isVisible).toBe(false)
  })

  it('a terminal done item with a card IS visible (result kept until human closes)', () => {
    expect(lifecycle('terminal', 'done', true, false).isVisible).toBe(true)
  })

  it('a terminal done item with a live descendant IS visible (kept parent)', () => {
    expect(lifecycle('terminal', 'done', false, true).isVisible).toBe(true)
  })

  it('a superseded item stays hidden even with a card (it has LEFT the board)', () => {
    expect(lifecycle('terminal', 'superseded', true, true).isVisible).toBe(false)
  })

  it('a reset item stays hidden even with a card', () => {
    expect(lifecycle('terminal', 'reset', true, true).isVisible).toBe(false)
  })

  it('dismissed is a retired terminal: not live, not visible, does not cover', () => {
    const lc = lifecycle('terminal', 'dismissed', true, false)
    expect(lc.isLive).toBe(false)
    expect(lc.isVisible).toBe(false) // retired — leaves the live board (RETIRED), even with a card
    expect(lc.covers).toBe(false) // like error: a re-scan re-surfaces the source
  })

  it('dismissed stays hidden even with a card and a live descendant', () => {
    expect(lifecycle('terminal', 'dismissed', true, true).isVisible).toBe(false)
  })

  it('dismissed is not in HUMAN_TERMINAL (no must-see without a card)', () => {
    // The acknowledged error recedes; it is NOT a human-must-see marker
    expect(lifecycle('terminal', 'dismissed', false, false).isVisible).toBe(false)
  })

  it('a human-terminal marker (stopped/rejected/error) is visible without a card', () => {
    expect(lifecycle('terminal', 'stopped', false, false).isVisible).toBe(true)
    expect(lifecycle('terminal', 'rejected', false, false).isVisible).toBe(true)
    expect(lifecycle('terminal', 'error', false, false).isVisible).toBe(true)
  })
})

describe('hasLiveDescendant tree walk', () => {
  const rows = [
    { id: 'root', parentId: null, phase: 'terminal' as Phase },
    { id: 'mid', parentId: 'root', phase: 'terminal' as Phase },
    { id: 'leaf', parentId: 'mid', phase: 'awaiting_human' as Phase },
    { id: 'lone', parentId: null, phase: 'terminal' as Phase },
  ]

  it('marks every ancestor of a live node', () => {
    const live = hasLiveDescendant(rows)
    expect(live.has('root')).toBe(true)
    expect(live.has('mid')).toBe(true)
  })

  it('a terminal leaf is NOT its own live descendant', () => {
    expect(hasLiveDescendant(rows).has('leaf')).toBe(false)
  })

  it('a lone terminal node has no live descendant', () => {
    expect(hasLiveDescendant(rows).has('lone')).toBe(false)
  })

  it('tolerates a parent cycle without infinite-looping', () => {
    const cyclic = [
      { id: 'a', parentId: 'b', phase: 'terminal' as Phase },
      { id: 'b', parentId: 'a', phase: 'terminal' as Phase },
    ]
    expect(hasLiveDescendant(cyclic).size).toBe(0)
  })
})
