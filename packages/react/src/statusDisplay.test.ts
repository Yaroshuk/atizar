import { describe, it, expect } from 'vitest'
import { pillLabel, pillTint, cardLabel } from './statusDisplay'

describe('pillLabel / pillTint (outcome-aware list surfaces)', () => {
  it('a stopped item reads Stopped with a non-done tint (not Done)', () => {
    expect(pillLabel('done', 'stopped')).toBe('Stopped')
    expect(pillTint('done', 'stopped')).not.toBe(pillTint('done', 'done'))
  })
  it('a rejected item reads Rejected', () => {
    expect(pillLabel('done', 'rejected')).toBe('Rejected')
  })
  it('a clean done still reads Done', () => {
    expect(pillLabel('done', 'done')).toBe('Done')
  })
  it('live statuses ignore outcome (running → Working)', () => {
    expect(pillLabel('running', 'running')).toBe('Working')
  })
})

// The type card uses STATUS_LABEL for live/idle (e.g. "Awaiting approval"), but a distinct
// terminal outcome must show its OUTCOME_LABEL word ("Stopped"/"Rejected") instead of "Done".
describe('cardLabel (type-card badge, outcome-aware)', () => {
  it('a distinct terminal shows its outcome word, not Done', () => {
    expect(cardLabel('done', 'stopped')).toBe('Stopped')
    expect(cardLabel('done', 'rejected')).toBe('Rejected')
  })
  it('a clean done (or null outcome) shows the status label', () => {
    expect(cardLabel('done', 'done')).toBe('Done')
    expect(cardLabel('done', null)).toBe('Done')
  })
  it('live/idle keep the card status labels (not the pill STATE_WORD)', () => {
    expect(cardLabel('awaiting_approval', null)).toBe('Awaiting approval')
    expect(cardLabel('running', null)).toBe('Working…')
    expect(cardLabel('idle', null)).toBe('Idle')
    expect(cardLabel('error', null)).toBe('Error')
  })
})
