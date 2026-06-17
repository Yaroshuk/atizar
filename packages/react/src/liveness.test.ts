import { describe, it, expect } from 'vitest'
import { isLive, isBusy } from './liveness'
import { STATUSES, type Status } from './status'

describe('isLive', () => {
  it('is true for running, awaiting_approval, error', () => {
    expect(isLive('running')).toBe(true)
    expect(isLive('awaiting_approval')).toBe(true)
    expect(isLive('error')).toBe(true)
  })
  it('is false for idle and done', () => {
    expect(isLive('idle')).toBe(false)
    expect(isLive('done')).toBe(false)
  })
})

describe('isBusy', () => {
  it('is true for running and awaiting_approval', () => {
    expect(isBusy('running')).toBe(true)
    expect(isBusy('awaiting_approval')).toBe(true)
  })
  it('is false for error (a crashed agent frees its slot — START stays)', () => {
    expect(isBusy('error')).toBe(false)
  })
  it('is false for idle and done', () => {
    expect(isBusy('idle')).toBe(false)
    expect(isBusy('done')).toBe(false)
  })
})

describe('isLive vs isBusy', () => {
  it('differ ONLY on error', () => {
    const differ = (STATUSES as readonly Status[]).filter((s) => isLive(s) !== isBusy(s))
    expect(differ).toEqual(['error'])
  })
})
