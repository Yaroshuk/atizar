import { describe, it, expect } from 'vitest'
import { pillLabel, pillTint } from './statusDisplay'

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
