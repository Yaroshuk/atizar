import { describe, it, expect } from 'vitest'
import { aggregateAgent, aggregateLabel, isBusy } from './aggregate'
import type { Status } from './status'

describe('aggregateAgent', () => {
  it('is idle with no instances', () => {
    expect(aggregateAgent([])).toEqual({ activeCount: 0, awaitingCount: 0, status: 'idle' })
  })
  it('counts active (running/awaiting/error) and awaiting separately', () => {
    const s: Status[] = ['running', 'awaiting_approval', 'done']
    expect(aggregateAgent(s)).toEqual({
      activeCount: 2,
      awaitingCount: 1,
      status: 'awaiting_approval',
    })
  })
  it('priority: awaiting_approval > error > running > done > idle', () => {
    expect(aggregateAgent(['running', 'error']).status).toBe('error')
    expect(aggregateAgent(['error', 'awaiting_approval']).status).toBe('awaiting_approval')
    expect(aggregateAgent(['done']).status).toBe('done')
  })
  it('a single finished scan aggregates to Done with no active label', () => {
    const a = aggregateAgent(['done'])
    expect(a.status).toBe('done')
    expect(a.activeCount).toBe(0)
    expect(aggregateLabel(a)).toBe('')
  })
})

describe('isBusy (START gating — Unit 4.2)', () => {
  it('an agent whose only instance is error is NOT busy (START stays available)', () => {
    const a = aggregateAgent(['error'])
    expect(a.status).toBe('error')
    expect(isBusy(a)).toBe(false)
    // The error still surfaces as a badge alongside START — the headline label is empty so it
    // does not masquerade as a live "N active" summary that would hide the button.
    expect(aggregateLabel(a)).toBe('')
  })
  it('a running instance IS busy', () => {
    expect(isBusy(aggregateAgent(['running']))).toBe(true)
  })
  it('an awaiting_approval instance IS busy', () => {
    expect(isBusy(aggregateAgent(['awaiting_approval']))).toBe(true)
  })
  it('an error alongside a running instance is still busy (the run holds the slot)', () => {
    expect(isBusy(aggregateAgent(['error', 'running']))).toBe(true)
  })
  it('an idle / done-only agent is not busy', () => {
    expect(isBusy(aggregateAgent([]))).toBe(false)
    expect(isBusy(aggregateAgent(['done']))).toBe(false)
  })
})
